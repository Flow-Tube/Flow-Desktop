import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Heart } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { Button } from "../ui/Button";
import {
  DONATION_PROMPT_SHOW_DELAY_MS,
  disableDonationPrompt,
  evaluateDonationPrompt,
  markDonationPromptShown,
} from "../../lib/donationPrompt";

export function DonationPromptHost({ enabled }: { enabled: boolean }) {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const evaluatedRef = useRef(false);

  useEffect(() => {
    if (!enabled || evaluatedRef.current) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      evaluatedRef.current = true;
      try {
        if (await evaluateDonationPrompt()) {
          if (!cancelled) setVisible(true);
        }
      } catch (error) {
        console.warn("Failed to evaluate donation prompt", error);
      }
    }, DONATION_PROMPT_SHOW_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled]);

  if (!visible) return null;

  const handleSupport = () => {
    setVisible(false);
    void markDonationPromptShown();
    navigate("/support");
  };

  const handleLater = () => {
    setVisible(false);
    void markDonationPromptShown();
  };

  const handleNever = () => {
    setVisible(false);
    void disableDonationPrompt();
  };

  return (
    <DonationPromptDialog
      onSupport={handleSupport}
      onLater={handleLater}
      onNever={handleNever}
    />
  );
}

function DonationPromptDialog({
  onSupport,
  onLater,
  onNever,
}: {
  onSupport: () => void;
  onLater: () => void;
  onNever: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onLater();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onLater]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-chrome-black/70 p-4"
      onClick={onLater}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="donation-prompt-title"
        onClick={(event) => event.stopPropagation()}
        className="animate-fade-in w-full max-w-sm rounded-2xl border border-chrome-neutral-800 bg-surface-container p-6"
      >
        <div className="flex flex-col items-center text-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-surface-container-high">
            <Heart className="h-8 w-8 text-[var(--color-primary)]" />
          </span>

          <h2
            id="donation-prompt-title"
            className="mt-5 text-xl font-bold tracking-tight text-chrome-neutral-100"
          >
            {getString("donation_prompt_title")}
          </h2>

          <p className="mt-2 text-sm leading-relaxed text-chrome-neutral-400">
            {getString("donation_prompt_message")}
          </p>

          <span className="mt-4 rounded-full bg-surface-container-low px-3 py-1.5 text-xs font-medium text-chrome-neutral-400">
            {getString("donation_prompt_methods")}
          </span>
        </div>

        <div className="mt-6 flex flex-col gap-1.5">
          <Button onClick={onSupport} className="font-semibold">
            <Heart className="h-4 w-4" />
            {getString("donation_prompt_support")}
          </Button>

          <Button variant="ghost" onClick={onLater}>
            {getString("donation_prompt_later")}
          </Button>

          <Button variant="ghost" onClick={onNever} className="text-chrome-neutral-500 hover:text-chrome-neutral-300">
            {getString("donation_prompt_never")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default DonationPromptHost;
