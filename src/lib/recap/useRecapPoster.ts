import { useCallback, useEffect, useRef, useState } from "react";

import { useUiStore } from "../../store/useUiStore";
import type { RecapSummary } from "../api/recap";
import { saveRecapPoster } from "../api/files";
import { copyPng } from "../clipboard";
import { getString } from "../i18n/index";
import { useChannelAvatar } from "../useChannelAvatar";
import { blobToBase64, loadPosterImage, posterData, renderPosterBlob } from "./recapPoster";

/** Builds the poster once per summary, for showing, saving as a PNG and copying. */
export function useRecapPoster(summary: RecapSummary, period: string, periodLabel: string) {
  const showToast = useUiStore((state) => state.showToast);
  const channel = summary.video.topChannels[0];
  const lookedUp = useChannelAvatar(channel && !channel.imageUrl ? channel.id : null);
  const channelImage = channel?.imageUrl || lookedUp;
  const artistImage = summary.music.topArtists[0]?.imageUrl;
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const blob = useRef<Promise<Blob | null> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setFailed(false);
    const rendering = Promise.all([loadPosterImage(channelImage), loadPosterImage(artistImage)]).then(([channelPicture, artistPicture]) =>
      renderPosterBlob(posterData(summary, periodLabel), { channel: channelPicture, artist: artistPicture }),
    );
    blob.current = rendering;
    void rendering.then((rendered) => {
      if (cancelled) return;
      if (!rendered) {
        setFailed(true);
        return;
      }
      url = URL.createObjectURL(rendered);
      setPreviewUrl(url);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [summary, periodLabel, channelImage, artistImage]);

  const save = useCallback(async () => {
    const image = await blob.current;
    if (!image) return;
    try {
      const saved = await saveRecapPoster(await blobToBase64(image), `flow-recap-${period}.png`, getString("recap_story_save"));
      if (saved) showToast({ variant: "success", message: getString("recap_story_saved") });
    } catch (error) {
      console.warn("Failed to save the recap poster", error);
      showToast({ variant: "error", message: getString("recap_story_save_failed") });
    }
  }, [period, showToast]);

  const copy = useCallback(async () => {
    const pending = blob.current;
    if (!pending) return;
    const image = pending.then((rendered) => {
      if (!rendered) throw new Error("No poster to copy");
      return rendered;
    });
    const copied = await copyPng(image);
    showToast(
      copied
        ? { variant: "success", message: getString("recap_story_copied") }
        : { variant: "error", message: getString("recap_story_copy_failed") },
    );
  }, [showToast]);

  return { previewUrl, failed, save, copy };
}
