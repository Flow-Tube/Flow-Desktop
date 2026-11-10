import { beforeEach, describe, expect, it, vi } from 'vitest';

const resetMusicBrain = vi.fn();
const buildSettingsBackup = vi.fn();
const importBackupCollections = vi.fn();
vi.mock('./api/music', () => ({ resetMusicBrain: () => resetMusicBrain() }));
vi.mock('./storeRefresh', () => ({ BRAINS_UPDATED_EVENT: 'flow:brains-updated' }));
vi.mock('./settings/backup', () => ({
  buildSettingsBackup: (...args: unknown[]) => buildSettingsBackup(...args),
  importBackupCollections: (...args: unknown[]) => importBackupCollections(...args),
  extractBackupCollections: (value: { collections?: unknown }) => value.collections ?? null,
}));

import { buildMusicTasteJson, importMusicTasteJson, resetMusicTaste } from './musicTasteData';

describe('music taste data', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exports the music taste and nothing of the video engine or settings', async () => {
    buildSettingsBackup.mockResolvedValue({
      schemaVersion: 2,
      scope: 'BRAIN',
      settings: { theme: 'dark' },
      collections: { flow_neuro_brain: [{ a: 1 }], music_brain: [{ b: 2 }] },
    });
    const parsed = JSON.parse(await buildMusicTasteJson());
    expect(buildSettingsBackup).toHaveBeenCalledWith('BRAIN');
    expect(parsed.collections).toEqual({ music_brain: [{ b: 2 }] });
    expect(parsed.settings).toEqual({});
    expect(parsed.scope).toBe('BRAIN');
  });

  it('imports only the music taste from a file holding more', async () => {
    const heard = vi.fn();
    window.addEventListener('flow:brains-updated', heard, { once: true });
    await importMusicTasteJson(JSON.stringify({ collections: { flow_neuro_brain: [{ a: 1 }], music_brain: [{ b: 2 }] } }));
    expect(importBackupCollections).toHaveBeenCalledWith({ music_brain: [{ b: 2 }] });
    expect(heard).toHaveBeenCalled();
  });

  it('refuses a file without a music profile', async () => {
    await expect(importMusicTasteJson('{"collections":{"likes":[1]}}')).rejects.toThrow();
    await expect(importMusicTasteJson('{"collections":{"music_brain":[]}}')).rejects.toThrow();
    await expect(importMusicTasteJson('not json')).rejects.toThrow();
    expect(importBackupCollections).not.toHaveBeenCalled();
  });

  it('resets and tells the pages', async () => {
    const heard = vi.fn();
    window.addEventListener('flow:brains-updated', heard, { once: true });
    await resetMusicTaste();
    expect(resetMusicBrain).toHaveBeenCalled();
    expect(heard).toHaveBeenCalled();
  });
});
