import { Flag } from "lucide-react";

import { checkAiReport, submitAiReport, useAiReportSettings, type AiReportResult } from "../../lib/aiList/useAiList";
import { confirmAction } from "../../lib/dialogs";
import { getString } from "../../lib/i18n/index";
import { useUiStore } from "../../store/useUiStore";
import type { VideoSummary } from "../../types/video";
import type { MediaMenuAction } from "../ui/MediaMenu";

const RESULT_MESSAGE: Record<AiReportResult, Parameters<typeof getString>[0]> = {
  sent: "ai_report_sent",
  busy: "ai_report_busy",
  rateLimited: "ai_report_rate_limited",
  rejected: "ai_report_rejected",
  failed: "ai_report_failed",
};

/**
 * Report AI channel, in a video's menu while reporting is on in Settings: the channel and this
 * video go to AiSList once the user confirms, as on Android.
 */
export function useAiReportAction(video: VideoSummary): MediaMenuAction[] {
  const { enabled } = useAiReportSettings();
  const channelId = video.channelId;
  if (!enabled || !channelId) return [];

  const report = async () => {
    const { showToast } = useUiStore.getState();
    const check = await checkAiReport(channelId, video.channelHandle ?? undefined);
    if (check.kind === "noName") return showToast({ variant: "error", message: getString("ai_report_no_name") });
    if (check.kind === "noHandle") return showToast({ variant: "error", message: getString("ai_report_no_handle") });
    if (check.kind === "alreadyListed") {
      return showToast({ message: getString(check.verdict === "block" ? "ai_report_already_blocked" : "ai_report_already_warned") });
    }
    const confirmed = await confirmAction({
      title: getString("ai_report_action"),
      message: `${getString("ai_report_confirm", check.handle)}\n${getString("ai_report_confirm_note")}`,
      confirmLabel: getString("ai_report_send"),
    });
    if (!confirmed) return;
    const result = await submitAiReport(check.handle, video.id);
    showToast({ variant: result === "sent" ? "success" : "error", message: getString(RESULT_MESSAGE[result]) });
  };

  return [{ id: "report-ai", label: getString("ai_report_action"), icon: <Flag size={16} />, group: "feed", onSelect: report }];
}
