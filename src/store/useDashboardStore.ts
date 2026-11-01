import { create } from "zustand";

import { getDashboard, type Dashboard } from "../lib/api/linked";
import { normalizeBackendError } from "../lib/api/errors";
import { syncErrorMessage } from "../lib/syncErrors";

interface DashboardState {
  dashboard: Dashboard | null;
  error: string | null;
  loading: boolean;
  load: () => Promise<void>;
}

/** The Sync page's dashboard, loaded when its tab opens and after each sync. */
export const useDashboardStore = create<DashboardState>((set) => ({
  dashboard: null,
  error: null,
  loading: false,
  load: async () => {
    set({ loading: true, error: null });
    try {
      set({ dashboard: await getDashboard() });
    } catch (reason) {
      const { kind, message } = normalizeBackendError(reason);
      set({ error: syncErrorMessage(kind, message) });
    } finally {
      set({ loading: false });
    }
  },
}));
