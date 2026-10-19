/**
 * Warns about a lost connection or a stop the treadmill did not confirm: the same long-short-long
 * vibration as the Android app where the browser can vibrate (Android), and three beeps, since
 * iPhone browsers cannot vibrate.
 */
export class Alarm {
  /** @type {AudioContext | null} */
  #audio = null;

  /** Browsers only allow sound after a tap, so every tap calls this. */
  unlock() {
    const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      this.#audio ??= new AudioContextClass();
      if (this.#audio.state === 'suspended') this.#audio.resume().catch(() => {});
    } catch {
      this.#audio = null;
    }
  }

  alert() {
    try {
      navigator.vibrate?.([500, 150, 500, 150, 500]);
    } catch {
      // vibration blocked: the sound and the banner remain
    }
    this.#beep();
  }

  #beep() {
    const audio = this.#audio;
    if (!audio || audio.state !== 'running') return;
    const start = audio.currentTime + 0.05;
    for (let i = 0; i < 3; i++) {
      const at = start + i * 0.65;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = 'square';
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.4, at + 0.02);
      gain.gain.setValueAtTime(0.4, at + 0.45);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.52);
    }
  }
}
