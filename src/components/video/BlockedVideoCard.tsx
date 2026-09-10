import { useState } from "react";
import { EyeOff, Lock } from "lucide-react";

import { getString } from "../../lib/i18n/index";
import { hasRevealPin, useBlockedRevealStore, verifyRevealPin } from "../../lib/blockedContent";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { TextInput } from "../ui/TextInput";
import type { VideoSummary } from "../../types/video";

interface BlockedVideoCardProps {
  video: VideoSummary;
  keyword: string;
  listLayout: boolean;
}

export function BlockedVideoCard({ video, keyword, listLayout }: BlockedVideoCardProps) {
  const reveal = useBlockedRevealStore((state) => state.reveal);
  const thumbnail = useProxiedImageUrl(video.thumbnailUrl);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);

  const requestReveal = () => {
    if (!hasRevealPin()) {
      reveal(video.id);
      return;
    }
    setPinOpen(true);
  };

  const submitPin = async () => {
    if (await verifyRevealPin(pin)) {
      reveal(video.id);
      return;
    }
    setPinError(true);
  };

  return (
    <div className={listLayout ? "flex w-full gap-3" : "flex w-full flex-col gap-2"}>
      <div
        className={`relative overflow-hidden rounded-xl bg-chrome-zinc-900 ${
          listLayout ? "aspect-video w-40 shrink-0 sm:w-48" : "aspect-video w-full"
        }`}
      >
        {thumbnail && (
          <img
            src={thumbnail}
            alt=""
            aria-hidden="true"
            className="h-full w-full scale-110 object-cover blur-xl"
            loading="lazy"
            decoding="async"
          />
        )}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-chrome-black/70 px-3 text-center">
          <EyeOff size={listLayout ? 16 : 20} className="text-chrome-neutral-300" />
          <span className="text-xs font-semibold text-chrome-neutral-200">
            {getString("blocked_card_title")}
          </span>
          {!listLayout && (
            <span className="max-w-full truncate text-[11px] text-chrome-neutral-400">
              {getString("blocked_card_reason", keyword)}
            </span>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {pinOpen ? (
          <div className="flex flex-col gap-1.5">
            <TextInput
              type="password"
              value={pin}
              onChange={(value) => {
                setPin(value);
                setPinError(false);
              }}
              placeholder={getString("blocked_pin_placeholder")}
            />
            {pinError && (
              <span className="text-[11px] text-chrome-red-400">{getString("blocked_pin_wrong")}</span>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void submitPin()}
                className="rounded-full bg-chrome-white px-3 py-1 text-xs font-semibold text-chrome-black transition-colors hover:bg-chrome-neutral-200"
              >
                {getString("blocked_pin_unlock")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPinOpen(false);
                  setPin("");
                  setPinError(false);
                }}
                className="rounded-full px-3 py-1 text-xs font-semibold text-chrome-neutral-400 transition-colors hover:text-chrome-neutral-200"
              >
                {getString("blocked_pin_cancel")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={requestReveal}
            className="flex w-fit items-center gap-1.5 rounded-full border border-chrome-neutral-800 px-3 py-1 text-xs font-semibold text-chrome-neutral-300 transition-colors hover:bg-surface-container-high hover:text-chrome-neutral-100"
          >
            {hasRevealPin() && <Lock size={12} />}
            {getString("blocked_card_show")}
          </button>
        )}
      </div>
    </div>
  );
}
