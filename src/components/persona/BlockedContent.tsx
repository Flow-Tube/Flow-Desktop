import { useEffect, useState } from "react";
import { Ban, EyeOff, Globe, Trash2 } from "lucide-react";
import type { UserBrain } from "../../lib/api/recommendation";
import { getChannelDetails } from "../../lib/api/youtube";
import { getString } from "../../lib/i18n/index";

interface BlockedContentProps {
  brain: UserBrain;
  /** Without the handlers, the lists are read only. */
  onUnblockTopic?: (topic: string) => void;
  onUnblockChannel?: (channelId: string) => void;
}

export function BlockedContent({ brain, onUnblockTopic, onUnblockChannel }: BlockedContentProps) {
  const [channelNames, setChannelNames] = useState<Record<string, string>>({});
  const blockedTopics = brain.blocked_topics || [];
  const blockedChannels = brain.blocked_channels || [];

  useEffect(() => {
    const fetchNames = async () => {
      const pendingIds = blockedChannels.filter((id) => id.startsWith("UC") && !channelNames[id]);
      if (pendingIds.length === 0) return;

      const resolved: Record<string, string> = {};
      for (const id of pendingIds) {
        try {
          const details = await getChannelDetails(id);
          if (details?.name) {
            resolved[id] = details.name;
          }
        } catch (e) {
          console.warn("Failed to fetch channel details for blocked channel", id, e);
        }
      }

      if (Object.keys(resolved).length > 0) {
        setChannelNames((prev) => ({ ...prev, ...resolved }));
      }
    };

    fetchNames();
  }, [brain.blocked_channels]);

  if (blockedTopics.length === 0 && blockedChannels.length === 0) {
    return null;
  }

  return (
    <section className="flex h-full w-full flex-col rounded-2xl bg-[var(--color-surface-container-low)] border border-[var(--color-outline-variant)] p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Ban className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-on-surface-variant)]" />
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-[var(--color-on-surface)]">
              {getString("persona_blocked_title")}
            </h3>
            <p className="text-sm text-[var(--color-on-surface-variant)]">
              {getString("persona_blocked_desc")}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-right">
          <div>
            <p className="font-mono text-xl text-[var(--color-on-surface)]">{blockedTopics.length}</p>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-on-surface-variant)]">
              {getString("persona_blocked_topics_short")}
            </p>
          </div>
          <div>
            <p className="font-mono text-xl text-[var(--color-on-surface)]">{blockedChannels.length}</p>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-on-surface-variant)]">
              {getString("persona_blocked_creators_short")}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5">
        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-on-surface-variant)]">
              {getString("taste_current_blocked")}
            </p>
            <p className="font-mono text-xs text-[var(--color-on-surface-variant)]">{blockedTopics.length}</p>
          </div>

          <div className="max-h-72 overflow-y-auto rounded-xl border border-[var(--color-outline-variant)]">
            <table className="w-full border-collapse text-sm">
              <tbody className="divide-y divide-[var(--color-outline-variant)]">
                {blockedTopics.map((topic) => (
                  <tr key={topic}>
                    <td className="w-10 px-4 py-3 text-[var(--color-on-surface-variant)]">
                      <Globe className="h-4 w-4" />
                    </td>
                    <td className="px-0 py-3 text-[var(--color-on-surface)]">
                      <span className="block truncate capitalize">{topic}</span>
                    </td>
                    <td className="w-12 px-4 py-3 text-right">
                      {onUnblockTopic && <button
                        onClick={() => onUnblockTopic(topic)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-on-surface-variant)] transition-colors hover:bg-chrome-red-950/30 hover:text-chrome-red-400"
                        title={getString("persona_unblock_item", topic)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-on-surface-variant)]">
              {getString("persona_blocked_creators")}
            </p>
            <p className="font-mono text-xs text-[var(--color-on-surface-variant)]">{blockedChannels.length}</p>
          </div>

          <div className="max-h-72 overflow-y-auto rounded-xl border border-[var(--color-outline-variant)]">
            <table className="w-full border-collapse text-sm">
              <tbody className="divide-y divide-[var(--color-outline-variant)]">
                {blockedChannels.map((id) => {
                  const name = channelNames[id] || (id.startsWith("UC") ? getString("persona_channel_fallback", id.slice(0, 8)) : id);

                  return (
                    <tr key={id}>
                      <td className="w-10 px-4 py-3 text-[var(--color-on-surface-variant)]">
                        <EyeOff className="h-4 w-4" />
                      </td>
                      <td className="px-0 py-3">
                        <span className="block truncate text-[var(--color-on-surface)]">{name}</span>
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--color-on-surface-variant)]">
                          {id}
                        </span>
                      </td>
                      <td className="w-12 px-4 py-3 text-right">
                        {onUnblockChannel && <button
                          onClick={() => onUnblockChannel(id)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-on-surface-variant)] transition-colors hover:bg-chrome-red-950/30 hover:text-chrome-red-400"
                          title={getString("persona_unblock_item", name)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
