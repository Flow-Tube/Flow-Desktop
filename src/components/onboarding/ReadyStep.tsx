import { Check } from "lucide-react";
import { getPlural, getString } from "../../lib/i18n/index";
import { useFavouriteArtistsStore } from "../../store/useFavouriteArtistsStore";
import { useSubscriptionStore } from "../../store/useSubscriptionStore";

/** All set, with what was chosen on the way. */
export function ReadyStep({ interestCount }: { interestCount: number }) {
  const channelCount = useSubscriptionStore((state) => state.subscriptions.length);
  const artistCount = useFavouriteArtistsStore((state) => state.picked.length);
  const facts = [
    interestCount > 0 && getPlural("onboarding_ready_interests", interestCount),
    channelCount > 0 && getPlural("onboarding_ready_channels", channelCount),
    artistCount > 0 && getPlural("onboarding_ready_artists", artistCount),
  ].filter((fact): fact is string => Boolean(fact));

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
      <span className="mb-8 grid h-16 w-16 place-items-center rounded-full bg-surface-container-high text-primary">
        <Check size={32} />
      </span>
      <h1 className="mb-3 text-5xl font-semibold tracking-tight text-chrome-neutral-100">
        {getString("onboarding_ready_title")}
      </h1>
      <p className="text-lg text-chrome-neutral-400">{getString("onboarding_ready_subtitle")}</p>
      {facts.length > 0 && <p className="mt-4 text-sm tabular-nums text-chrome-neutral-400">{facts.join(" · ")}</p>}
    </div>
  );
}
