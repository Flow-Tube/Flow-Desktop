import { resumeWithin } from "./audioContext";

const TONE_SECONDS = 0.5;
const POLL_MS = 100;
const GIVE_UP_MS = 1_500;
const AUDIBLE = 1e-4;

/**
 * Half a second of a quiet 440 Hz tone as a WAV file, made in memory so it needs no network.
 * It is written at the context's own rate: macOS WebKit hands a MediaElementAudioSourceNode
 * silence for an 8 kHz file, which would read as broken routing.
 */
function toneWav(sampleRate: number): Blob {
  const samples = Math.round(sampleRate * TONE_SECONDS);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    view.setInt16(44 + i * 2, Math.round(3_000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)), true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

const peak = (analyser: AnalyserNode, data: Float32Array<ArrayBuffer>): number => {
  analyser.getFloatTimeDomainData(data);
  let max = 0;
  for (const v of data) max = Math.max(max, Math.abs(v));
  return max;
};

/**
 * Whether audio from a media element actually comes out of WebAudio here. WebKitGTK has shipped
 * builds where a MediaElementAudioSourceNode delivers only silence, and an element handed to
 * WebAudio can never play on its own again, so the real players are only routed once a throwaway
 * element has proved it works. The tone goes to a muted sink and is never heard.
 *
 * Null when the test could not run (the element was not allowed to play), so it can be retried.
 */
export async function probeMediaElementRouting(ctx: AudioContext): Promise<boolean | null> {
  const url = URL.createObjectURL(toneWav(ctx.sampleRate));
  const el = new Audio();
  el.loop = true;
  el.src = url;
  const source = ctx.createMediaElementSource(el);
  const analyser = ctx.createAnalyser();
  const sink = ctx.createGain();
  sink.gain.value = 0;
  source.connect(analyser);
  analyser.connect(sink);
  sink.connect(ctx.destination);
  try {
    await resumeWithin(ctx);
    try {
      await el.play();
    } catch {
      return null;
    }
    const data = new Float32Array(analyser.fftSize);
    const started = Date.now();
    while (Date.now() - started < GIVE_UP_MS) {
      if (peak(analyser, data) > AUDIBLE) return true;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    // Only a running context that still delivered nothing proves the routing is broken.
    return ctx.state === "running" ? false : null;
  } finally {
    el.pause();
    source.disconnect();
    sink.disconnect();
    el.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
}
