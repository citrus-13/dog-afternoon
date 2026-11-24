const clamp01 = (value) => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
// [high-pass Hz, low-pass Hz, relative level]. Keep small facial/paw contact
// particularly quiet; a fuller coat changes the noise texture, not its volume.
const BRUSH_PROFILES = Object.freeze({
  head: [520, 3100, 0.88],
  ear: [460, 2700, 0.78],
  paw: [800, 1900, 0.18],
  chin: [720, 2000, 0.22],
  nose: [1050, 1650, 0.05],
  back: [580, 4800, 1],
  chest: [640, 4300, 0.92],
  side: [620, 4800, 1],
  tail: [700, 3900, 0.88],
  body: [650, 4700, 1],
});

// Procedural, quiet breathing and brushing; no recordings or tonal purr layer.
export class DogSound {
  constructor() {
    this._context = null;
    this._nodes = [];
    this._sources = [];
    this._master = null;
    this._breath = null;
    this._brush = null;
    this._breathFilter = null;
    this._brushHighpass = null;
    this._brushLowpass = null;
    this._enabled = false;
    this._requested = false;
    this._destroyed = false;
    this._requestId = 0;
    this._contact = 0;
    this._speed = 0;
    this._zone = 'body';
    this._pressure = 1;
    this._tap = 0;
    this._seconds = 0;
    this._breathPhase = 0;
    this._exhale = 0;
    this._sniff = 0;
    this._document = typeof document === 'undefined' ? null : document;
    this._onVisibilityChange = () => {
      if (this._document.hidden) {
        // This does not depend on animation frames, which stop in background tabs.
        this._rampMaster(0, 0.025);
      } else if (this._requested && this._context) {
        void this.setEnabled(true);
      }
    };
    this._document?.addEventListener('visibilitychange', this._onVisibilityChange);
  }

  playBeat(beat) {
    const ctx=this._context;
    if(!this._enabled||ctx?.state!=='running'||this._document?.hidden)return;
    if(beat==='bite'){
      const noise=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain(),at=ctx.currentTime;
      noise.buffer=this._noise;
      filter.type='bandpass';filter.frequency.value=1850;filter.Q.value=.8;
      gain.gain.setValueAtTime(.11,at);gain.gain.exponentialRampToValueAtTime(.001,at+.03);
      gain.gain.setValueAtTime(.055,at+.043);gain.gain.exponentialRampToValueAtTime(.001,at+.083);
      noise.connect(filter);filter.connect(gain);gain.connect(this._master);
      noise.onended=()=>{noise.disconnect();filter.disconnect();gain.disconnect();};
      noise.start(at);noise.stop(at+.09);return;
    }
    if(beat!=='catch')return;
    const thud=ctx.createOscillator(),gain=ctx.createGain(),at=ctx.currentTime;
    thud.frequency.setValueAtTime(135,at);
    thud.frequency.exponentialRampToValueAtTime(58,at+.078);
    gain.gain.setValueAtTime(.0001,at);
    gain.gain.exponentialRampToValueAtTime(.16,at+.008);
    gain.gain.exponentialRampToValueAtTime(.0001,at+.095);
    thud.connect(gain);gain.connect(this._master);
    thud.onended=()=>{thud.disconnect();gain.disconnect();};
    thud.start(at);thud.stop(at+.10);
  }

  async setEnabled(enabled) {
    if (this._destroyed) return false;
    const requestId = ++this._requestId;
    this._requested = Boolean(enabled);

    if (!this._requested) {
      this._enabled = false;
      this._rampMaster(0, 0.025);
      return false;
    }

    try {
      this._init();
      if (!this._context) {
        this._requested = false;
        return false;
      }
      // Invoked in the enabling click's call stack, before yielding control.
      if (this._context.state !== 'running') await this._context.resume();
      if (this._destroyed || requestId !== this._requestId) return this._enabled;
      if (this._context.state !== 'running') throw new Error('Audio did not resume');

      this._enabled = true;
      this._mix();
      this._rampMaster(this._document?.hidden ? 0 : 0.35, 0.12);
      return true;
    } catch {
      if (requestId === this._requestId && !this._destroyed) {
        this._requested = false;
        this._enabled = false;
        this._rampMaster(0, 0.025);
      }
      return this._enabled;
    }
  }

  update(contact, speed, nowSeconds, { zone = 'body', pressure = 1, tap = 0, breathPhase, exhale = 0, sniff = 0 } = {}) {
    if (this._destroyed) return;
    this._contact = clamp01(contact);
    this._speed = clamp01(speed);
    this._zone = typeof zone === 'string' && Object.hasOwn(BRUSH_PROFILES, zone) ? zone : 'body';
    this._pressure = clamp01(pressure);
    this._tap = clamp01(tap);
    this._seconds = Number.isFinite(nowSeconds) ? nowSeconds : (this._context?.currentTime ?? 0);
    this._breathPhase = Number.isFinite(breathPhase) ? breathPhase : this._seconds * 1.35;
    this._exhale = clamp01(exhale);
    this._sniff = clamp01(sniff);
    if (!this._enabled || this._document?.hidden || this._context?.state !== 'running') return;
    this._mix();
  }

