import {
  unblockTopic,
  unblockChannel,
  resetBrain,
  importBrain,
  type UserBrain,
} from "../lib/api/recommendation";
import { usePersonaData } from "../lib/usePersonaData";
import { clearHomeFeedCaches } from "../lib/homeFeedCache";

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
import { getString } from "../lib/i18n/index";

export function FlowNeuroPersona() {
  const { brain, persona, musicProfile, loading, refreshing, failed, refresh } = usePersonaData();

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
      await unblockChannel(channelId);
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
      await resetBrain();
      await clearHomeFeedCaches();
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
               Control Center
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
              Control Center
            </h1>
            <p className="text-sm text-[var(--color-on-surface-variant)] mt-1">
              Analyze and manage local recommendation signals, memory, and sync controls.
            </p>
          </div>

          <button
            onClick={() => refresh(true)}
            disabled={refreshing}
            className="flex items-center gap-2 bg-[var(--color-surface-container-high)] hover:bg-[var(--color-surface-container-highest)] disabled:opacity-50 text-[var(--color-on-surface)] py-2.5 px-4 rounded-full text-xs font-semibold border border-[var(--color-outline-variant)] transition-colors active:scale-95 cursor-pointer shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-[var(--color-primary)]" : ""}`} />
            {refreshing ? "Refreshing..." : "Sync"}
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
              onUnblockTopic={handleUnblockTopic}
              onUnblockChannel={handleUnblockChannel}
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

        <div className="col-span-12 gap-6 flex flex-col">
          {/* Blocked music artists */}
          <MusicBlockedArtists />

          <LearningActivity />
        </div>

        <div className="col-span-12">
          <ProfileData
            brain={activeBrain}
            onImport={handleImportBrain}
            onReset={handleResetBrain}
          />
        </div>

      </div>
    </div>
  );
}

export default FlowNeuroPersona;
