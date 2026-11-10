const Pulse = ({ className }: { className: string }) => (
  <div className={`animate-pulse rounded bg-surface-container-high ${className}`} />
);

export function WatchPageSkeleton() {
  return (
    <div className="min-h-screen bg-background pb-32 text-chrome-neutral-100">
      <div className="mx-auto grid w-full max-w-[1800px] grid-cols-1 items-start gap-x-6 gap-y-5 px-4 pt-4 md:px-6 md:pt-6 lg:grid-cols-[1fr_400px]">
        <div className="flex w-full flex-col gap-5 lg:col-start-1">
          <div className="aspect-video w-full animate-pulse overflow-hidden rounded-xl bg-surface-container" />

          <div className="space-y-2">
            <Pulse className="h-6 w-3/4" />
            <Pulse className="h-4 w-1/2" />
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-surface-container-high" />
              <div className="space-y-2">
                <Pulse className="h-3 w-28" />
                <Pulse className="h-2 w-16" />
              </div>
              <Pulse className="ms-2 h-9 w-24 rounded-full" />
            </div>
            <div className="flex items-center gap-2">
              <Pulse className="h-9 w-32 rounded-full" />
              <Pulse className="h-9 w-20 rounded-full" />
              <Pulse className="h-9 w-20 rounded-full" />
            </div>
          </div>

          <div className="space-y-3 rounded-xl bg-surface-container-low p-4">
            <div className="flex gap-3">
              <Pulse className="h-3 w-24" />
              <Pulse className="h-3 w-24" />
            </div>
            <Pulse className="h-3 w-full" />
            <Pulse className="h-3 w-5/6" />
          </div>
        </div>

        <div className="flex w-full flex-col gap-3 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={`related-sk-${i}`} className="flex w-full gap-2">
              <div className="aspect-video w-40 shrink-0 animate-pulse overflow-hidden rounded-xl bg-surface-container" />
              <div className="flex flex-1 flex-col gap-2 py-1">
                <Pulse className="h-3 w-full" />
                <Pulse className="h-3 w-5/6" />
                <Pulse className="h-2 w-20" />
                <Pulse className="h-2 w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
