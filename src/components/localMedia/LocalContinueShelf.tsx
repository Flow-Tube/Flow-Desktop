import { useNavigate } from "react-router-dom";

import type { LocalMediaFile } from "../../lib/api/localMedia";
import { getString } from "../../lib/i18n/index";
import type { PlaysById } from "../../lib/localMedia/filters";
import { playLocalFiles } from "../../lib/localMedia/playback";
import { LocalFileCard } from "./LocalFileCard";

export function LocalContinueShelf({ files, plays, nowMs }: { files: LocalMediaFile[]; plays: PlaysById; nowMs: number }) {
  const navigate = useNavigate();
  if (files.length === 0) return null;
  return (
    <section className="min-w-0">
      <h2 className="mb-3 text-base font-medium text-chrome-neutral-100">{getString("local_continue_watching")}</h2>
      <div className="hide-scrollbar flex snap-x gap-4 overflow-x-auto pb-1">
        {files.map((file, index) => (
          <div key={file.id} className="w-64 shrink-0 snap-start">
            <LocalFileCard file={file} plays={plays} nowMs={nowMs} onPlay={() => playLocalFiles(files, index, navigate)} />
          </div>
        ))}
      </div>
    </section>
  );
}
