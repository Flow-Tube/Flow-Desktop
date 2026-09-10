import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";

import { getString } from "../../lib/i18n/index";
import { hasRevealPin, setRevealPin, useBlockedRevealStore } from "../../lib/blockedContent";
import { useFeedActionsStore } from "../../store/useFeedActionsStore";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";

export function BlockedKeywordsPanel() {
  const load = useFeedActionsStore((s) => s.load);
  const keywords = useFeedActionsStore((s) => s.blockedKeywords);
  const addBlockedKeyword = useFeedActionsStore((s) => s.addBlockedKeyword);
  const removeBlockedKeyword = useFeedActionsStore((s) => s.removeBlockedKeyword);
  const hideRevealed = useBlockedRevealStore((s) => s.hideAll);
  const [draft, setDraft] = useState("");
  const [pinDraft, setPinDraft] = useState("");
  const [pinSet, setPinSet] = useState(hasRevealPin);

  useEffect(() => {
    void load();
  }, [load]);

  const submitKeyword = () => {
    if (!draft.trim()) return;
    addBlockedKeyword(draft);
    setDraft("");
    hideRevealed();
  };

  const applyPin = async (pin: string) => {
    await setRevealPin(pin);
    setPinSet(hasRevealPin());
    setPinDraft("");
    hideRevealed();
  };

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <div>
        <div className="text-sm font-medium text-chrome-neutral-200">
          {getString("settings_blocked_keywords")}
        </div>
        <div className="mt-0.5 text-xs text-chrome-neutral-400">
          {getString("settings_blocked_keywords_desc")}
        </div>
      </div>

      <div className="flex gap-2">
        <TextInput
          value={draft}
          onChange={setDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitKeyword();
          }}
          placeholder={getString("settings_blocked_keywords_add")}
          className="min-w-0 flex-1"
        />
        <Button onClick={submitKeyword} disabled={!draft.trim()}>
          <Plus size={16} />
        </Button>
      </div>

      {keywords.length === 0 ? (
        <p className="text-xs text-chrome-neutral-500">
          {getString("settings_blocked_keywords_empty")}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {keywords.map((keyword) => (
            <span
              key={keyword}
              className="flex items-center gap-1.5 rounded-full border border-chrome-neutral-800 bg-surface-container px-3 py-1 text-xs text-chrome-neutral-200"
            >
              {keyword}
              <button
                type="button"
                aria-label={`Remove ${keyword}`}
                onClick={() => removeBlockedKeyword(keyword)}
                className="text-chrome-neutral-500 transition-colors hover:text-chrome-neutral-200"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="border-t border-chrome-neutral-800/50 pt-4">
        <div className="text-sm font-medium text-chrome-neutral-200">
          {getString("settings_blocked_pin")}
        </div>
        <div className="mt-0.5 text-xs text-chrome-neutral-400">
          {getString("settings_blocked_pin_desc")}
        </div>
        <div className="mt-3 flex gap-2">
          <TextInput
            type="password"
            value={pinDraft}
            onChange={setPinDraft}
            placeholder={getString("settings_blocked_pin_placeholder")}
            className="min-w-0 flex-1"
          />
          <Button onClick={() => void applyPin(pinDraft)} disabled={!pinDraft.trim()}>
            {getString("settings_blocked_pin_set")}
          </Button>
          {pinSet && (
            <Button variant="ghost" onClick={() => void applyPin("")}>
              {getString("settings_blocked_pin_clear")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
