const clamp01 = (value) => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

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
    this._enabled = false;
    this._requested = false;
    this._destroyed = false;
    this._requestId = 0;
    this._contact = 0;
    this._speed = 0;
    this._seconds = 0;
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

  update(contact, speed, nowSeconds) {
    if (this._destroyed) return;
    this._contact = clamp01(contact);
    this._speed = clamp01(speed);
    this._seconds = Number.isFinite(nowSeconds) ? nowSeconds : (this._context?.currentTime ?? 0);
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
      this._brush = own(context.createGain());
      this._brush.gain.value = 0;
      brushHighpass.connect(brushLowpass);
      brushLowpass.connect(this._brush);
      this._brush.connect(master);

      const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 4.4), context.sampleRate);
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
    const phase = ((this._seconds % 4.4) + 4.4) % 4.4;
    let breath = 0;
    if (phase < 1.6) {
      breath = 0.78 * Math.sin(Math.PI * phase / 1.6) ** 1.6;
    } else if (phase > 2 && phase < 4) {
      breath = Math.sin(Math.PI * (phase - 2) / 2) ** 1.3;
    }
    const smooth = (parameter, value, seconds) => {
      parameter.cancelScheduledValues(time);
      parameter.setTargetAtTime(value, time, seconds);
    };
    smooth(this._breath.gain, 0.042 * breath * (0.82 + this._contact * 0.18), 0.09);
    smooth(this._breathFilter.frequency, 440 + 120 * breath, 0.15);
    // Moving away from the dog cannot produce a brushing sound.
    smooth(this._brush.gain, 0.035 * this._contact * this._speed, 0.055);
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
    this._master = this._breath = this._brush = this._breathFilter = null;
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
