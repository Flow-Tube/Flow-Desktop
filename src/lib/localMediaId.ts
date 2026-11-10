/**
 * Ids for files in the folder library. A `local_<hash>` id never names a YouTube video, so every
 * online lookup, sync write and engine signal must skip it. Mirrors `local_media::is_local_id`.
 */
const LOCAL_MEDIA_ID = /^local_[0-9a-f]{16}$/;

export function isLocalMediaId(id: string | null | undefined): boolean {
  return !!id && LOCAL_MEDIA_ID.test(id);
}
