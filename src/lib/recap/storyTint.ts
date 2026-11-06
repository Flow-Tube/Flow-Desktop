import { useMemo, type CSSProperties } from "react";

import type { RecapSummary } from "../api/recap";
import { useChannelAvatar } from "../useChannelAvatar";
import { useDominantColor, type Rgb } from "../useDominantColor";
import { useProxiedImageUrl } from "../useProxiedImageUrl";
import type { StoryPage } from "./storyPages";

/** The theme's tones pages without artwork take in turn after the first; they suit light and dark alike. */
const TONES = ["blue", "teal", "amber", "purple", "green", "orange", "pink"];

const SHAPE = "color-mix(in srgb, var(--color-on-surface) 6%, transparent)";

/**
 * A colour as a page's ground, raised surface and accent. Everything is mixed with the theme's own
 * surfaces, so text in the theme's colours stays readable over any artwork.
 */
function seedTint(seed: string): CSSProperties {
  return {
    "--story-ground": `color-mix(in srgb, ${seed} 26%, var(--color-background))`,
    "--story-raised": `color-mix(in srgb, ${seed} 18%, var(--color-surface-container-high))`,
    "--story-accent": `color-mix(in srgb, ${seed} 45%, var(--color-on-surface))`,
    "--story-shape": SHAPE,
  } as CSSProperties;
}

function toneTint(tone: string): CSSProperties {
  const content = `var(--color-profile-${tone}-content)`;
  const ground = `color-mix(in srgb, var(--color-profile-${tone}-container) 70%, var(--color-background))`;
  return {
    "--story-ground": ground,
    "--story-raised": `color-mix(in srgb, ${content} 14%, ${ground})`,
    "--story-accent": content,
    "--story-shape": SHAPE,
  } as CSSProperties;
}

const asSeed = (color: Rgb | null): string | null => (color ? `rgb(${color.r} ${color.g} ${color.b})` : null);

function useArtworkSeed(url: string | undefined): string | null {
  return asSeed(useDominantColor(useProxiedImageUrl(url)));
}

/** Each page's colours: pages about a channel, video or artist take its colour, the rest the theme's. */
export function useStoryTints(pages: StoryPage[], summary: RecapSummary): CSSProperties[] {
  const channel = summary.video.topChannels[0];
  const lookedUp = useChannelAvatar(channel && !channel.imageUrl ? channel.id : null);
  const channelSeed = useArtworkSeed(channel?.imageUrl || lookedUp || undefined);
  const videoSeed = useArtworkSeed(summary.video.topVideos[0]?.imageUrl);
  const artistSeed = useArtworkSeed(summary.music.topArtists[0]?.imageUrl);
  return useMemo(() => {
    let tones = 0;
    return pages.map((page) => {
      if (page.kind === "intro") return seedTint("var(--color-primary)");
      const artwork =
        page.kind === "topChannel"
          ? channelSeed
          : page.kind === "onRepeat"
            ? videoSeed
            : page.kind === "topArtist" || page.kind === "songs"
              ? artistSeed
              : page.kind === "summary"
                ? (channelSeed ?? artistSeed)
                : null;
      return artwork ? seedTint(artwork) : toneTint(TONES[tones++ % TONES.length]!);
    });
  }, [pages, channelSeed, videoSeed, artistSeed]);
}
