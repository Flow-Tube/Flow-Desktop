import type { LinkedDevice } from "../api/linked";
import { getString } from "../i18n/index";

const SHORT_ID = 4;

/**
 * The start of each device's id where two devices share a name, so two installs that both default to
 * "Flow Desktop (Windows)" can be told apart when removing one (#2184). Null for a name of its own.
 */
export function shortIdsForSharedNames(
  devices: ReadonlyArray<Pick<LinkedDevice, "id" | "name">>,
): Map<string, string | null> {
  const byName = new Map<string, string[]>();
  for (const { id, name } of devices) {
    const key = name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), id]);
  }
  const shared = [...byName.values()].filter((ids) => ids.length > 1).flat();
  let length = SHORT_ID;
  while (length < SHORT_ID * 4 && new Set(shared.map((id) => id.slice(0, length))).size < shared.length) {
    length *= 2;
  }
  const sharing = new Set(shared);
  return new Map(devices.map(({ id }) => [id, sharing.has(id) ? id.slice(0, length) : null]));
}

/** Each device's name as the list and the remove confirmation show it. */
export function deviceLabels(devices: ReadonlyArray<LinkedDevice>): Map<string, string> {
  const shortIds = shortIdsForSharedNames(devices);
  return new Map(
    devices.map((device) => {
      const name = device.name.trim() || getString("linked_device_unnamed");
      const shortId = shortIds.get(device.id);
      return [device.id, shortId ? getString("linked_device_name_with_id", name, shortId) : name];
    }),
  );
}
