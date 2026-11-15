import { Bot } from "lucide-react";

import { allowAiChannel, useAiChannelVerdict } from "../../lib/aiList/useAiList";
import { getString } from "../../lib/i18n/index";
import type { ChannelDetails } from "../../types/video";
import { NoticeBanner } from "../ui/NoticeBanner";

/**
 * Says when a channel is on AiSList, as Android's channel page does. Showing its videos puts it on
 * the allow list, which Settings > Extensions can undo.
 */
export function AiChannelNotice({ channel }: { channel: ChannelDetails }) {
  const verdict = useAiChannelVerdict(channel.id, channel.handle);
  if (verdict === "none") return null;
  return (
    <div className="mx-auto mt-4 w-full max-w-[1600px] px-6 md:px-8">
      <NoticeBanner
        icon={<Bot size={18} />}
        message={getString(verdict === "block" ? "ai_list_channel_blocked" : "ai_list_channel_warned")}
        actionLabel={getString("ai_list_channel_show")}
        onAction={() => void allowAiChannel({ id: channel.id, name: channel.name, handle: channel.handle ?? undefined })}
      />
    </div>
  );
}
