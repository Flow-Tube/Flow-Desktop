import { getString } from '../../lib/i18n/index';

export function ExplicitBadge() {
  const label = getString('music_explicit');
  return (
    <span
      title={label}
      aria-label={label}
      className="grid h-4 w-4 shrink-0 place-items-center rounded-[3px] bg-chrome-neutral-700 text-[10px] font-bold leading-none text-chrome-neutral-300"
    >
      E
    </span>
  );
}
