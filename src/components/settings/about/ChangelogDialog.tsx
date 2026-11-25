import { useEffect, useState } from "react";

import { loadChangelog, type ChangelogRelease } from "../../../lib/about/changelog";
import { getString } from "../../../lib/i18n/index";
import { InfoDialog } from "../../ui/InfoDialog";
import { ReleaseNotesList } from "../../updater/ReleaseNotesList";

export function ChangelogDialog({ installedVersion, onClose }: { installedVersion: string | null; onClose: () => void }) {
  const [releases, setReleases] = useState<ChangelogRelease[] | null>(null);

  useEffect(() => {
    let active = true;
    loadChangelog()
      .then((loaded) => {
        if (active) setReleases(loaded);
      })
      .catch(() => {
        if (active) setReleases([]);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <InfoDialog title={getString("about_changelog")} closeLabel={getString("close")} onClose={onClose} wide>
      {releases === null ? (
        <div className="grid h-40 place-items-center">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : releases.length === 0 ? (
        <p className="py-12 text-center text-sm text-chrome-neutral-400">{getString("about_changelog_empty")}</p>
      ) : (
        <div className="select-text">
          <ReleaseNotesList releases={releases} installedVersion={installedVersion} />
        </div>
      )}
    </InfoDialog>
  );
}
