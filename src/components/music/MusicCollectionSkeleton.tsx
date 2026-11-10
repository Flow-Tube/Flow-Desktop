export function MusicCollectionSkeleton() {
  return (
    <div className="animate-pulse pb-32">
      <div className="flex flex-col items-center gap-6 p-6 sm:flex-row sm:items-end lg:p-8">
        <div className="h-44 w-44 shrink-0 rounded-2xl bg-surface-container-low lg:h-52 lg:w-52" />
        <div className="flex w-full flex-col items-center gap-3 sm:items-start">
          <div className="h-3 w-16 rounded bg-surface-container-low" />
          <div className="h-9 w-2/3 max-w-md rounded-lg bg-surface-container-low" />
          <div className="h-4 w-40 rounded bg-surface-container-low" />
          <div className="mt-3 h-12 w-56 rounded-full bg-surface-container-low" />
        </div>
      </div>
      <div className="mx-auto flex max-w-[1100px] flex-col gap-1 px-6 pt-6 lg:px-8">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-2">
            <div className="h-12 w-12 shrink-0 rounded-md bg-surface-container-low" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="h-3.5 w-1/2 rounded bg-surface-container-low" />
              <div className="h-3 w-1/3 rounded bg-surface-container-low" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
