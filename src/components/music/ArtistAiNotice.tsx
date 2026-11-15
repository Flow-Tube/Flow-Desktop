import { Bot } from "lucide-react";

import { allowAiChannel, useAiListMatcher, useAiMusicVerdict } from "../../lib/aiList/useAiList";
import { getString } from "../../lib/i18n/index";
import { NoticeBanner } from "../ui/NoticeBanner";

/**
 * Says why an artist's music is hidden or labelled, as Android's artist page does. Showing their
 * music puts them on the same allow list as AI channels, which Settings > Extensions can undo.
 */
export function ArtistAiNotice({ artistId, name }: { artistId: string; name: string }) {
  const matcher = useAiListMatcher();
  const verdict = useAiMusicVerdict([artistId]);
  if (!artistId || verdict === "none") return null;
  const message = matcher.isOnMusicList(artistId)
    ? getString("ai_music_artist_listed")
    : getString(verdict === "block" ? "ai_list_channel_blocked" : "ai_list_channel_warned");
  return (
    <NoticeBanner
      icon={<Bot size={18} />}
      message={message}
      actionLabel={getString("ai_music_artist_show")}
      onAction={() => void allowAiChannel({ id: artistId, name })}
    />
  );
}
