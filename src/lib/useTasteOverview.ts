import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearChannelMemory,
  forgetRememberedChannel,
  getTasteOverview,
  resolveHiddenChannelNames,
  type NamedChannel,
  type TasteOverview,
} from "./api/recommendation";
import type { StringKey } from "./i18n/index";

const OFTEN_WATCHED = 8;
const SOMETIMES_WATCHED = 3;

/** How often the viewer watched an interest, in words. */
export function evidenceLabel(evidence: number): StringKey {
  if (evidence >= OFTEN_WATCHED) return "taste_evidence_often";
  if (evidence >= SOMETIMES_WATCHED) return "taste_evidence_some";
  if (evidence > 0) return "taste_evidence_once";
  return "taste_evidence_none";
}

/** Named channels by name, then the ones without a name yet by id. */
export function hiddenChannelOrder(channels: NamedChannel[]): NamedChannel[] {
  const named = channels.filter((c) => c.name).sort((a, b) => a.name.localeCompare(b.name));
  const unnamed = channels.filter((c) => !c.name).sort((a, b) => a.id.localeCompare(b.id));
  return [...named, ...unnamed];
}

const EMPTY: TasteOverview = { picks: [], groups: [], hiddenChannels: [], rememberedChannels: [] };

/** Your taste as the engine reads it: picks, learned groups and hidden channels. */
export function useTasteOverview() {
  const [overview, setOverview] = useState<TasteOverview>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [resolvingNames, setResolvingNames] = useState(false);
  const requestRef = useRef(0);

  // Names this device lacks are looked up after the page shows, and the list sorts once they arrive.
  const resolveNames = useCallback(async (request: number, channels: NamedChannel[]) => {
    const missing = channels.filter((c) => !c.name).map((c) => c.id);
    if (missing.length === 0) return;
    setResolvingNames(true);
    try {
      const names = await resolveHiddenChannelNames(missing);
      if (request !== requestRef.current) return;
      setOverview((current) => ({
        ...current,
        hiddenChannels: hiddenChannelOrder(
          current.hiddenChannels.map((c) => ({ ...c, name: names[c.id] ?? c.name })),
        ),
      }));
    } catch (error) {
      console.warn("Failed to look up hidden channel names", error);
    } finally {
      if (request === requestRef.current) setResolvingNames(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setResolvingNames(false);
    try {
      const next = await getTasteOverview();
      if (request !== requestRef.current) return;
      setOverview(next);
      setFailed(false);
      setLoading(false);
      void resolveNames(request, next.hiddenChannels);
    } catch (error) {
      console.error("Failed to load the taste overview", error);
      if (request === requestRef.current) setFailed(true);
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [resolveNames]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const [forgetting, setForgetting] = useState<string | null>(null);

  /** Forgets one remembered channel, or all of them with "all", then reads the taste again. */
  const forget = useCallback(
    async (channelId: string | "all") => {
      setForgetting(channelId);
      try {
        await (channelId === "all" ? clearChannelMemory() : forgetRememberedChannel(channelId));
        await refresh();
      } catch (error) {
        console.error("Failed to forget a remembered channel", error);
      } finally {
        setForgetting(null);
      }
    },
    [refresh],
  );

  return { overview, loading, failed, resolvingNames, refresh, forgetting, forget };
}
