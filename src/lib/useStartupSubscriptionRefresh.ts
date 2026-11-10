import { useEffect, useRef } from "react";
import { IS_MAIN_WINDOW } from "./appWindow";
import { SETTINGS } from "./settings/schema";
import { refreshSubscriptionsAtStartup } from "./useSubscriptionFeed";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useSubscriptionStore } from "../store/useSubscriptionStore";

/** Once per launch, when the viewer asked for it, checks the subscription feed in the background. */
export function useStartupSubscriptionRefresh(): void {
  const settingsLoaded = useAppSettingsStore((state) => state.loaded);
  const enabled = useAppSettingsStore((state) => state.values[SETTINGS.SUBSCRIPTION_REFRESH_ON_STARTUP] === "true");
  const ran = useRef(false);

  useEffect(() => {
    if (!IS_MAIN_WINDOW || !settingsLoaded || !enabled || ran.current) return;
    ran.current = true;
    void (async () => {
      const store = useSubscriptionStore.getState();
      if (store.subscriptions.length === 0) await store.loadSubscriptions();
      const ids = useSubscriptionStore.getState().subscriptions.map((channel) => channel.id);
      if (ids.length > 0) await refreshSubscriptionsAtStartup(ids);
    })();
  }, [settingsLoaded, enabled]);
}
