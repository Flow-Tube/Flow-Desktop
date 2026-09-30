use std::collections::{HashMap, HashSet};

use serde::{Serialize, de::DeserializeOwned};
use sqlx::{Row, SqlitePool};

use crate::errors::{AppError, AppResult};
use crate::models::music::{Album, AlbumItem, Artist, ArtistItem, SongItem, YTItem};

pub const RETENTION_SECONDS: i64 = 60 * 24 * 60 * 60;
const MAX_EDGES_PER_RELATION: usize = 64;

pub async fn get_cached<T: DeserializeOwned>(
    pool: &SqlitePool,
    source_kind: &str,
    source_id: &str,
    max_age_seconds: i64,
) -> AppResult<Option<T>> {
    let row = sqlx::query(
        "SELECT payload_json FROM music_content_cache \
         WHERE source_kind = ? AND source_id = ? AND fetched_at >= unixepoch() - ?",
    )
    .bind(source_kind)
    .bind(source_id)
    .bind(max_age_seconds)
    .fetch_optional(pool)
    .await
    .map_err(AppError::from)?;
    row.map(|row| {
        let json: String = row.try_get("payload_json").map_err(AppError::from)?;
        serde_json::from_str(&json).map_err(AppError::from)
    })
    .transpose()
}

pub async fn save<T: Serialize>(
    pool: &SqlitePool,
    source_kind: &str,
    source_id: &str,
    page: &T,
    edges: &[(String, YTItem)],
) -> AppResult<()> {
    let json = serde_json::to_string(page).map_err(AppError::from)?;
    let mut transaction = pool.begin().await.map_err(AppError::from)?;
    sqlx::query(
        "INSERT INTO music_content_cache (source_kind, source_id, payload_json, fetched_at) \
         VALUES (?, ?, ?, unixepoch()) ON CONFLICT(source_kind, source_id) \
         DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at",
    )
    .bind(source_kind)
    .bind(source_id)
    .bind(json)
    .execute(&mut *transaction)
    .await
    .map_err(AppError::from)?;
    sqlx::query("DELETE FROM music_content_edges WHERE source_kind = ? AND source_id = ?")
        .bind(source_kind)
        .bind(source_id)
        .execute(&mut *transaction)
        .await
        .map_err(AppError::from)?;
    let mut per_relation: HashMap<&str, usize> = HashMap::new();
    for (relation, item) in edges {
        let position = per_relation.entry(relation.as_str()).or_default();
        if *position >= MAX_EDGES_PER_RELATION {
            continue;
        }
        let Some((target_kind, target_id)) = item_identity(item) else {
            continue;
        };
        let edge_position = *position;
        *position += 1;
        let item_json = serde_json::to_string(item).map_err(AppError::from)?;
        sqlx::query(
            "INSERT INTO music_content_entities (entity_kind, entity_id, payload_json, updated_at) \
             VALUES (?, ?, ?, unixepoch()) ON CONFLICT(entity_kind, entity_id) \
             DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at",
        )
        .bind(target_kind)
        .bind(target_id)
        .bind(item_json)
        .execute(&mut *transaction)
        .await
        .map_err(AppError::from)?;
        sqlx::query(
            "INSERT INTO music_content_edges \
             (source_kind, source_id, relation, target_kind, target_id, position, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, unixepoch()) \
             ON CONFLICT(source_kind, source_id, relation, target_kind, target_id) \
             DO UPDATE SET position = excluded.position, updated_at = excluded.updated_at",
        )
        .bind(source_kind)
        .bind(source_id)
        .bind(relation)
        .bind(target_kind)
        .bind(target_id)
        .bind(i64::try_from(edge_position).unwrap_or(i64::MAX))
        .execute(&mut *transaction)
        .await
        .map_err(AppError::from)?;
    }
    transaction.commit().await.map_err(AppError::from)?;
    Ok(())
}

fn item_identity(item: &YTItem) -> Option<(&'static str, &str)> {
    match item {
        YTItem::Song(song) => Some(("track", song.video_id.as_deref().unwrap_or(&song.id))),
        YTItem::Artist(artist) => Some(("artist", artist.id.as_str())),
        YTItem::Album(album) => Some(("album", album.browse_id.as_str())),
        YTItem::Playlist(playlist) => Some(("playlist", playlist.id.as_str())),
        _ => None,
    }
    .filter(|(_, id)| !id.is_empty())
}

const DEEP_CUTS_PER_ALBUM: usize = 3;

/// Taste context for graph reads: the user's strongest artists (seeds) and every
/// artist they have heard or blocked (never offered as "new").
pub struct GraphTaste {
    pub seed_artists: HashSet<String>,
    pub known_artists: HashSet<String>,
}

