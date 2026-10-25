import { getAppMetadata } from "../../appMetadata";

export const UA_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36";

/** "Flow/<version>", the user agent the newer providers know Flow by, as on Android. */
export async function flowUserAgent(): Promise<string> {
  return `Flow/${(await getAppMetadata()).version}`;
}

export function detectMs(value: number, durationSec: number): number {
  if (value > 1000) return Math.round(value);
  if (durationSec > 0 && value > durationSec) return Math.round(value);
  return Math.round(value * 1000);
}
