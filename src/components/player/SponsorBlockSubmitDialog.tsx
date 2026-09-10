import { useState } from "react";
import { ArrowUpDown, Loader2 } from "lucide-react";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useUiStore } from "../../store/useUiStore";
import { submitSponsorBlockSegment } from "../../lib/api/foss";
import { getBackendErrorMessage } from "../../lib/api/errors";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";
import { Select } from "../ui/Select";
import { SponsorBlockIcon } from "../ui/SponsorBlockIcon";
import { SB_SUBMIT_CATEGORIES } from "../../lib/sponsorBlockCategories";

function formatTimestamp(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const t = Math.floor(totalSeconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/** Parse a `ss`, `mm:ss`, or `hh:mm:ss` timestamp into seconds. Returns null if malformed. */
function parseTimestamp(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":").map((part) => part.trim());
  const nums = parts.map(Number);
  if (nums.some((num) => !Number.isFinite(num) || num < 0)) return null;
  switch (nums.length) {
    case 1:
      return nums[0]!;
    case 2:
      return nums[0]! * 60 + nums[1]!;
    case 3:
      return nums[0]! * 3600 + nums[1]! * 60 + nums[2]!;
    default:
      return null;
  }
}

export interface SponsorBlockSubmitDialogProps {
  videoId: string;
  currentSeconds: number;
  onClose: () => void;
}

export function SponsorBlockSubmitDialog({
  videoId,
  currentSeconds,
  onClose,
}: SponsorBlockSubmitDialogProps) {
  const sbUserId = useSettingsStore((state) => state.sbUserId);
  const setSbUserId = useSettingsStore((state) => state.setSbUserId);
  const serverUrl = useSettingsStore((state) => state.serverUrl);
  const showToast = useUiStore((state) => state.showToast);

  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState(() => formatTimestamp(currentSeconds));
  const [category, setCategory] = useState("sponsor");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const swapTimes = () => {
    setStartTime(endTime);
    setEndTime(startTime);
    setError(null);
  };

  const handleSubmit = async () => {
    const start = parseTimestamp(startTime);
    const end = parseTimestamp(endTime);
    if (start === null) {
      setError("Enter a valid start time, e.g. 1:30.");
      return;
    }
    if (end === null || end <= start) {
      setError("End time must be after the start time.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      let userId = sbUserId.trim();
      if (userId.length < 8) {
        userId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        await setSbUserId(userId);
      }
      await submitSponsorBlockSegment({
        videoId,
        startTime: start,
        endTime: end,
        category,
        userId,
        serverUrl,
      });
      showToast({ variant: "success", message: "Segment submitted to SponsorBlock" });
      onClose();
    } catch (submitError) {
      setError(getBackendErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-chrome-black/70 p-4"
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-chrome-neutral-800 bg-surface-container p-6 text-left"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center gap-2.5">
          <SponsorBlockIcon className="h-5 w-5 text-[var(--color-primary)]" />
          <h2 className="text-lg font-semibold text-chrome-neutral-100">Submit segment</h2>
        </div>

        <div className="flex items-end gap-2">
          <label className="flex-1 space-y-1.5">
            <span className="block text-xs font-medium text-chrome-neutral-400">Start</span>
            <TextInput
              value={startTime}
              onChange={(value) => {
                setStartTime(value);
                setError(null);
              }}
              placeholder="0:00"
              className="w-full"
            />
          </label>
          <button
            type="button"
            onClick={swapTimes}
            title="Swap start and end"
            className="mb-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-chrome-neutral-800 text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-200"
          >
            <ArrowUpDown size={16} />
          </button>
          <label className="flex-1 space-y-1.5">
            <span className="block text-xs font-medium text-chrome-neutral-400">End</span>
            <TextInput
              value={endTime}
              onChange={(value) => {
                setEndTime(value);
                setError(null);
              }}
              placeholder="0:00"
              className="w-full"
            />
          </label>
        </div>

        <div className="mt-4 space-y-1.5">
          <span className="block text-xs font-medium text-chrome-neutral-400">Category</span>
          <Select value={category} onChange={setCategory} options={SB_SUBMIT_CATEGORIES} className="w-full" />
        </div>

        {error && <p className="mt-3 text-xs text-chrome-red-400">{error}</p>}

        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="text-[11px] leading-tight text-chrome-neutral-500">
            Submitted publicly to the SponsorBlock database.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting} className="min-w-20">
              {submitting ? <Loader2 size={16} className="animate-spin" /> : "Submit"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
