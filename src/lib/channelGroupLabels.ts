import { getString } from "./i18n/index";

export function channelCountLabel(count: number): string {
  return getString("subscriptions_groups_channels", count);
}
