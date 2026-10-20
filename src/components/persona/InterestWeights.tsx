import { interestTopics, type TopicEvidence, type UserBrain } from "../../lib/api/recommendation";
import { topicLabel } from "../../lib/topicLabel";

interface InterestWeightsProps {
  brain: UserBrain;
}

function findEvidence(brain: UserBrain, topic: string): TopicEvidence | undefined {
  const evidence = brain.topic_evidence || {};
  const matchingKey = Object.keys(evidence).find((key) => key.toLowerCase() === topic.toLowerCase());

  return evidence[topic] || evidence[topic.toLowerCase()] || (matchingKey ? evidence[matchingKey] : undefined);
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function InterestWeights({ brain }: InterestWeightsProps) {
  const topicsMap = interestTopics(brain.global_vector.topics);
  const sortedTopics = Object.entries(topicsMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  const segmentTopics = sortedTopics.slice(0, 6);
  const totalSegmentWeight = segmentTopics.reduce((acc, [, weight]) => acc + weight, 0);

  return (
    <section className="flex h-full w-full flex-col rounded-2xl bg-[var(--color-surface-container-low)] border border-[var(--color-outline-variant)] p-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold text-[var(--color-on-surface)]">
          Semantic Interest Topology
        </h3>
        <p className="text-sm text-[var(--color-on-surface-variant)]">
          Topic weights and the evidence signals used by the local recommendation model.
        </p>
      </div>

      {totalSegmentWeight > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-on-surface-variant)]">
              Distribution Ratio
            </p>
            <p className="font-mono text-xs text-[var(--color-on-surface-variant)]">
              top {segmentTopics.length}
            </p>
          </div>

          <div className="mt-3 flex h-5 w-full overflow-hidden rounded-full bg-[var(--color-outline-variant)]">
            {segmentTopics.map(([topic, weight], index) => {
              const widthPct = (weight / totalSegmentWeight) * 100;
              const opacity = 0.95 - index * 0.1;

              return (
                <div
                  key={topic}
                  className="h-full bg-[var(--color-primary)]"
                  style={{ width: `${widthPct}%`, opacity }}
                  title={`${topicLabel(brain, topic)}: ${formatPercent(weight)}`}
                />
              );
            })}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-3">
            {segmentTopics.map(([topic, weight], index) => (
              <div key={topic} className="flex min-w-0 items-center gap-2 text-xs">
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]"
                  style={{ opacity: 0.95 - index * 0.1 }}
                />
                <span className="truncate text-[var(--color-on-surface)]">{topicLabel(brain, topic)}</span>
                <span className="font-mono text-[var(--color-on-surface-variant)]">
                  {formatPercent(weight)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-on-surface-variant)]">
          Evidence Entries
        </p>

        {sortedTopics.length === 0 ? (
          <div className="mt-3 flex h-24 items-center justify-center rounded-xl border border-dashed border-[var(--color-outline-variant)] bg-[var(--color-surface-container)]">
            <span className="text-sm text-[var(--color-on-surface-variant)]">
              No topic evidence has been indexed yet.
            </span>
          </div>
        ) : (
          <div className="mt-3 max-h-[580px] overflow-y-auto rounded-xl border border-[var(--color-outline-variant)]">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-[var(--color-surface-container-high)]">
                <tr className="border-b border-[var(--color-outline-variant)]">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-[var(--color-on-surface-variant)]">
                    Topic Name
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-widest text-[var(--color-on-surface-variant)]">
                    Confidence Score
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-widest text-[var(--color-on-surface-variant)]">
                    Watch Loops
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-outline-variant)]">
                {sortedTopics.map(([topic, weight]) => {
                  const evidence = findEvidence(brain, topic);
                  const confidence = evidence?.positive_score ?? weight;
                  const watchLoops = evidence?.watch_signals ?? 0;

                  return (
                    <tr key={topic} className="bg-[var(--color-surface-container-low)]">
                      <td className="px-4 py-3 text-[var(--color-on-surface)]">
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{topicLabel(brain, topic)}</span>
                          <span className="mt-0.5 text-xs text-[var(--color-on-surface-variant)]">
                            Model weight {formatPercent(weight)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[var(--color-on-surface)]">
                        {confidence.toFixed(1)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[var(--color-on-surface)]">
                        {watchLoops}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
