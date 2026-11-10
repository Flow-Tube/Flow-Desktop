import { resetMusicBrain } from "./api/music";
import { buildSettingsBackup, extractBackupCollections, importBackupCollections } from "./settings/backup";
import { BRAINS_UPDATED_EVENT } from "./storeRefresh";

const MUSIC_COLLECTION = "music_brain";

const announce = () => window.dispatchEvent(new Event(BRAINS_UPDATED_EVENT));

/**
 * The music taste alone, as a recommendations backup holding nothing else: the normal import page
 * reads the same file, and the video engine's data never travels with it.
 */
export async function buildMusicTasteJson(): Promise<string> {
  const backup = await buildSettingsBackup("BRAIN");
  const records = backup.collections?.[MUSIC_COLLECTION] ?? [];
  return JSON.stringify({ ...backup, settings: {}, collections: { [MUSIC_COLLECTION]: records } }, null, 2);
}

/** Restores only the music taste from a backup file. Throws when the file has none. */
export async function importMusicTasteJson(text: string): Promise<void> {
  const records = extractBackupCollections(JSON.parse(text))?.[MUSIC_COLLECTION];
  if (!records?.length) throw new Error("No music profile in this file");
  await importBackupCollections({ [MUSIC_COLLECTION]: records });
  announce();
}

export async function resetMusicTaste(): Promise<void> {
  await resetMusicBrain();
  announce();
}
