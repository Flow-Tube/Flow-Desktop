import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

import { hlsProxyLoader } from "../../../lib/hlsProxyLoader";
import { useAnimatedArtwork } from "../../../lib/useAnimatedArtwork";
import { usePageVisible } from "../../../lib/usePageVisible";
import type { SongItem } from "../../../types/music";

/**
 * An album's motion artwork looping over its cover. Muted and with a player of its own, so it never
 * touches the song; it fades in on its first frame and holds still while the window is hidden.
 */
/**
 * `objectPosition` picks which part of the loop shows when it is cropped, as Immersive does for its
 * cover. While not `running`, such as behind full-screen lyrics, it holds its frame.
 */
export function AnimatedArtworkLoop({
  track,
  objectPosition = "object-center",
  running = true,
}: {
  track: SongItem;
  objectPosition?: string;
  running?: boolean;
}) {
  const { loopUrl, onFailed } = useAnimatedArtwork(track);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const visible = usePageVisible();

  useEffect(() => {
    setHasFrame(false);
    const video = videoRef.current;
    if (!video || !loopUrl) return;
    if (!Hls.isSupported()) {
      video.src = loopUrl;
      return () => {
        video.removeAttribute("src");
        video.load();
      };
    }
    const hls = new Hls({
      enableWorker: true,
      capLevelToPlayerSize: true,
      maxBufferLength: 10,
      backBufferLength: 0,
      loader: hlsProxyLoader(loopUrl) as typeof Hls.DefaultConfig.loader,
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) onFailed();
    });
    hls.loadSource(loopUrl);
    hls.attachMedia(video);
    return () => hls.destroy();
  }, [loopUrl, onFailed]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !loopUrl) return;
    if (visible && running) void video.play().catch(() => undefined);
    else video.pause();
  }, [loopUrl, visible, running]);

  if (!loopUrl) return null;

  return (
    <video
      ref={videoRef}
      muted
      loop
      autoPlay
      playsInline
      disablePictureInPicture
      aria-hidden="true"
      onPlaying={() => setHasFrame(true)}
      onError={onFailed}
      className={`absolute inset-0 h-full w-full object-cover ${objectPosition} transition-opacity duration-300 ease-out ${hasFrame ? "opacity-100" : "opacity-0"}`}
    />
  );
}
