/**
 * Offline traditional Balinese Gamelan-inspired Web Audio synthesizer
 * (Pelog scale metallophones with paired "ombak" shimmer, kendang tap, and Gong Ageng).
 */
class BalineseSoundEffects {
  private ctx: AudioContext | null = null;
  public muted = false;

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  /**
   * Simulates a Balinese bronze metallophone (Gangsa / Gender) with paired
   * "pengumbang" & "pengisep" detuning (~5 Hz ombak shimmer).
   */
  private playGangsa(freq: number, duration: number, peak = 0.06, delay = 0): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    const detuneHz = 4.5;

    for (const f of [freq, freq + detuneHz]) {
      const osc = ctx.createOscillator();
      const overtone = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now);

      overtone.type = 'triangle';
      overtone.frequency.setValueAtTime(f * 2.02, now);

      const overtoneGain = ctx.createGain();
      overtoneGain.gain.setValueAtTime(0.22, now);
      overtoneGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.45);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + duration);

      osc.connect(gain);
      overtone.connect(overtoneGain);
      overtoneGain.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      overtone.start(now);
      osc.stop(now + duration + 0.03);
      overtone.stop(now + duration + 0.03);
    }
  }

  /**
   * Simulates a warm Kendang / wooden table tap.
   */
  private playKendangTap(startFreq: number, endFreq: number, duration: number, peak = 0.09): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  /**
   * Deep Gong Ageng resonance for winning Ceki!
   */
  private playGongAgeng(delay = 0.28): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    for (const f of [98, 100.5, 196]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(f < 120 ? 0.11 : 0.035, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 1.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 1.5);
    }
  }

  // Pelog-inspired frequencies: Ding (587), Dong (659), Deng (740), Dung (880), Dang (988)
  public playDraw(): void {
    this.playGangsa(587.33, 0.24, 0.045, 0);
  }

  public playDiscard(): void {
    this.playKendangTap(210, 95, 0.09, 0.1);
  }

  public playNgejuk(): void {
    this.playGangsa(659.25, 0.26, 0.055, 0);
    this.playGangsa(880.0, 0.36, 0.06, 0.08);
  }

  public playMeldFormed(): void {
    this.playGangsa(739.99, 0.28, 0.045, 0);
    this.playGangsa(987.77, 0.38, 0.05, 0.07);
  }

  public playCekiWin(): void {
    const pelogCascade = [587.33, 659.25, 739.99, 880.0, 987.77, 1174.66];
    pelogCascade.forEach((freq, idx) => {
      this.playGangsa(freq, 0.55, 0.055, idx * 0.075);
    });
    this.playGongAgeng(0.32);
  }
}

export const sfx = new BalineseSoundEffects();
