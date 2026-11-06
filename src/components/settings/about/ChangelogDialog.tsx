import { useEffect, useState } from "react";

import { loadChangelog, type ChangelogRelease } from "../../../lib/about/changelog";
import { getString } from "../../../lib/i18n/index";
import { InfoDialog } from "../../ui/InfoDialog";

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
        <div className="select-text space-y-8">
          {releases.map((release) => (
            <section key={release.version} className="space-y-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-base font-medium text-chrome-neutral-100">{release.version}</h3>
                {release.date && <span className="text-xs tabular-nums text-chrome-neutral-500">{release.date}</span>}
                {release.version === installedVersion && (
                  <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-xs text-primary">
                    {getString("about_changelog_installed")}
                  </span>
                )}
              </div>
              {release.sections.map((section) => (
                <div key={section.title} className="space-y-1">
                  <h4 className="text-xs font-semibold text-chrome-neutral-500">{section.title}</h4>
                  <ul className="list-disc space-y-1 ps-5 text-sm text-chrome-neutral-300">
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </InfoDialog>
  );
}
