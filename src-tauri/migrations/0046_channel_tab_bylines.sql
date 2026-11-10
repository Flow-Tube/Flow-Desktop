-- Cards from a channel's own tabs, saved before the byline fix, name their view
-- count as the channel ("1.2M views") and lost their real count line. Each one
-- takes back the name its channel is known by, and the count moves to its own
-- field. A card whose channel has no known name is left as it was: a stored
-- card is refetched over time, and a wrong guess would be worse than waiting.
-- Only English counts are matched here; refetching fixes the others.

-- Channel memory and neighbour rows hold their channel's name beside its cards.
UPDATE home_channel_memory
SET uploads = (
    SELECT json_group_array(
        CASE
            WHEN json_extract(u.value, '$.channelId') = home_channel_memory.channel_id
                AND json_extract(u.value, '$.channelName') GLOB '[0-9]*'
                AND (json_extract(u.value, '$.channelName') LIKE '% view'
                    OR json_extract(u.value, '$.channelName') LIKE '% views'
                    OR json_extract(u.value, '$.channelName') LIKE '% watching'
                    OR json_extract(u.value, '$.channelName') LIKE '% waiting')
            THEN json_set(
                u.value,
                '$.viewCountText', COALESCE(json_extract(u.value, '$.viewCountText'), json_extract(u.value, '$.channelName')),
                '$.channelName', home_channel_memory.name)
            ELSE json(u.value)
        END)
    FROM json_each(home_channel_memory.uploads) u
)
WHERE name != '' AND json_valid(uploads) AND json_array_length(uploads) > 0;

UPDATE home_neighbour_channels
SET uploads = (
    SELECT json_group_array(
        CASE
            WHEN json_extract(u.value, '$.channelId') = home_neighbour_channels.channel_id
                AND json_extract(u.value, '$.channelName') GLOB '[0-9]*'
                AND (json_extract(u.value, '$.channelName') LIKE '% view'
                    OR json_extract(u.value, '$.channelName') LIKE '% views'
                    OR json_extract(u.value, '$.channelName') LIKE '% watching'
                    OR json_extract(u.value, '$.channelName') LIKE '% waiting')
            THEN json_set(
                u.value,
                '$.viewCountText', COALESCE(json_extract(u.value, '$.viewCountText'), json_extract(u.value, '$.channelName')),
                '$.channelName', home_neighbour_channels.name)
            ELSE json(u.value)
        END)
    FROM json_each(home_neighbour_channels.uploads) u
)
WHERE name != '' AND json_valid(uploads) AND json_array_length(uploads) > 0;

-- Elsewhere a channel is known by the name those rows or the subscription list
-- give it, else by another of its stored cards that names it properly.
-- MIN(rank) takes each channel's name from its best source.
CREATE TEMP TABLE known_channel_names AS
SELECT channel_id, name, MIN(rank) AS rank FROM (
    SELECT json_extract(j.value, '$.id') AS channel_id, json_extract(j.value, '$.name') AS name, 0 AS rank
    FROM settings s, json_each(s.value) j
    WHERE s.key = 'subscriptions' AND json_valid(s.value) AND json_type(s.value) = 'array'
    UNION ALL
    SELECT channel_id, name, 0 FROM home_channel_memory
    UNION ALL
    SELECT channel_id, name, 0 FROM home_neighbour_channels
    UNION ALL
    SELECT channel_id, json_extract(card, '$.channelName'), 1
    FROM subscription_uploads
    WHERE json_valid(card)
)
WHERE channel_id IS NOT NULL AND name IS NOT NULL AND name != ''
    AND NOT (name GLOB '[0-9]*'
        AND (name LIKE '% view' OR name LIKE '% views' OR name LIKE '% watching' OR name LIKE '% waiting'))
GROUP BY channel_id;

UPDATE subscription_uploads
SET card = json_set(
    card,
    '$.viewCountText', COALESCE(json_extract(card, '$.viewCountText'), json_extract(card, '$.channelName')),
    '$.channelName', (SELECT name FROM known_channel_names k WHERE k.channel_id = subscription_uploads.channel_id))
WHERE json_valid(card)
    AND json_extract(card, '$.channelName') GLOB '[0-9]*'
    AND (json_extract(card, '$.channelName') LIKE '% view'
        OR json_extract(card, '$.channelName') LIKE '% views'
        OR json_extract(card, '$.channelName') LIKE '% watching'
        OR json_extract(card, '$.channelName') LIKE '% waiting')
    AND EXISTS (SELECT 1 FROM known_channel_names k WHERE k.channel_id = subscription_uploads.channel_id);

UPDATE home_feed_cache
SET video = json_set(
    video,
    '$.viewCountText', COALESCE(json_extract(video, '$.viewCountText'), json_extract(video, '$.channelName')),
    '$.channelName', (SELECT name FROM known_channel_names k WHERE k.channel_id = json_extract(home_feed_cache.video, '$.channelId')))
WHERE json_valid(video)
    AND json_extract(video, '$.channelName') GLOB '[0-9]*'
    AND (json_extract(video, '$.channelName') LIKE '% view'
        OR json_extract(video, '$.channelName') LIKE '% views'
        OR json_extract(video, '$.channelName') LIKE '% watching'
        OR json_extract(video, '$.channelName') LIKE '% waiting')
    AND EXISTS (SELECT 1 FROM known_channel_names k WHERE k.channel_id = json_extract(home_feed_cache.video, '$.channelId'));

DROP TABLE known_channel_names;
