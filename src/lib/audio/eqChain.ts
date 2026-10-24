import { EQ_FILTER_POOL, EQ_GRAPH_OFF, filterSetting, type EqGraphSpec } from "./eq/graphPlan";
import { EqLimits } from "./eq/models";
import { SOFT_CLIP_HEADROOM, softClipCurve } from "./softClip";

/** Time constant every parameter glides with: quick enough to feel instant, slow enough not to click. */
export const RAMP_TIME_CONSTANT = 0.012;

let sharedClipCurve: Float32Array<ArrayBuffer> | null = null;

/**
 * One player's equalizer: preamp, a fixed pool of filters, a bass boost shelf and a soft clipper.
 * Nodes are made once; a new curve only moves their parameters, so the sound glides from one
 * setting to the next and nothing is ever reconnected while audio plays.
 */
export class EqChain {
  readonly input: GainNode;
  readonly output: AudioNode;
  private readonly filters: BiquadFilterNode[];
  private readonly bass: BiquadFilterNode;

  constructor(private readonly ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.filters = Array.from({ length: EQ_FILTER_POOL }, () => {
      const f = ctx.createBiquadFilter();
      f.type = "peaking";
      f.gain.value = 0;
      return f;
    });
    this.bass = ctx.createBiquadFilter();
    this.bass.type = "lowshelf";
    this.bass.frequency.value = EqLimits.BASS_BOOST_FREQUENCY;
    this.bass.gain.value = 0;

    // A WaveShaperNode clamps its input to ±1, so the signal goes in scaled down and the curve
    // spans the headroom; below the knee the curve is the identity, so normal levels pass as-is.
    const clipIn = ctx.createGain();
    clipIn.gain.value = 1 / SOFT_CLIP_HEADROOM;
    const clipper = ctx.createWaveShaper();
    sharedClipCurve ??= softClipCurve();
    clipper.curve = sharedClipCurve;

    let previous: AudioNode = this.input;
    for (const node of [...this.filters, this.bass, clipIn, clipper]) {
      previous.connect(node);
      previous = node;
    }
    this.output = clipper;
  }

  apply(spec: EqGraphSpec = EQ_GRAPH_OFF): void {
    const t = this.ctx.currentTime;
    const glide = (param: AudioParam, value: number) => param.setTargetAtTime(value, t, RAMP_TIME_CONSTANT);
    const sampleRate = this.ctx.sampleRate;

    this.filters.forEach((filter, i) => {
      const setting = spec.enabled ? filterSetting(spec.bands[i], sampleRate) : null;
      if (!setting) {
        // Peaks and shelves go flat at 0 dB whatever their frequency, so only the gain moves; a
        // low or high pass cannot be flattened and becomes a flat peak.
        if (filter.type === "lowpass" || filter.type === "highpass") filter.type = "peaking";
        glide(filter.gain, 0);
        return;
      }
      if (filter.type !== setting.type) filter.type = setting.type;
      glide(filter.frequency, setting.frequency);
      glide(filter.Q, setting.q);
      glide(filter.gain, setting.gain);
    });
    glide(this.bass.gain, spec.enabled ? spec.bassBoostDb : 0);
    glide(this.input.gain, spec.enabled ? Math.pow(10, spec.preampDb / 20) : 1);
  }
}
