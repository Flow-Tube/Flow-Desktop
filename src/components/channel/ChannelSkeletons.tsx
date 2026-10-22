import { useGridStyle } from "../../lib/useGridColumns";

export function ChannelPageSkeleton() {
  const gridStyle = useGridStyle();
  return (
    <div className="flex-grow pb-24 bg-background relative animate-pulse">
      {/* Banner Skeleton */}
      <div className="relative w-full h-48 md:h-64 bg-chrome-zinc-900" />
      
      {/* Profile Block Skeleton */}
      <div className=" mx-auto w-full px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 relative z-10">
          <div className="flex flex-col md:flex-row items-center md:items-end gap-6">
            {/* Overlapping Avatar Skeleton */}
            <div className="w-32 h-32 rounded-full bg-chrome-zinc-800 border-4 border-background shrink-0 -mt-16" />
            
            {/* Metadata Skeletons */}
            <div className="text-center md:text-left space-y-3 mt-4 md:mt-0 pb-2">
              <div className="h-8 w-48 bg-chrome-zinc-800 rounded-lg mx-auto md:mx-0" />
              <div className="h-4 w-32 bg-chrome-zinc-800 rounded mx-auto md:mx-0" />
            </div>
          </div>
          
          {/* Action Row Button Skeleton */}
          <div className="w-32 h-10 bg-chrome-zinc-800 rounded-full shrink-0 mb-2 mx-auto md:mx-0" />
        </div>
      </div>

      {/* Tabs Row Skeleton */}
      <div className="w-full bg-chrome-zinc-900/50 border-b border-chrome-zinc-800 h-14" />

      {/* Grid Content Skeleton */}
      <div className=" mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flow-grid gap-y-8 pb-8" style={gridStyle}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3">
              <div className="w-full aspect-video rounded-xl bg-chrome-zinc-800" />
              <div className="flex items-start gap-3 px-1">
                <div className="w-9 h-9 rounded-full bg-chrome-zinc-800 shrink-0" />
                <div className="flex flex-col gap-2 w-full pt-1">
                  <div className="h-4 w-3/4 bg-chrome-zinc-800 rounded" />
                  <div className="h-3 w-1/2 bg-chrome-zinc-800 rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ShortsGridSkeleton() {
  const gridStyle = useGridStyle({ density: "dense" });
  return (
    <div className="flow-grid gap-y-4" style={gridStyle}>
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="relative w-full aspect-[9/16] rounded-xl bg-chrome-zinc-800 animate-pulse border border-chrome-zinc-800/50" />
          <div className="h-4 w-3/4 bg-chrome-zinc-800 rounded animate-pulse mt-1" />
        </div>
      ))}
    </div>
  );
}

export function PlaylistsGridSkeleton() {
  const gridStyle = useGridStyle({ gapRem: 1.5 });
  return (
    <div className="flow-grid gap-y-6" style={gridStyle}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <div className="relative w-full aspect-video rounded-xl mt-3 bg-chrome-zinc-800 animate-pulse border border-chrome-zinc-800/50">
            <div className="absolute -top-1.5 left-2 right-2 h-2 bg-chrome-zinc-800/60 rounded-t-xl" />
            <div className="absolute -top-3 left-4 right-4 h-2 bg-chrome-zinc-800/40 rounded-t-xl" />
          </div>
          <div className="flex flex-col gap-2 mt-1">
            <div className="h-4 w-5/6 bg-chrome-zinc-800 rounded animate-pulse" />
            <div className="h-3 w-1/3 bg-chrome-zinc-800 rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PostsFeedSkeleton() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="w-full bg-chrome-zinc-900/40 border border-chrome-zinc-800/60 rounded-2xl p-4 sm:p-5 animate-pulse">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-chrome-zinc-800 shrink-0" />
            <div className="flex flex-col gap-2">
              <div className="h-4 w-24 bg-chrome-zinc-800 rounded" />
              <div className="h-3 w-16 bg-chrome-zinc-800 rounded" />
            </div>
          </div>
          <div className="pl-[52px] space-y-3">
            <div className="h-4 w-full bg-chrome-zinc-800 rounded" />
            <div className="h-4 w-5/6 bg-chrome-zinc-800 rounded" />
            <div className="h-4 w-2/3 bg-chrome-zinc-800 rounded" />
            <div className="flex items-center gap-2 mt-4 pt-2">
              <div className="h-8 w-24 bg-chrome-zinc-800 rounded-full" />
              <div className="h-8 w-16 bg-chrome-zinc-800 rounded-full" />
              <div className="h-8 w-16 bg-chrome-zinc-800 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
