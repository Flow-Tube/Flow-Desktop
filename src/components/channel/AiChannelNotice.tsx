import { Bot } from "lucide-react";

import { allowAiChannel, useAiChannelVerdict } from "../../lib/aiList/useAiList";
import { getString } from "../../lib/i18n/index";
import type { ChannelDetails } from "../../types/video";
import { Button } from "../ui/Button";

/**
 * Says when a channel is on AiSList, as Android's channel page does. Showing its videos puts it on
 * the allow list, which Settings > Extensions can undo.
 */
export function AiChannelNotice({ channel }: { channel: ChannelDetails }) {
  const verdict = useAiChannelVerdict(channel.id, channel.handle);
  if (verdict === "none") return null;
  return (
    <div className="mx-auto mt-4 flex w-full max-w-[1600px] items-center gap-3 px-6 md:px-8">
      <div className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low px-4 py-3">
        <Bot size={18} className="shrink-0 text-chrome-neutral-400" />
        <p className="min-w-0 flex-1 text-sm text-chrome-neutral-200">
          {getString(verdict === "block" ? "ai_list_channel_blocked" : "ai_list_channel_warned")}
        </p>
        <Button
          variant="secondary"
          onClick={() => void allowAiChannel({ id: channel.id, name: channel.name, handle: channel.handle ?? undefined })}
        >
          {getString("ai_list_channel_show")}
        </Button>
      </div>
    </div>
  );
}
