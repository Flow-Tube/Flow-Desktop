import { useEffect, useState } from "react";
import { getDownloadFreeSpace } from "./api/downloads";

/** Free bytes where videos are saved; null until read, or when the system won't say. */
export function useDownloadFreeSpace(videoFolder: string | null, refreshKey: unknown): number | null {
  const [free, setFree] = useState<number | null>(null);

  useEffect(() => {
    let current = true;
    void getDownloadFreeSpace(videoFolder)
      .then((bytes) => {
        if (current) setFree(bytes);
      })
      .catch((error) => {
        console.warn("Failed to read free disk space", error);
        if (current) setFree(null);
      });
    return () => {
      current = false;
    };
  }, [videoFolder, refreshKey]);

  return free;
}
