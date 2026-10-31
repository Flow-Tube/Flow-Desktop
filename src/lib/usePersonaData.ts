import { useCallback, useEffect, useState } from "react";

import {
  getBrainSnapshot,
  getFlowPersona,
  getProfileInterests,
  type PersonaDetails,
  type UserBrain,
} from "./api/recommendation";
import { getMusicTasteProfile } from "./api/music";
import { BRAINS_UPDATED_EVENT } from "./storeRefresh";
import { useEventVersion } from "./useEventVersion";
import type { MusicTasteProfile } from "../types/music";

/** The running profile's brains, or with `profile` another profile's, read only. */
export function usePersonaData(profile: string | null = null) {
  const [brain, setBrain] = useState<UserBrain | null>(null);
  const [persona, setPersona] = useState<PersonaDetails | null>(null);
  const [musicProfile, setMusicProfile] = useState<MusicTasteProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const brainsVersion = useEventVersion(BRAINS_UPDATED_EVENT);

  const refresh = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    if (profile) {
      try {
        const interests = await getProfileInterests(profile);
        setBrain(interests.brain);
        setPersona(interests.persona);
        setMusicProfile(interests.music);
        setFailed(false);
      } catch (e) {
        console.error("Failed to load another profile's interests:", e);
        setFailed(true);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
      return;
    }
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
  }, [profile]);

  useEffect(() => {
    void refresh();
  }, [refresh, brainsVersion]);

  return { brain, persona, musicProfile, loading, refreshing, failed, refresh };
}
