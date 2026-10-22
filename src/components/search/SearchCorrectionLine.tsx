import { useNavigate } from 'react-router-dom';
import { getString } from '../../lib/i18n/index';
import type { SearchCorrection } from '../../types/video';

/** "Showing results for …, search instead for …", or "Did you mean …?". */
export function SearchCorrectionLine({
  correction,
  exact,
  onSearchExactly,
}: {
  correction: SearchCorrection | null;
  /** The search already ran as typed. */
  exact: boolean;
  onSearchExactly: () => void;
}) {
  const navigate = useNavigate();
  if (!correction || exact) return null;

  const linkClass = 'font-semibold text-primary hover:underline';
  if (correction.applied) {
    return (
      <div className="flex flex-col gap-0.5 px-1 text-sm text-chrome-neutral-300">
        <span>
          {getString('search_showing_results_for')} <span className="font-semibold text-chrome-neutral-100">{correction.query}</span>
        </span>
        {correction.original && (
          <span className="text-chrome-neutral-400">
            {getString('search_instead_for')}{' '}
            <button type="button" className={linkClass} onClick={onSearchExactly}>
              {correction.original}
            </button>
          </span>
        )}
      </div>
    );
  }
  return (
    <p className="px-1 text-sm text-chrome-neutral-300">
      {getString('search_did_you_mean')}{' '}
      <button type="button" className={linkClass} onClick={() => navigate(`/search?q=${encodeURIComponent(correction.query)}`)}>
        {correction.query}
      </button>
    </p>
  );
}
