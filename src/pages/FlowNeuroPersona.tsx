import {
  unblockTopic,
  resetBrain,
  importBrain,
  type UserBrain,
} from "../lib/api/recommendation";
import { usePersonaData } from "../lib/usePersonaData";
import { leaveGroupFirst } from "../lib/linked/leaveFirst";
import { clearHomeFeed } from "../lib/api/homeFeed";
import { useFeedActionsStore } from "../store/useFeedActionsStore";

import { SkeletonLoader } from "../components/persona/SkeletonLoader";
import { PersonaOverview } from "../components/persona/PersonaOverview";
import { LearningStats } from "../components/persona/LearningStats";
import { TasteShape } from "../components/persona/TasteShape";
import { InterestWeights } from "../components/persona/InterestWeights";
import { TimePatterns } from "../components/persona/TimePatterns";
import { ChannelMemory } from "../components/persona/ChannelMemory";
import { BlockedContent } from "../components/persona/BlockedContent";
import { MusicTasteOverview } from "../components/persona/MusicTasteOverview";
import { MusicTopArtists } from "../components/persona/MusicTopArtists";
import { MusicGenreAffinity } from "../components/persona/MusicGenreAffinity";
import { MusicListeningPatterns } from "../components/persona/MusicListeningPatterns";
import { MusicBlockedArtists } from "../components/persona/MusicBlockedArtists";
import { LearningActivity } from "../components/persona/LearningActivity";
import { ProfileData } from "../components/persona/ProfileData";

import { RefreshCw, BrainCog  } from "lucide-react";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { getString } from "../lib/i18n/index";
import { interestChoices } from "../lib/linked/interestChoices";
import { useLinkedProfiles } from "../lib/linked/useLinkedProfiles";
import { profileDisplayName } from "../lib/profiles/display";
import { useProfilesStore } from "../store/useProfilesStore";
import { Select } from "../components/ui/Select";

/** Which profile's interests to show: `?profile=` names a synced profile other than the running one. */
function useViewedProfile() {
  const [params, setParams] = useSearchParams();
  const view = useProfilesStore((state) => state.view);
  const loadProfiles = useProfilesStore((state) => state.load);
  const { profiles: linked } = useLinkedProfiles();
  useEffect(() => {
    if (!view) void loadProfiles();
  }, [view, loadProfiles]);
  const choices = view && linked ? interestChoices(view, linked.local) : [];
  const requested = params.get("profile");
  const viewing = choices.find((profile) => profile.id === requested && profile.id !== view?.activeId) ?? null;
  const choose = (id: string) => setParams(id === view?.activeId ? {} : { profile: id });
  return { choices, viewing, choose, activeId: view?.activeId ?? "" };
}