/// Mirrors `MusicBrain`'s artist key: the artist id when present, else the lowercased name.
fn artist_keys(artists: &[Artist]) -> impl Iterator<Item = String> + '_ {
    artists.iter().map(|artist| {
        match artist
            .id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
        {
            Some(id) => id.to_owned(),
            None => artist.name.trim().to_lowercase(),
        }
    })
}

/// Title + artist identity, so an album's audio track matches the music-video
/// upload of the same song already in history.
fn recording_key(title: &str, artist: &str) -> String {
    let mut depth = 0usize;
    let bare: String = title
        .chars()
        .filter(|c| match c {
            '(' | '[' => {
                depth += 1;
                false
            }
            ')' | ']' => {
                depth = depth.saturating_sub(1);
                false
            }
            _ => depth == 0,
        })
        .collect();
    let artist = artist.trim().to_lowercase();
    let artist = artist.strip_suffix(" - topic").unwrap_or(&artist);
    let words = |text: &str| {
        text.split(|c: char| !c.is_alphanumeric())
            .filter(|word| !word.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    };
    format!("{}|{}", words(&bare.to_lowercase()), words(artist))
}

/// Album track rows often omit the artist and cover (the album header carries them),
/// and can even put the play count where the artist goes. A track with no identified
/// artist takes the album's, so graph reads can match it to the user's taste.
pub fn fill_from_album(song: &mut SongItem, album: &AlbumItem) {
    let identified = song.artists.iter().any(|artist| artist.id.is_some());
    if !identified
        && let Some(album_artists) = album.artists.as_ref().filter(|artists| !artists.is_empty())
    {
        song.artists.clone_from(album_artists);
    }
    if song.thumbnail.is_empty() {
        song.thumbnail.clone_from(&album.thumbnail);
    }
    if song.album.is_none() {
        song.album = Some(Album {
            name: album.title.clone(),
            id: album.browse_id.clone(),
        });
    }
}

/// Album headers from cached album pages, for repairing rows recorded before
/// [`fill_from_album`] ran at write time.
async fn cached_album_headers(pool: &SqlitePool) -> AppResult<HashMap<String, AlbumItem>> {
    let rows = sqlx::query(
        "SELECT source_id, payload_json FROM music_content_cache WHERE source_kind = 'album'",
    )
    .fetch_all(pool)
    .await
    .map_err(AppError::from)?;
    Ok(rows
        .into_iter()
        .filter_map(|row| {
            let id: String = row.try_get("source_id").ok()?;
            let json: String = row.try_get("payload_json").ok()?;
            let page: serde_json::Value = serde_json::from_str(&json).ok()?;
            let album: AlbumItem = serde_json::from_value(page.get("album")?.clone()).ok()?;
            Some((id, album))
        })
        .collect())
}

/// Unheard tracks from albums by the user's strongest artists, a few per album.
pub async fn deep_cuts(
    pool: &SqlitePool,
    taste: &GraphTaste,
    limit: i64,
) -> AppResult<Vec<SongItem>> {
    if taste.seed_artists.is_empty() {
        return Ok(Vec::new());
    }
    let heard: HashSet<String> = sqlx::query(
        "SELECT title, channel_name FROM watch_history WHERE is_music = 1 ORDER BY id DESC LIMIT 5000",
    )
    .fetch_all(pool)
    .await
    .map_err(AppError::from)?
    .into_iter()
    .filter_map(|row| {
        let title: String = row.try_get("title").ok()?;
        let artist: Option<String> = row.try_get("channel_name").ok()?;
        Some(recording_key(&title, artist.as_deref().unwrap_or_default()))
    })
    .collect();
    let rows = sqlx::query(
        "SELECT edge.source_id, e.payload_json FROM music_content_edges edge \
         JOIN music_content_entities e ON e.entity_kind = 'track' AND e.entity_id = edge.target_id \
         WHERE edge.source_kind = 'album' AND edge.relation = 'tracks' \
         AND NOT EXISTS (SELECT 1 FROM watch_history h WHERE h.video_id = edge.target_id AND h.is_music = 1) \
         ORDER BY edge.updated_at DESC, edge.source_id, edge.position",
    )
    .fetch_all(pool)
    .await
    .map_err(AppError::from)?;
    let albums = cached_album_headers(pool).await?;
    let limit = usize::try_from(limit.clamp(1, 100)).unwrap_or(1);
    let mut per_album: HashMap<String, usize> = HashMap::new();
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for row in rows {
        let Ok(album_id) = row.try_get::<String, _>("source_id") else {
            continue;
        };
        let Ok(json) = row.try_get::<String, _>("payload_json") else {
            continue;
        };
        let Ok(YTItem::Song(mut song)) = serde_json::from_str::<YTItem>(&json) else {
            continue;
        };
        if let Some(album) = albums.get(&album_id) {
            fill_from_album(&mut song, album);
        }
        if !artist_keys(&song.artists).any(|key| taste.seed_artists.contains(&key)) {
            continue;
        }
        let key = recording_key(
            &song.title,
            song.artists
                .first()
                .map_or("", |artist| artist.name.as_str()),
        );
        if heard.contains(&key) || !seen.insert(key) {
            continue;
        }
        let taken = per_album.entry(album_id).or_default();
        if *taken >= DEEP_CUTS_PER_ALBUM {
            continue;
        }
        *taken += 1;
        out.push(song);
        if out.len() >= limit {
            break;
        }
    }
    Ok(out)
}

/// Platform "similar artist" neighbours the user has not heard, strongest seeds first.
pub async fn linked_artists(
    pool: &SqlitePool,
    taste: &GraphTaste,
    limit: i64,
) -> AppResult<Vec<ArtistItem>> {
    let rows = sqlx::query(
        "SELECT edge.source_kind, edge.source_id, e.payload_json FROM music_content_edges edge \
         JOIN music_content_entities e ON e.entity_kind = 'artist' AND e.entity_id = edge.target_id \
         WHERE edge.relation = 'similarArtists' \
         ORDER BY edge.updated_at DESC, edge.position",
    )
    .fetch_all(pool)
    .await
    .map_err(AppError::from)?;
    let mut seeded = Vec::new();
    let mut other = Vec::new();
    let mut seen = HashSet::new();
    for row in rows {
        let Ok(json) = row.try_get::<String, _>("payload_json") else {
            continue;
        };
        let Ok(YTItem::Artist(artist)) = serde_json::from_str::<YTItem>(&json) else {
            continue;
        };
        let name_key = artist.title.trim().to_lowercase();
        if taste.known_artists.contains(&artist.id)
            || taste.known_artists.contains(&name_key)
            || !seen.insert(artist.id.clone())
        {
            continue;
        }
        let source_kind: String = row.try_get("source_kind").unwrap_or_default();
        let source_id: String = row.try_get("source_id").unwrap_or_default();
        if source_kind == "artist" && taste.seed_artists.contains(&source_id) {
            seeded.push(artist);
        } else {
            other.push(artist);
        }
    }
    // Neighbours of the user's own favourites lead; everything else only pads.
    seeded.extend(other);
    seeded.truncate(usize::try_from(limit.clamp(1, 100)).unwrap_or(1));
    Ok(seeded)
}

pub async fn prune(pool: &SqlitePool) -> AppResult<()> {
    for query in [
        "DELETE FROM music_content_cache WHERE fetched_at < unixepoch() - ?",
        "DELETE FROM music_content_edges WHERE updated_at < unixepoch() - ?",
        "DELETE FROM music_content_entities WHERE updated_at < unixepoch() - ?",
    ] {
        sqlx::query(query)
            .bind(RETENTION_SECONDS)
            .execute(pool)
            .await
            .map_err(AppError::from)?;
    }
    sqlx::query(
        "DELETE FROM music_content_entities WHERE entity_kind = 'track' AND entity_id NOT IN \
         (SELECT entity_id FROM music_content_entities WHERE entity_kind = 'track' \
          ORDER BY updated_at DESC LIMIT 20000)",
    )
    .execute(pool)
    .await
    .map_err(AppError::from)?;
    sqlx::query(
        "DELETE FROM music_content_cache WHERE rowid NOT IN \
         (SELECT rowid FROM music_content_cache ORDER BY fetched_at DESC LIMIT 5000)",
    )
    .execute(pool)
    .await
    .map_err(AppError::from)?;
    sqlx::query(
        "DELETE FROM music_content_edges WHERE NOT EXISTS \
         (SELECT 1 FROM music_content_entities entity \
          WHERE entity.entity_kind = music_content_edges.target_kind \
          AND entity.entity_id = music_content_edges.target_id)",
    )
    .execute(pool)
    .await
    .map_err(AppError::from)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn song(id: &str, artist: &str) -> SongItem {
        SongItem {
            id: id.into(),
            video_id: Some(id.into()),
            title: id.into(),
            artists: vec![Artist {
                name: artist.into(),
                id: Some(format!("{artist}-id")),
            }],
            album: None,
            duration: Some(200),
            music_video_type: Some("MUSIC_VIDEO_TYPE_ATV".into()),
            thumbnail: String::new(),
            explicit: false,
            playlist_id: None,
            params: None,
            views_text: None,
        }
    }

    fn artist(id: &str) -> YTItem {
        YTItem::Artist(ArtistItem {
            id: id.into(),
            title: id.into(),
            thumbnail: None,
            channel_id: None,
        })
    }

    fn taste(seeds: &[&str], known: &[&str]) -> GraphTaste {
        GraphTaste {
            seed_artists: seeds.iter().map(|seed| (*seed).to_owned()).collect(),
            known_artists: known.iter().map(|key| (*key).to_owned()).collect(),
        }
    }

    async fn pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    async fn save_album(pool: &SqlitePool, id: &str, songs: &[SongItem]) {
        let edges: Vec<_> = songs
            .iter()
            .cloned()
            .map(|song| ("tracks".to_owned(), YTItem::Song(song)))
            .collect();
        save(pool, "album", id, &songs.to_vec(), &edges)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn graph_cache_survives_reads_and_prunes_expired_edges() {
        let pool = pool().await;
        let fav = taste(&["fav-id"], &[]);
        save_album(&pool, "album-1", &[song("first", "fav")]).await;
        let cached: Vec<SongItem> = get_cached(&pool, "album", "album-1", 10)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(cached[0].id, "first");
        assert_eq!(deep_cuts(&pool, &fav, 10).await.unwrap().len(), 1);

        sqlx::query("INSERT INTO watch_history (video_id, title, watch_date, is_music) VALUES (?, ?, '2026-01-01', 1)")
            .bind("first").bind("first").execute(&pool).await.unwrap();
        assert!(deep_cuts(&pool, &fav, 10).await.unwrap().is_empty());

        save_album(&pool, "album-1", &[song("second", "fav")]).await;
        assert_eq!(deep_cuts(&pool, &fav, 10).await.unwrap()[0].id, "second");

        sqlx::query("UPDATE music_content_edges SET updated_at = 0")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE music_content_cache SET fetched_at = 0")
            .execute(&pool)
            .await
            .unwrap();
        let stale: Option<Vec<SongItem>> = get_cached(&pool, "album", "album-1", 10).await.unwrap();
        assert!(stale.is_none());
        prune(&pool).await.unwrap();
        assert!(deep_cuts(&pool, &fav, 10).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn deep_cuts_follow_taste_and_skip_heard_recordings() {
        let pool = pool().await;
        let tracks: Vec<_> = (0..5)
            .map(|index| song(&format!("fav-{index}"), "fav"))
            .collect();
        save_album(&pool, "fav-album", &tracks).await;
        save_album(&pool, "other-album", &[song("stranger", "other")]).await;
        // The music video of fav-0 is in history under a different id.
        sqlx::query(
            "INSERT INTO watch_history (video_id, title, channel_name, watch_date, is_music) \
                     VALUES ('omv', 'fav-0 (Official Video)', 'Fav - Topic', '2026-01-01', 1)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let cuts = deep_cuts(&pool, &taste(&["fav-id"], &[]), 10)
            .await
            .unwrap();
        let ids: Vec<_> = cuts.iter().map(|song| song.id.as_str()).collect();
        assert_eq!(ids, vec!["fav-1", "fav-2", "fav-3"]);
        assert!(
            deep_cuts(&pool, &taste(&[], &[]), 10)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn linked_artists_skip_known_and_lead_with_seed_neighbours() {
        let pool = pool().await;
        save(
            &pool,
            "related",
            "some-track",
            &(),
            &[
                ("similarArtists".into(), artist("from-related")),
                ("similarArtists".into(), artist("heard")),
            ],
        )
        .await
        .unwrap();
        save(
            &pool,
            "artist",
            "fav-id",
            &(),
            &[("similarArtists".into(), artist("fan-pick"))],
        )
        .await
        .unwrap();

        let artists = linked_artists(&pool, &taste(&["fav-id"], &["heard"]), 10)
            .await
            .unwrap();
        let ids: Vec<_> = artists.iter().map(|artist| artist.id.as_str()).collect();
        assert_eq!(ids, vec!["fan-pick", "from-related"]);
    }

    #[tokio::test]
    async fn deep_cuts_repair_album_rows_that_lack_the_artist() {
        let pool = pool().await;
        let mut track = song("hidden-gem", "fav");
        // What album pages used to record: the play count parsed as the artist.
        track.artists = vec![Artist {
            name: "329K plays".into(),
            id: None,
        }];
        track.thumbnail = String::new();
        let page = serde_json::json!({ "album": {
            "browseId": "MPREb_fav", "playlistId": "", "title": "Fav album",
            "artists": [{ "name": "Fav", "id": "fav-id" }], "year": null,
            "thumbnail": "cover.jpg", "explicit": false
        } });
        save(
            &pool,
            "album",
            "MPREb_fav",
            &page,
            &[("tracks".into(), YTItem::Song(track))],
        )
        .await
        .unwrap();

        let cuts = deep_cuts(&pool, &taste(&["fav-id"], &[]), 10)
            .await
            .unwrap();
        assert_eq!(cuts.len(), 1);
        assert_eq!(cuts[0].artists[0].id.as_deref(), Some("fav-id"));
        assert_eq!(cuts[0].thumbnail, "cover.jpg");
        assert_eq!(
            cuts[0].album.as_ref().map(|album| album.id.as_str()),
            Some("MPREb_fav")
        );
    }
}
