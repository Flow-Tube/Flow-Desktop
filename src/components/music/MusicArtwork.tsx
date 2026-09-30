import { motion } from "framer-motion";
import { Music2, Loader2 } from "lucide-react";
import { upgradeMusicImageUrl } from "../../lib/thumbnails";
import { useImageFallback } from "../../lib/useImageFallback";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";

interface MusicArtworkProps {
  src?: string | null;
  alt: string;
  className?: string;

  layoutId?: string;
  loading?: boolean;
  iconClassName?: string;
}

export function MusicArtwork({
  src,
  alt,
  className,
  layoutId,
  loading = false,
  iconClassName = "h-5 w-5",
}: MusicArtworkProps) {
  const imageSrc = useProxiedImageUrl(upgradeMusicImageUrl(src));
  const { src: displaySrc, onError } = useImageFallback([imageSrc]);
  const showImage = !!displaySrc;

  return (
    <motion.div
      layoutId={layoutId}
      className={`relative overflow-hidden bg-surface-container-highest ${className ?? ""}`}
    >
      {showImage ? (
        <img
          src={displaySrc}
          alt={alt}
          loading="lazy"
          draggable={false}
          onError={onError}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="grid h-full w-full place-items-center text-chrome-neutral-500" aria-hidden>
          <Music2 className={iconClassName} />
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 grid place-items-center bg-chrome-black/40">
          <Loader2 className={`${iconClassName} animate-spin text-chrome-neutral-100`} />
        </div>
      )}
    </motion.div>
  );
}
