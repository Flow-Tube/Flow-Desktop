import { getString } from '../../lib/i18n/index';
import { useNavigate } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { useMusicMoods } from '../../lib/useMusicMoods';
import { musicSeeAllRoute } from '../../lib/musicRoutes';

export default function MusicMoodsPage() {
  const navigate = useNavigate();
  const { groups, loading, error, reload } = useMusicMoods();

  return <main className="px-6 py-8 lg:px-8">
    <h1 className="mb-6 text-3xl font-bold tracking-tight text-chrome-neutral-100">{getString('music_browse')}</h1>
    {error && <div className="mb-6 flex items-center gap-3 text-sm text-chrome-neutral-400">
      <span>{error}</span><Button variant="secondary" onClick={() => void reload()}>{getString('music_retry')}</Button>
    </div>}
    {loading && !groups.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 12 }).map((_, index) => <div key={index}
        className="h-24 animate-pulse rounded-2xl bg-surface-container-low" />)}
    </div> : <div className="flex flex-col gap-10">
      {groups.map((group, index) => <section key={`${group.title}:${index}`}>
        {group.title && <h2 className="mb-4 text-xl font-bold text-chrome-neutral-100">{group.title}</h2>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {group.items.map((item) => <button key={`${item.browseId}:${item.params ?? ''}`} type="button"
        onClick={() => navigate(musicSeeAllRoute(item.browseId, item.params, item.title))}
        className="min-h-24 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-5 text-start font-medium text-chrome-neutral-100 transition-colors duration-200 ease-out hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]">
        {item.title}
      </button>)}
        </div>
      </section>)}
    </div>}
    {!loading && !error && !groups.length && <p className="py-20 text-center text-sm text-chrome-neutral-400">{getString('music_chip_empty')}</p>}
  </main>;
}
