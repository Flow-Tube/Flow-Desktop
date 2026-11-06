import { Copy, Download } from "lucide-react";

import { getString } from "../../../lib/i18n/index";
import type { useRecapPoster } from "../../../lib/recap/useRecapPoster";
import { Button } from "../../ui/Button";

interface StoryPosterPageProps {
  periodLabel: string;
  poster: ReturnType<typeof useRecapPoster>;
}

/** The story's last page: the period in one card, to save or copy. */
export function StoryPosterPage({ periodLabel, poster }: StoryPosterPageProps) {
  const { previewUrl, failed, save, copy } = poster;
  return (
    <>
      <h2 className="text-xl font-semibold text-on-surface">{getString("recap_story_summary", periodLabel)}</h2>
      <div className="flex aspect-[9/16] h-[min(68vh,calc(100vh-14rem))] items-center justify-center overflow-hidden rounded-2xl bg-surface-container-high">
        {previewUrl ? (
          <img src={previewUrl} alt={getString("recap_story_summary", periodLabel)} className="h-full w-full object-contain" />
        ) : (
          <p className="max-w-40 p-4 text-center text-sm text-on-surface-variant">
            {getString(failed ? "recap_story_poster_failed" : "recap_story_poster_loading")}
          </p>
        )}
      </div>
      <div className="flex gap-2" onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
        <Button variant="primary" size="sm" disabled={!previewUrl} onClick={() => void save()}>
          <Download size={14} />
          {getString("recap_story_save")}
        </Button>
        <Button variant="secondary" size="sm" disabled={!previewUrl} onClick={() => void copy()}>
          <Copy size={14} />
          {getString("recap_story_copy")}
        </Button>
      </div>
    </>
  );
}
