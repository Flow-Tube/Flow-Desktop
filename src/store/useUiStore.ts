import { create } from "zustand";
import { profileStorage } from "../lib/storage/profileStorage";

export type ActiveTab = "home" | "search" | "subscriptions" | "history" | "playlists" | "settings";
export type ToastVariant = "success" | "error" | "info";

export type ToastImageShape = "landscape" | "square" | "portrait";

/** A button on the toast, such as Undo or View; pressing it also dismisses the toast. */
export interface ToastAction {
  label: string;
  onSelect?: () => void;
  /** A route to open, such as the list the item was saved to. */
  to?: string;
}

export interface ToastState {
  id: number;
  title?: string;
  message: string;
  variant: ToastVariant;
  durationMs: number;
  actions: ToastAction[];
  /** A thumbnail or cover shown at the start of the toast. */
  image?: string | null;
  imageShape?: ToastImageShape;
}

export interface ShowToastOptions {
  title?: string;
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
  /** At most two; the last one is drawn as the main action. */
  actions?: ToastAction[];
  image?: string | null;
  imageShape?: ToastImageShape;
}

/** Long enough to reach a button, which is also why hovering pauses the timer. */
export const TOAST_DURATION_MS = 3000;
export const TOAST_WITH_ACTIONS_DURATION_MS = 5000;
const MAX_TOAST_ACTIONS = 2;

let nextToastId = 0;

const getSavedSidebarExpanded = () => {
  try {
    const saved = profileStorage.getItem("flow_sidebar_expanded");
    return saved === null ? true : saved === "true";
  } catch (error) {
    console.warn("Failed to load saved sidebar state", error);
    return true;
  }
};

const saveSidebarExpanded = (expanded: boolean) => {
  try {
    profileStorage.setItem("flow_sidebar_expanded", String(expanded));
  } catch (error) {
    console.warn("Failed to save sidebar state", error);
  }
};

const getSavedSubsSectionCollapsed = () => {
  try {
    return profileStorage.getItem("flow_sidebar_subs_collapsed") === "true";
  } catch (error) {
    console.warn("Failed to load saved subscriptions section state", error);
    return false;
  }
};

const saveSubsSectionCollapsed = (collapsed: boolean) => {
  try {
    profileStorage.setItem("flow_sidebar_subs_collapsed", String(collapsed));
  } catch (error) {
    console.warn("Failed to save subscriptions section state", error);
  }
};

interface UiState {
  activeTab: ActiveTab;
  searchQuery: string;
  isSearching: boolean;
  isSidebarExpanded: boolean;
  isWatchSidebarOpen: boolean;
  isSubsSectionCollapsed: boolean;
  toast: ToastState | null;
  setActiveTab: (tab: ActiveTab) => void;
  setSearchQuery: (query: string) => void;
  setIsSearching: (isSearching: boolean) => void;
  setWatchSidebarOpen: (open: boolean) => void;
  showToast: (toast: ShowToastOptions) => void;
  /** With an id, only dismisses that toast, so a toast on its way out cannot close a newer one. */
  dismissToast: (id?: number) => void;
  toggleSidebar: () => void;
  toggleWatchSidebar: () => void;
  toggleSubsSection: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: "home",
  searchQuery: "",
  isSearching: false,
  isSidebarExpanded: getSavedSidebarExpanded(),
  isWatchSidebarOpen: false,
  isSubsSectionCollapsed: getSavedSubsSectionCollapsed(),
  toast: null,

  setActiveTab: (activeTab) => set({ activeTab }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setIsSearching: (isSearching) => set({ isSearching }),
  setWatchSidebarOpen: (isWatchSidebarOpen) => set({ isWatchSidebarOpen }),
  showToast: ({ title, message, variant = "info", durationMs, actions = [], image, imageShape }) => set({
    toast: {
      id: ++nextToastId,
      title,
      message,
      variant,
      durationMs: durationMs ?? (actions.length > 0 ? TOAST_WITH_ACTIONS_DURATION_MS : TOAST_DURATION_MS),
      actions: actions.slice(-MAX_TOAST_ACTIONS),
      image,
      imageShape,
    },
  }),
  dismissToast: (id) => set((state) => (id === undefined || state.toast?.id === id ? { toast: null } : state)),
  toggleSubsSection: () => set((state) => {
    const isSubsSectionCollapsed = !state.isSubsSectionCollapsed;
    saveSubsSectionCollapsed(isSubsSectionCollapsed);
    return { isSubsSectionCollapsed };
  }),
  toggleSidebar: () => set((state) => {
    const isSidebarExpanded = !state.isSidebarExpanded;
    saveSidebarExpanded(isSidebarExpanded);
    return { isSidebarExpanded };
  }),
  toggleWatchSidebar: () => set((state) => ({ isWatchSidebarOpen: !state.isWatchSidebarOpen })),
}));
