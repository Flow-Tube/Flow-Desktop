import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { sentenceCase } from "../../../scripts/changelog-format.mjs";
import type { ChangelogRelease } from "../../lib/about/changelog";
import { getString } from "../../lib/i18n/index";
import { SettingsGroup } from "../settings/SettingsGroup";

/** "2026-11-16" in the reader's own date style; the text as given when it isn't a date. */
export function formatReleaseDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function ReleaseSections({ release }: { release: ChangelogRelease }) {
  return (
    <div className="flex flex-col gap-5">
      {release.sections.map((section, index) => (
        <SettingsGroup key={`${section.title}-${index}`} title={sentenceCase(section.title)}>
          {section.items.map((item) => (
            <p key={item} className="px-4 py-3 text-sm leading-relaxed text-chrome-neutral-200">
              {item}
            </p>
          ))}
        </SettingsGroup>
      ))}
    </div>
  );
}

interface ReleaseNotesListProps {
  releases: ChangelogRelease[];
  /** Marks the release this install runs. */
  installedVersion?: string | null;
  /** Older releases start folded, so the newest one reads first. */
  collapsible?: boolean;
}

/**
 * Releases with their sections as segmented rows, as Flow for Android lists them. A
 * single release shows its sections alone; several get a heading each.
 */
export function ReleaseNotesList({ releases, installedVersion = null, collapsible = false }: ReleaseNotesListProps) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(releases.slice(0, 1).map((release) => release.version)));

  if (releases.length === 1) return <ReleaseSections release={releases[0]!} />;

  const toggle = (version: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });

  return (
    <div className="flex flex-col gap-6">
      {releases.map((release) => {
        const expanded = !collapsible || open.has(release.version);
        const heading = (
          <>
            <span dir="ltr" className="text-base font-medium text-chrome-neutral-100">{release.version}</span>
            {release.date && <span className="text-xs tabular-nums text-chrome-neutral-500">{formatReleaseDate(release.date)}</span>}
            {release.version === installedVersion && (
              <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-xs text-primary">
                {getString("about_changelog_installed")}
              </span>
            )}
          </>
        );
        return (
          <section key={release.version} className="flex flex-col gap-3">
            {collapsible ? (
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => toggle(release.version)}
                className="flex items-center gap-3 rounded-xl px-1 py-1 text-start transition-colors duration-200 ease-out hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {heading}
                <ChevronDown
                  className={`ms-auto h-4 w-4 shrink-0 text-chrome-neutral-400 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                />
              </button>
            ) : (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">{heading}</div>
            )}
            {expanded && <ReleaseSections release={release} />}
          </section>
        );
      })}
    </div>
  );
}
