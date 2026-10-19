function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function Shimmer({ className }: { className: string }) {
  return <div className={cx('bg-surface-container-low', className)} />;
}

function SectionHeading() {
  return <Shimmer className="mb-4 h-7 w-36 rounded-lg" />;
}

function TrackRowSkeleton() {
  return (
    <div className="flex items-center rounded-lg px-4 py-2">
      <Shimmer className="h-4 w-4 shrink-0 rounded" />
      <Shimmer className="ml-8 h-10 w-10 shrink-0 rounded" />
      <div className="ml-3 flex min-w-0 flex-1 flex-col gap-2">
        <Shimmer className="h-4 w-2/3 rounded" />
        <Shimmer className="h-3 w-1/3 rounded" />
      </div>
      <Shimmer className="h-4 w-10 shrink-0 rounded" />
    </div>
  );
}

function SquareCardSkeleton() {
  return (
    <div className="flex w-40 shrink-0 flex-col gap-3 md:w-48 lg:w-56">
      <Shimmer className="aspect-square w-full rounded-xl" />
      <Shimmer className="h-4 w-4/5 rounded" />
      <Shimmer className="h-3 w-1/2 rounded" />
    </div>
  );
}

function VideoCardSkeleton() {
  return (
    <div className="flex w-[260px] shrink-0 flex-col gap-3 md:w-[300px]">
      <Shimmer className="aspect-video w-full rounded-xl" />
      <Shimmer className="h-4 w-4/5 rounded" />
      <Shimmer className="h-3 w-1/2 rounded" />
    </div>
  );
}

function ArtistCardSkeleton() {
  return (
    <div className="flex w-32 shrink-0 flex-col items-center gap-3 md:w-40">
      <Shimmer className="h-32 w-32 rounded-full md:h-40 md:w-40" />
      <Shimmer className="h-4 w-24 rounded" />
    </div>
  );
}

function ShelfSkeleton({
  shape = 'square',
  count = 6,
}: {
  shape?: 'square' | 'video' | 'artist';
  count?: number;
}) {
  const Item =
    shape === 'video' ? VideoCardSkeleton : shape === 'artist' ? ArtistCardSkeleton : SquareCardSkeleton;

  return (
    <section>
      <SectionHeading />
      <div className="flex snap-x gap-6 overflow-hidden pb-6">
        {Array.from({ length: count }).map((_, index) => (
          <Item key={index} />
        ))}
      </div>
    </section>
  );
}

export function ArtistSkeleton() {
  return (
    <div className="min-h-full animate-pulse bg-[var(--color-background)] pb-32">
      <header className="relative flex h-[50vh] min-h-[400px] w-full items-end overflow-hidden bg-[var(--color-surface)] px-8 pb-8">
        <div aria-hidden="true" className="absolute inset-0 bg-surface-container-low opacity-40" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-[var(--color-surface)]/80 to-[var(--color-background)]"
        />

        <div className="relative z-10 mx-auto flex w-full max-w-[1600px] flex-col items-start gap-6 md:flex-row md:items-end">
          <Shimmer className="h-40 w-40 shrink-0 rounded-full ring-4 ring-[var(--color-surface)] md:h-56 md:w-56" />

          <div className="flex min-w-0 flex-1 flex-col">
            <Shimmer className="h-4 w-20 rounded" />
            <Shimmer className="mt-6 h-20 w-3/5 max-w-2xl rounded-xl lg:h-24" />
            <Shimmer className="mt-6 h-5 w-80 max-w-full rounded" />

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Shimmer className="h-12 w-36 rounded-full bg-surface-container" />
              <Shimmer className="h-12 w-36 rounded-full bg-surface-container" />
              <Shimmer className="h-12 w-12 rounded-full bg-surface-container" />
              <Shimmer className="h-12 w-12 rounded-full bg-surface-container" />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1600px] flex-col gap-12 px-8 pt-8">
        <section>
          <SectionHeading />
          <div className="mt-4 grid gap-x-12 gap-y-2 lg:grid-cols-2">
            {Array.from({ length: 10 }).map((_, index) => (
              <TrackRowSkeleton key={index} />
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-12">
          <ShelfSkeleton shape="square" />
          <ShelfSkeleton shape="square" />
          <ShelfSkeleton shape="video" count={5} />
        </section>

        <ShelfSkeleton shape="artist" />

        <section>
          <SectionHeading />
          <div className="relative mt-12 mb-24 overflow-hidden rounded-2xl bg-surface-container-low p-6 md:p-8">
            <div className="flex flex-col gap-3">
              <Shimmer className="h-4 w-full rounded bg-surface-container" />
              <Shimmer className="h-4 w-11/12 rounded bg-surface-container" />
              <Shimmer className="h-4 w-10/12 rounded bg-surface-container" />
              <Shimmer className="h-4 w-2/3 rounded bg-surface-container" />
            </div>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[var(--color-surface-container-low)] via-[var(--color-surface-container-low)]/95 to-transparent"
            />
            <Shimmer className="absolute bottom-5 left-6 h-4 w-20 rounded bg-surface-container md:left-8" />
          </div>
        </section>
      </main>
    </div>
  );
}

export default ArtistSkeleton;
