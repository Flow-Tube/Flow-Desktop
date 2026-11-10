import { useRef, useState, type ChangeEvent } from "react";
import { RotateCcw } from "lucide-react";

import { confirmAction } from "../../../lib/dialogs";
import { getString, type StringKey } from "../../../lib/i18n/index";
import { buildMusicTasteJson, importMusicTasteJson, resetMusicTaste } from "../../../lib/musicTasteData";
import { saveJsonFile } from "../../../lib/saveJsonFile";
import { useUiStore } from "../../../store/useUiStore";
import { Button } from "../../ui/Button";
import { SettingItem } from "../SettingItem";
import { TasteSection } from "./TasteSection";

/** Export, import and reset the music taste, on its own and apart from the video profile. */
export function TasteMusicData() {
  const showToast = useUiStore((state) => state.showToast);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const run = async (action: () => Promise<boolean>, done: StringKey, failed: StringKey) => {
    setBusy(true);
    try {
      if (await action()) showToast({ variant: "success", message: getString(done) });
    } catch (error) {
      console.error("Music profile action failed", error);
      showToast({ variant: "error", message: getString(failed) });
    } finally {
      setBusy(false);
    }
  };

  const exportProfile = () =>
    run(
      async () => {
        const name = `flow_music_profile_${new Date().toISOString().slice(0, 10)}.json`;
        return saveJsonFile(getString("taste_export_music"), name, await buildMusicTasteJson());
      },
      "taste_export_music_done",
      "taste_export_music_failed",
    );

  const importProfile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void run(
      async () => {
        await importMusicTasteJson(await file.text());
        return true;
      },
      "taste_import_music_done",
      "taste_import_music_failed",
    );
  };

  const resetProfile = async () => {
    const confirmed = await confirmAction({
      title: getString("taste_reset_music_title"),
      message: getString("taste_reset_music_body"),
      icon: RotateCcw,
      confirmLabel: getString("taste_reset_music_action"),
      destructive: true,
    });
    if (!confirmed) return;
    await run(
      async () => {
        await resetMusicTaste();
        return true;
      },
      "taste_reset_music_done",
      "taste_reset_music_failed",
    );
  };

  return (
    <TasteSection title={getString("taste_music_data_title")} description={getString("taste_music_data_desc")}>
      <div className="flex flex-col divide-y divide-chrome-neutral-800/50">
        <SettingItem title={getString("taste_export_music")} description={getString("taste_export_music_desc")}>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void exportProfile()}>
            {getString("taste_export_music_action")}
          </Button>
        </SettingItem>
        <SettingItem title={getString("taste_import_music")} description={getString("taste_import_music_desc")}>
          <input ref={fileInput} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={importProfile} />
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>
            {getString("taste_import_music_action")}
          </Button>
        </SettingItem>
        <SettingItem title={getString("taste_reset_music")} description={getString("taste_reset_music_desc")}>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void resetProfile()}>
            {getString("taste_reset_music_action")}
          </Button>
        </SettingItem>
      </div>
    </TasteSection>
  );
}
