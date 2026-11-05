import { create } from "zustand";
import {
  loadDecodeFailures,
  saveDecodeFailures,
  withDecodeFailure,
  type DecodeFailures,
  type VideoCodecFamily,
} from "../lib/codecHealth";

interface CodecHealthState {
  failures: DecodeFailures;
  recordFailure: (family: VideoCodecFamily, videoId: string, directStart: boolean) => void;
  clearFailures: (family: VideoCodecFamily) => void;
}

export const useCodecHealthStore = create<CodecHealthState>((set, get) => {
  const replace = (failures: DecodeFailures) => {
    saveDecodeFailures(failures);
    set({ failures });
  };
  return {
    failures: loadDecodeFailures(),
    recordFailure: (family, videoId, directStart) =>
      replace(withDecodeFailure(get().failures, family, videoId, directStart)),
    clearFailures: (family) => replace({ ...get().failures, [family]: [] }),
  };
});
