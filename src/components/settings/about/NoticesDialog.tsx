import { useEffect, useState } from "react";

import { loadNotices, type NoticeGroup } from "../../../lib/about/notices";
import { getString } from "../../../lib/i18n/index";
import { InfoDialog } from "../../ui/InfoDialog";

export function NoticesDialog({ onClose }: { onClose: () => void }) {
  const [groups, setGroups] = useState<NoticeGroup[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    loadNotices()
      .then((loaded) => {
        if (active) setGroups(loaded);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <InfoDialog title={getString("about_notices")} closeLabel={getString("close")} onClose={onClose} wide>
      {failed ? (
        <p className="py-12 text-center text-sm text-chrome-neutral-400">{getString("about_notices_failed")}</p>
      ) : groups === null ? (
        <div className="grid h-40 place-items-center">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <div className="select-text space-y-6">
          <p className="text-sm text-chrome-neutral-400">{getString("about_notices_intro")}</p>
          {groups.map((group) => (
            <section key={group.license} className="space-y-1">
              <h3 className="text-sm font-semibold text-primary">{group.license}</h3>
              <p className="text-xs leading-relaxed text-chrome-neutral-400">{group.projects.join(", ")}</p>
            </section>
          ))}
        </div>
      )}
    </InfoDialog>
  );
}
