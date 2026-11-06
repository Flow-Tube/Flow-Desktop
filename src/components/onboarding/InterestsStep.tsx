import { getString } from "../../lib/i18n/index";
import React from "react";
import { TOPIC_CATEGORIES } from "./constants";

interface InterestsStepProps {
  selectedTopics: string[];
  onTopicToggle: (topic: string) => void;
}

export const InterestsStep: React.FC<InterestsStepProps> = ({
  selectedTopics,
  onTopicToggle,
}) => {
  const remaining = Math.max(0, 3 - selectedTopics.length);

  return (
    <div className="flex flex-col w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hero Header */}
      <div className="mb-12">
        <h1 className="text-5xl font-semibold text-chrome-neutral-100 tracking-tight mb-3">
          What are you into?
        </h1>
        <p className="text-lg text-chrome-neutral-400">
          Pick 3 or more topics to initialize FlowNeuro's local algorithm.{" "}
          {remaining > 0 ? (
            <span className="text-primary font-medium">{remaining} left.</span>
          ) : (
            <span className="text-chrome-emerald-400 font-medium">{getString('onboarding_ready_to_go')}</span>
          )}
        </p>
      </div>

      {/* Categories Grid */}
      <div className="space-y-12 pb-12">
        {TOPIC_CATEGORIES.map((category) => (
          <section key={category.name}>
            <h2 className="text-sm uppercase tracking-widest text-chrome-neutral-500 mb-5 font-bold">
              {category.name}
            </h2>
            <div className="flex flex-wrap gap-3">
              {category.topics.map((topic) => {
                const isSelected = selectedTopics.includes(topic);
                return (
                  <button
                    key={topic}
                    onClick={() => onTopicToggle(topic)}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-200 active:scale-95 cursor-pointer ${
                      isSelected
                        ? "bg-primary text-chrome-white shadow-md shadow-primary/20"
                        : "bg-transparent border border-chrome-neutral-700 text-chrome-neutral-300 hover:bg-chrome-neutral-800"
                    }`}
                  >
                    {isSelected && (
                      <svg
                        className="w-4 h-4 shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {topic}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};

export default InterestsStep;
