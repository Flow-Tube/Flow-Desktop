export interface NoticeGroup {
  license: string;
  projects: string[];
}

/** Largest licence first, each project as `name version`. */
export function groupNotices(entries: readonly (readonly [string, string, string])[]): NoticeGroup[] {
  const byLicense = new Map<string, string[]>();
  for (const [name, version, license] of entries) {
    const projects = byLicense.get(license) ?? [];
    projects.push(`${name} ${version}`.trim());
    byLicense.set(license, projects);
  }
  return [...byLicense.entries()]
    .map(([license, projects]) => ({ license, projects }))
    .sort((a, b) => b.projects.length - a.projects.length || a.license.localeCompare(b.license));
}

export async function loadNotices(): Promise<NoticeGroup[]> {
  const { default: entries } = await import("./thirdPartyNotices.json");
  return groupNotices(entries as [string, string, string][]);
}
