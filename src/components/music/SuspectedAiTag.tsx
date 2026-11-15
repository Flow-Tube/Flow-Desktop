import { getString } from '../../lib/i18n/index';

/** "Suspected AI" beside a song's explicit badge, for an artist on the AiSList warn list. */
export function SuspectedAiTag() {
  return <span className="shrink-0 text-xs font-medium text-chrome-neutral-400">{getString('ai_list_label')}</span>;
}
