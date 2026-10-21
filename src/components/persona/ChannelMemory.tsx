import { useEffect, useState } from "react";
import type { UserBrain } from "../../lib/api/recommendation";
import { getChannelDetails } from "../../lib/api/youtube";
import { getString } from "../../lib/i18n/index";

interface ChannelMemoryProps {
  brain: UserBrain;
}

function channelInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "C";
}

export function ChannelMemory({ brain }: ChannelMemoryProps) {
  const [channelNames, setChannelNames] = useState<Record<string, string>>({});

  const sortedChannels = Object.entries(brain.channel_scores || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  useEffect(() => {
    const fetchNames = async () => {
      const pendingIds = sortedChannels
        .map(([id]) => id)
        .filter((id) => id.startsWith("UC") && !channelNames[id]);

      if (pendingIds.length === 0) return;

      const resolved: Record<string, string> = {};
      await Promise.all(
        pendingIds.map(async (id) => {
          try {
            const details = await getChannelDetails(id);
            if (details?.name) {
              resolved[id] = details.name;
            }
          } catch (e) {
            console.warn("Failed to fetch channel details for", id, e);
          }
        }),
      );

      if (Object.keys(resolved).length > 0) {
        setChannelNames((prev) => ({ ...prev, ...resolved }));
      }
    };

    fetchNames();
  }, [brain.channel_scores]);

  return (
    <section className="h-full w-full rounded-2xl bg-[var(--color-surface-container-low)] border border-[var(--color-outline-variant)] p-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold text-[var(--color-on-surface)]">
          {getString("persona_channels_title")}
        </h3>
        <p className="text-sm text-[var(--color-on-surface-variant)]">
          {getString("persona_channels_desc")}
        </p>
      </div>

      <div className="mt-5">
        {sortedChannels.length === 0 ? (
          <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-[var(--color-outline-variant)] bg-[var(--color-surface-container)]">
            <span className="text-sm text-[var(--color-on-surface-variant)]">
              {getString("persona_channels_empty")}
            </span>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-outline-variant)]">
            {sortedChannels.map(([id, score]) => {
              const name = channelNames[id] || (id.startsWith("UC") ? getString("persona_channel_fallback", id.slice(0, 8)) : id);
              const scorePct = Math.round(score * 100);

              return (
                <div key={id} className="grid grid-cols-[auto_1fr_auto] items-center gap-4 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-container-high)] text-sm font-semibold text-[var(--color-on-surface)]">
                    {channelInitial(name)}
                  </div>

                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--color-on-surface)]">{name}</p>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--color-on-surface-variant)]">
                      {id}
                    </p>
                  </div>

                  <div className="w-28 sm:w-36">
                    <div className="flex items-center justify-between gap-3">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-outline-variant)]">
                        <div
                          className="h-full rounded-full bg-[var(--color-primary)]"
                          style={{ width: `${scorePct}%` }}
                        />
                      </div>
                      <span className="w-9 text-right font-mono text-xs text-[var(--color-on-surface)]">
                        {scorePct}%
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
