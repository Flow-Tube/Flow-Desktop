import type { ComponentType } from "react";
import { create } from "zustand";

export interface ConfirmItem {
  title: string;
  subtitle?: string | null;
  image?: string | null;
}

export interface ConfirmRequest {
  title: string;
  message: string;
  /** Defaults to a bin for destructive questions and an alert otherwise. */
  icon?: ComponentType<{ className?: string }>;
  item?: ConfirmItem;
  confirmLabel?: string;
  destructive?: boolean;
}

interface PendingConfirm extends ConfirmRequest {
  id: number;
  resolve: (confirmed: boolean) => void;
}

interface ConfirmState {
  pending: PendingConfirm | null;
  ask: (request: ConfirmRequest) => Promise<boolean>;
  answer: (confirmed: boolean) => void;
}

let nextId = 0;

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  pending: null,
  ask: (request) => new Promise<boolean>((resolve) => {
    // Only one question shows at a time; one it replaces counts as declined.
    get().pending?.resolve(false);
    set({ pending: { ...request, id: ++nextId, resolve } });
  }),
  answer: (confirmed) => {
    const { pending } = get();
    if (!pending) return;
    set({ pending: null });
    pending.resolve(confirmed);
  },
}));
