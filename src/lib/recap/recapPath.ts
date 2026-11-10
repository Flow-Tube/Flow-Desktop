/** The Recap page, opened on `period` when given. */
export function recapPath(period?: string | null): string {
  return period ? `/recap?period=${encodeURIComponent(period)}` : "/recap";
}