  _init() {
    if (this._context) return;
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) return;

    try {
      const context = new AudioContextClass();
      this._context = context;
      const own = (node) => { this._nodes.push(node); return node; };
      const master = own(context.createGain());
      master.gain.value = 0;
      this._master = master;
      master.connect(context.destination);

      const breathFilter = own(context.createBiquadFilter());
      breathFilter.type = 'bandpass';
      breathFilter.frequency.value = 510;
      breathFilter.Q.value = 0.65;
      const breathLowpass = own(context.createBiquadFilter());
      breathLowpass.type = 'lowpass';
      breathLowpass.frequency.value = 1500;
      breathLowpass.Q.value = 0.5;
      this._breathFilter = breathFilter;
      this._breath = own(context.createGain());
      this._breath.gain.value = 0;
      breathFilter.connect(breathLowpass);
      breathLowpass.connect(this._breath);
      this._breath.connect(master);

      const brushHighpass = own(context.createBiquadFilter());
      brushHighpass.type = 'highpass';
      brushHighpass.frequency.value = 900;
      brushHighpass.Q.value = 0.5;
      const brushLowpass = own(context.createBiquadFilter());
      brushLowpass.type = 'lowpass';
      brushLowpass.frequency.value = 4300;
      brushLowpass.Q.value = 0.5;
      this._brushHighpass = brushHighpass;
      this._brushLowpass = brushLowpass;
      this._brush = own(context.createGain());
      this._brush.gain.value = 0;
      brushHighpass.connect(brushLowpass);
      brushLowpass.connect(this._brush);
      this._brush.connect(master);

      const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 4.4), context.sampleRate);
      this._noise=buffer;
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      const noise = own(context.createBufferSource());
      this._sources.push(noise);
      noise.buffer = buffer;
      noise.loop = true;
      noise.connect(breathFilter);
      noise.connect(brushHighpass);
      noise.start();
    } catch (error) {
      this._disposeAudio();
      throw error;
    }
  }

  _mix() {
    const time = this._context.currentTime;
    const flow = Math.cos(this._breathPhase);
    const breath = Math.abs(flow) ** 1.6 * (flow > 0 ? .74 : 1);
    const smooth = (parameter, value, seconds) => {
      parameter.cancelScheduledValues(time);
      parameter.setTargetAtTime(value, time, seconds);
    };
    smooth(this._breath.gain, 0.042 * breath * (0.82 + this._contact * 0.18) + .032 * this._exhale + .028 * this._sniff, 0.09);
    smooth(this._breathFilter.frequency, 440 + 120 * breath - 95 * this._exhale + 480 * this._sniff, 0.15);
    const [low, high, level] = BRUSH_PROFILES[this._zone];
    // Pressure gently rounds the texture; faster movement opens the upper band.
    // Smooth the existing filters so changing zones never introduces a tick.
    smooth(this._brushHighpass.frequency, low * (1 - 0.16 * this._pressure + 0.10 * this._speed), 0.14);
    smooth(this._brushLowpass.frequency, high * (0.82 + 0.18 * this._speed) * (1 - 0.10 * this._pressure), 0.18);
    const stroke = 0.060 * this._contact * this._speed ** 0.62 * (0.68 + 0.32 * this._pressure);
    const contact = 0.024 * this._tap ** 1.45 * (1 - 0.55 * this._speed);
    const brushGain = Math.min(0.062, (stroke + contact) * level);
    smooth(this._brush.gain, brushGain, 0.038);
  }

  _rampMaster(value, duration) {
    if (!this._master || !this._context || this._context.state === 'closed') return;
    const gain = this._master.gain;
    const time = this._context.currentTime;
    if (typeof gain.cancelAndHoldAtTime === 'function') {
      gain.cancelAndHoldAtTime(time);
    } else {
      const current = gain.value;
      gain.cancelScheduledValues(time);
      gain.setValueAtTime(current, time);
    }
    gain.linearRampToValueAtTime(value, time + duration);
  }

  _disposeAudio() {
    for (const source of this._sources) {
      try { source.stop(); } catch { /* Already stopped or not yet started. */ }
    }
    for (const node of this._nodes) {
      try { node.disconnect(); } catch { /* Already disconnected. */ }
    }
    const context = this._context;
    this._context = null;
    this._nodes = [];
    this._sources = [];
    this._noise = this._master = this._breath = this._brush = this._breathFilter = null;
    this._brushHighpass = this._brushLowpass = null;
    if (context && context.state !== 'closed') {
      try { Promise.resolve(context.close()).catch(() => {}); } catch { /* Browser already disposed it. */ }
    }
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._enabled = false;
    this._requested = false;
    ++this._requestId;
    this._document?.removeEventListener('visibilitychange', this._onVisibilityChange);
    this._disposeAudio();
  }
}
