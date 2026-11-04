import { create } from "zustand";

/** Whether a linked-devices sync is running, for indicators outside the Sync page. */
export const useSyncActivityStore = create<{ syncing: boolean }>(() => ({ syncing: false }));
