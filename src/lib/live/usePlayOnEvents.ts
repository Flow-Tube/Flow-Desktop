import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { isTauriEnv } from "../api/env";
import { IS_MAIN_WINDOW } from "../appWindow";
import { usePlayOnStore } from "../../store/usePlayOnStore";

/** Takes handoffs and remote commands from the group's other devices while the app is open. */
export function usePlayOnEvents(): void {
  const navigate = useNavigate();
  useEffect(() => {
    let stop: (() => void) | null = null;
    let ended = false;
    void isTauriEnv().then(async (tauri) => {
      if (!tauri || !IS_MAIN_WINDOW) return;
      const stopping = await usePlayOnStore.getState().init((videoId) => navigate(`/watch/${videoId}`));
      if (ended) stopping();
      else stop = stopping;
    });
    return () => {
      ended = true;
      stop?.();
    };
  }, [navigate]);
}
