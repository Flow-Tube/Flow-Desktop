import type { ImportKind } from "../api/backup";
import type { StringKey } from "../i18n/index";

export interface ImportOption {
  kind: ImportKind;
  title: StringKey;
  description: StringKey;
  extensions: string[];
  /** The picker takes several files, which make up one import. */
  several?: boolean;
}

export interface ImportSource {
  id: string;
  title: StringKey;
  options: ImportOption[];
}

const CSV = ["csv", "txt"];
const BACKUP = ["zip", "db"];

/** People look for an import by the app they are leaving, so the page groups them this way. */
export const IMPORT_SOURCES: ImportSource[] = [
  {
    id: "youtube",
    title: "import_source_youtube",
    options: [
      { kind: "TAKEOUT", title: "import_kind_takeout", description: "import_kind_takeout_desc", extensions: ["zip"], several: true },
      { kind: "YOUTUBE_SUBSCRIPTIONS", title: "import_kind_yt_subscriptions", description: "import_kind_yt_subscriptions_desc", extensions: CSV },
      { kind: "YOUTUBE_HISTORY", title: "import_kind_yt_history", description: "import_kind_yt_history_desc", extensions: ["html", "json"] },
      { kind: "YOUTUBE_LIKES", title: "import_kind_yt_likes", description: "import_kind_yt_likes_desc", extensions: ["json", "zip"] },
      { kind: "YOUTUBE_PLAYLIST", title: "import_kind_yt_playlist", description: "import_kind_yt_playlist_desc", extensions: CSV },
      { kind: "WATCH_LATER", title: "import_kind_watch_later", description: "import_kind_watch_later_desc", extensions: CSV },
      { kind: "YOUTUBE_MUSIC_PLAYLIST", title: "import_kind_yt_music_playlist", description: "import_kind_yt_music_playlist_desc", extensions: CSV },
    ],
  },
  {
    id: "newpipe",
    title: "import_source_newpipe",
    options: [
      { kind: "NEWPIPE_SUBSCRIPTIONS", title: "import_kind_newpipe_subs", description: "import_kind_newpipe_subs_desc", extensions: ["json"] },
      { kind: "NEWPIPE_HISTORY", title: "import_kind_newpipe_history", description: "import_kind_newpipe_history_desc", extensions: BACKUP },
      { kind: "NEWPIPE_PLAYLISTS", title: "import_kind_newpipe_playlists", description: "import_kind_newpipe_playlists_desc", extensions: BACKUP },
    ],
  },
  {
    id: "libretube",
    title: "import_source_libretube",
    options: [
      { kind: "LIBRETUBE_SUBSCRIPTIONS", title: "import_kind_libretube_subs", description: "import_kind_libretube_subs_desc", extensions: ["json"] },
      { kind: "LIBRETUBE_PLAYLISTS", title: "import_kind_libretube_playlists", description: "import_kind_libretube_playlists_desc", extensions: ["json"] },
    ],
  },
  {
    id: "freetube",
    title: "import_source_freetube",
    options: [
      { kind: "FREETUBE_HISTORY", title: "import_kind_freetube_history", description: "import_kind_freetube_history_desc", extensions: ["db", "json", "txt"] },
    ],
  },
  {
    id: "metrolist",
    title: "import_source_metrolist",
    options: [{ kind: "METROLIST", title: "import_kind_metrolist", description: "import_kind_metrolist_desc", extensions: ["zip"] }],
  },
];