export function FlowNeuroPersona() {
  const { choices, viewing, choose, activeId } = useViewedProfile();
  const readOnly = viewing !== null;
  const { brain, persona, musicProfile, loading, refreshing, failed, refresh } = usePersonaData(viewing?.id ?? null);

  const handleUnblockTopic = async (topic: string) => {
    try {
      await unblockTopic(topic);
      await refresh(true);
    } catch (e) {
      console.error("Failed to unblock topic:", e);
    }
  };

  const handleUnblockChannel = async (channelId: string) => {
    try {
      await useFeedActionsStore.getState().unblockChannel(channelId);
      await refresh(true);
    } catch (e) {
      console.error("Failed to unblock channel:", e);
    }
  };

  const handleImportBrain = async (importedBrain: UserBrain) => {
    try {
      await importBrain(importedBrain);
      await refresh(true);
    } catch (e) {
      console.error("Failed to import brain:", e);
      throw e;
    }
  };

  const handleResetBrain = async () => {
    try {
      if (!(await leaveGroupFirst())) return;
      await resetBrain();
      await clearHomeFeed();
      await refresh(true);
    } catch (e) {
      console.error("Failed to reset brain:", e);
      throw e;
    }
  };

  if (loading && !brain) {
    return (
      <div className="flex-grow h-full overflow-y-auto bg-[var(--color-background)]">
        <div className="grid grid-cols-12 gap-6 mx-auto p-8">
          <div className="col-span-12 flex items-center justify-between">
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-on-surface)] flex items-center gap-3">
              <BrainCog className="h-7 w-7 text-[var(--color-primary)] animate-pulse" />
               {getString("persona_title")}
            </h1>
          </div>
          <div className="col-span-12">
            <SkeletonLoader />
          </div>
        </div>
      </div>
    );
  }

  if (!brain) {
    return (
      <div className="flex-grow h-full overflow-y-auto bg-[var(--color-background)]">
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-8 pt-24 text-center">
          <BrainCog className="h-8 w-8 text-[var(--color-on-surface-variant)]" />
          <h1 className="text-lg font-semibold text-[var(--color-on-surface)]">
            {getString("persona_load_failed_title")}
          </h1>
          <p className="text-sm text-[var(--color-on-surface-variant)]">
            {getString(failed ? "persona_load_failed_body" : "persona_load_empty_body")}
          </p>
          <button
            onClick={() => refresh(true)}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-full border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-high)] px-4 py-2.5 text-xs font-semibold text-[var(--color-on-surface)] transition-colors hover:bg-[var(--color-surface-container-highest)] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {getString("persona_load_retry")}
          </button>
        </div>
      </div>
    );
  }

  const activeBrain = brain;

  return (
    <div className="flex-grow h-full overflow-y-auto">
      <div className="grid grid-cols-12 gap-6 mx-auto p-8 animate-pane-in">
        {/* Page Header */}
        <div className="col-span-12 flex items-center justify-between gap-4 border-b border-[var(--color-outline-variant)] pb-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-on-surface)] flex items-center gap-3">
              {getString("persona_title")}
            </h1>
            <p className="text-sm text-[var(--color-on-surface-variant)] mt-1">
              {viewing ? getString("persona_read_only", profileDisplayName(viewing)) : getString("persona_subtitle")}
            </p>
          </div>

          {choices.length > 1 && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs font-semibold text-[var(--color-on-surface-variant)]">
                {getString("persona_profile_label")}
              </span>
              <Select
                value={viewing?.id ?? activeId}
                onChange={choose}
                options={choices.map((profile) => ({ value: profile.id, label: profileDisplayName(profile) }))}
              />
            </div>
          )}

          <button
            onClick={() => refresh(true)}
            disabled={refreshing}
            className="flex items-center gap-2 bg-[var(--color-surface-container-high)] hover:bg-[var(--color-surface-container-highest)] disabled:opacity-50 text-[var(--color-on-surface)] py-2.5 px-4 rounded-full text-xs font-semibold border border-[var(--color-outline-variant)] transition-colors active:scale-95 cursor-pointer shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-[var(--color-primary)]" : ""}`} />
            {getString(refreshing ? "persona_refreshing" : "persona_sync")}
          </button>
        </div>

        {/* Top Overview Card */}
        <div className="col-span-12">
          <PersonaOverview brain={activeBrain} persona={persona} />
        </div>

        {/* Counter Telemetry Grid */}
        <div className="col-span-12">
          <LearningStats brain={activeBrain} />
        </div>

        {/* Two Columns for Complex Analytics Charts */}
        <div className="col-span-12 md:col-span-5">
          <TasteShape brain={activeBrain} />
        </div>
        <div className="col-span-12 md:col-span-7">
          <InterestWeights brain={activeBrain} />
        </div>

        {/* Hourly Context Patterns */}
        <div className="col-span-12">
          <TimePatterns brain={activeBrain} />
        </div>

        {/* Creator Memories & Blocked Filters */}
        <div className="col-span-12 lg:col-span-6">
          <ChannelMemory brain={activeBrain} />
        </div>

        {/* Blocked Filters Section (rendered conditionally if blocks exist) */}
        {(activeBrain.blocked_topics?.length > 0 || activeBrain.blocked_channels?.length > 0) && (
          <div className="col-span-12 lg:col-span-6">
            <BlockedContent
              brain={activeBrain}
              onUnblockTopic={readOnly ? undefined : handleUnblockTopic}
              onUnblockChannel={readOnly ? undefined : handleUnblockChannel}
            />
          </div>
        )}

        {/* Music taste profile — learned locally by the dedicated music engine */}
        {musicProfile && (
          <>
            <div className="col-span-12">
              <MusicTasteOverview profile={musicProfile} />
            </div>
            <div className="col-span-12 lg:col-span-7">
              <MusicTopArtists profile={musicProfile} />
            </div>
            <div className="col-span-12 lg:col-span-5">
              <MusicGenreAffinity profile={musicProfile} />
            </div>
            <div className="col-span-12">
              <MusicListeningPatterns profile={musicProfile} />
            </div>
          </>
        )}

        {/* The running profile's own lists and actions; another profile's view is read only. */}
        {!readOnly && (
          <>
            <div className="col-span-12 gap-6 flex flex-col">
              <MusicBlockedArtists />
              <LearningActivity />
            </div>
            <div className="col-span-12">
              <ProfileData brain={activeBrain} onImport={handleImportBrain} onReset={handleResetBrain} />
            </div>
          </>
        )}

      </div>
    </div>
  );
}

export default FlowNeuroPersona;
