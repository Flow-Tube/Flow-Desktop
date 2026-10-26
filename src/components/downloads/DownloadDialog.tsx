import { AnimatePresence, motion } from "framer-motion";

import { useDownloadStore } from "../../store/useDownloadStore";
import { CollectionDownloadDialog } from "./dialog/CollectionDownloadDialog";
import { DownloadActivityDialog } from "./dialog/DownloadActivityDialog";
import { MusicDownloadDialog } from "./dialog/MusicDownloadDialog";
import { VideoDownloadDialog } from "./dialog/VideoDownloadDialog";
import { downloadSurfaceLayoutId } from "./surface";

export function DownloadDialog() {
  const dialog = useDownloadStore((state) => state.dialog);
  const close = useDownloadStore((state) => state.closeDialog);

  return (
    <>
      <AnimatePresence>
        {dialog ? (
          <motion.div
            key="download-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onMouseDown={close}
            className="fixed inset-0 z-[115] bg-chrome-black/70"
          />
        ) : null}
      </AnimatePresence>

      {/* Choosing dialogs fade in and out; they have no dock card to morph from. */}
      <AnimatePresence>
        {dialog?.kind === "video" ? (
          <VideoDownloadDialog key="download-video" video={dialog.video} onClose={close} />
        ) : dialog?.kind === "music" ? (
          <MusicDownloadDialog key="download-music" track={dialog.track} onClose={close} />
        ) : dialog?.kind === "collection" ? (
          <CollectionDownloadDialog key="download-collection" request={dialog.request} onClose={close} />
        ) : null}
      </AnimatePresence>

      {/* The details view morphs to and from its dock card through the shared layoutId. */}
      {dialog?.kind === "activity" ? (
        <DownloadActivityDialog id={dialog.id} onClose={close} morphId={downloadSurfaceLayoutId(dialog.id)} />
      ) : null}
    </>
  );
}
