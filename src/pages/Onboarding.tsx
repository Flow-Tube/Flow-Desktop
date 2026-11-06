import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { completeOnboarding } from "../lib/api/recommendation";
import { Logo } from "../components/common/Logo";
import { AlertsStep } from "../components/onboarding/AlertsStep";
import { ArtistsStep } from "../components/onboarding/ArtistsStep";
import InterestsStep from "../components/onboarding/InterestsStep";
import ChannelsStep from "../components/onboarding/ChannelsStep";
import ImportStep from "../components/onboarding/ImportStep";
import { ReadyStep } from "../components/onboarding/ReadyStep";
import { onboardingProgress, onboardingSteps } from "../lib/onboardingSteps";
import { getString } from "../lib/i18n/index";
import { profileDisplayName } from "../lib/profiles/display";
import { useProfilesStore } from "../store/useProfilesStore";
import { useSubscriptionStore } from "../store/useSubscriptionStore";

export const Onboarding: React.FC = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  // Fixed at the start: subscribing during setup must not take the Import step away.
  const [steps] = useState(() => onboardingSteps(useSubscriptionStore.getState().subscriptions.length > 0));
  const step = steps[currentStep] ?? "interests";
  const lastStep = steps.length - 1;
  const importIndex = steps.indexOf("import");
  const profiles = useProfilesStore((state) => state.view);
  const loadProfiles = useProfilesStore((state) => state.load);
  const settingUp =
    profiles && profiles.activeId !== profiles.defaultId
      ? profiles.profiles.find((profile) => profile.id === profiles.activeId)
      : undefined;

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);

  const handleTopicToggle = (topic: string) => {
    if (selectedTopics.includes(topic)) {
      setSelectedTopics(selectedTopics.filter((t) => t !== topic));
    } else {
      setSelectedTopics([...selectedTopics, topic]);
    }
  };

  const canAdvance = step === "interests" ? selectedTopics.length >= 3 : true;

  const handleNext = async () => {
    if (currentStep < lastStep) {
      setCurrentStep(currentStep + 1);
    } else {
      try {
        const topics = selectedTopics.length >= 3 ? selectedTopics : ["Science", "Technology", "Music"];
        await completeOnboarding(topics);
        navigate("/");
      } catch (e) {
        console.error("Failed to complete onboarding", e);
        navigate("/");
      }
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSkip = async () => {
    try {
      const topics = selectedTopics.length >= 3 ? selectedTopics : ["Science", "Technology", "Music"];
      await completeOnboarding(topics);
      navigate("/");
    } catch (e) {
      console.error("Failed to skip onboarding", e);
      navigate("/");
    }
  };

  const progressPercentage = onboardingProgress(steps, step);
  const nextLabel =
    step === "ready" ? getString("onboarding_start_watching") : getString("onboarding_continue");

  return (
    <div className="w-full h-full overflow-hidden flex flex-col bg-surface font-sans relative">
      {/* Absolute Top Progress Bar */}
      {progressPercentage !== null && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-chrome-zinc-800/50 z-50">
          <div
            className="h-full bg-primary transition-all duration-500 ease-out"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
      )}

      {/* Header with Logo */}
      <div className="absolute top-0 left-0 z-40 flex items-center gap-4 p-8">
        <Logo size={40} showText={true} />
        {settingUp && (
          <span className="text-sm text-chrome-neutral-400">{getString("profiles_setting_up", profileDisplayName(settingUp))}</span>
        )}
      </div>

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto w-full pt-32 pb-16">
        <div className="max-w-5xl mx-auto px-8 lg:px-12 w-full">

          {step === "interests" && (
            <InterestsStep
              selectedTopics={selectedTopics}
              onTopicToggle={handleTopicToggle}
            />
          )}

          {step === "channels" && (
            <ChannelsStep selectedTopics={selectedTopics} />
          )}

          {step === "artists" && <ArtistsStep />}

          {step === "alerts" && <AlertsStep />}

          {step === "import" && (
            <ImportStep />
          )}

          {step === "ready" && <ReadyStep interestCount={selectedTopics.length} />}
        </div>
      </div>

      {/* Sticky Bottom Action Bar */}
      <div className="w-full bg-surface border-t border-chrome-neutral-800/50 z-40">
        <div className="max-w-5xl mx-auto px-8 lg:px-12 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {currentStep > 0 && (
              <button
                className="text-chrome-neutral-500 hover:text-chrome-neutral-300 font-semibold text-sm transition-colors cursor-pointer flex items-center gap-2"
                onClick={handleBack}
              >
                <span>&larr;</span> {getString("onboarding_back")}
              </button>
            )}
            {currentStep === 0 && importIndex >= 0 && (
              <button
                className="text-chrome-neutral-500 hover:text-chrome-neutral-300 font-semibold text-sm transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onClick={() => setCurrentStep(importIndex)}
              >
                {getString("onboarding_restore_backup")}
              </button>
            )}
            {step !== "ready" && (
              <button
                className="text-chrome-neutral-500 hover:text-chrome-neutral-300 font-semibold text-sm transition-colors cursor-pointer"
                onClick={handleSkip}
              >
                {getString("onboarding_skip")}
              </button>
            )}
          </div>
          
          <button
            className={`px-8 py-3 rounded-full font-bold text-sm transition-all duration-300 ${
              canAdvance 
                ? "bg-primary text-chrome-white hover:bg-primary active:scale-95 cursor-pointer" 
                : "bg-chrome-neutral-800 text-chrome-neutral-500 opacity-50 cursor-not-allowed"
            }`}
            disabled={!canAdvance}
            onClick={handleNext}
          >
            {nextLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
