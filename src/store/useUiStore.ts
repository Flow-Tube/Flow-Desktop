import { create } from "zustand";

export type ActiveTab = "home" | "search" | "subscriptions" | "history" | "playlists" | "settings";
export type ToastVariant = "success" | "error" | "info";

export interface ToastState {
  id: number;
  title?: string;
  message: string;
  variant: ToastVariant;
  durationMs: number;
}

export interface ShowToastOptions {
  title?: string;
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
}

const getSavedSidebarExpanded = () => {
  try {
    const saved = localStorage.getItem("flow_sidebar_expanded");
    return saved === null ? true : saved === "true";
  } catch (error) {
    console.warn("Failed to load saved sidebar state", error);
    return true;
  }
};

const saveSidebarExpanded = (expanded: boolean) => {
  try {
    localStorage.setItem("flow_sidebar_expanded", String(expanded));
  } catch (error) {
    console.warn("Failed to save sidebar state", error);
  }
};

const getSavedSubsSectionCollapsed = () => {
  try {
    return localStorage.getItem("flow_sidebar_subs_collapsed") === "true";
  } catch (error) {
    console.warn("Failed to load saved subscriptions section state", error);
    return false;
  }
};

const saveSubsSectionCollapsed = (collapsed: boolean) => {
  try {
    localStorage.setItem("flow_sidebar_subs_collapsed", String(collapsed));
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
  dismissToast: () => void;
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
  showToast: ({ title, message, variant = "info", durationMs = 2400 }) => set({
    toast: {
      id: Date.now(),
      title,
      message,
      variant,
      durationMs,
    },
  }),
  dismissToast: () => set({ toast: null }),
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
