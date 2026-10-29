import { useCallback, useEffect, useState } from "react";

import {
  getBrainSnapshot,
  getFlowPersona,
  type PersonaDetails,
  type UserBrain,
} from "./api/recommendation";
import { getMusicTasteProfile } from "./api/music";
import { BRAINS_UPDATED_EVENT } from "./storeRefresh";
import { useEventVersion } from "./useEventVersion";
import type { MusicTasteProfile } from "../types/music";

export function usePersonaData() {
  const [brain, setBrain] = useState<UserBrain | null>(null);
  const [persona, setPersona] = useState<PersonaDetails | null>(null);
  const [musicProfile, setMusicProfile] = useState<MusicTasteProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const brainsVersion = useEventVersion(BRAINS_UPDATED_EVENT);

  const refresh = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    try {
      const snapshot = await getBrainSnapshot(force);
      setBrain(snapshot);
      const personaDetails = await getFlowPersona();
      setPersona(personaDetails);
      setFailed(false);
    } catch (e) {
      console.error("Failed to load recommendation telemetry:", e);
      setFailed(true);
    }

    try {
      const tasteProfile = await getMusicTasteProfile();
      setMusicProfile(tasteProfile);
    } catch (e) {
      console.error("Failed to load music taste profile:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, brainsVersion]);

  return { brain, persona, musicProfile, loading, refreshing, failed, refresh };
}
