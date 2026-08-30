// ==============================================================================
// Revia Toy Sound Effects (SFX) Synthesizer - Web Audio API
// Lightweight, zero network lag, 100% offline harmonic sound synthesizer
// ==============================================================================

let audioCtx = null;
const SFX_STORAGE_KEY = "revia-sfx-enabled";

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function isSoundEnabled() {
  const saved = localStorage.getItem(SFX_STORAGE_KEY);
  return saved === null ? true : saved === "true";
}

export function setSoundEnabled(enabled) {
  localStorage.setItem(SFX_STORAGE_KEY, String(enabled));
}

export function toggleSound() {
  const next = !isSoundEnabled();
  setSoundEnabled(next);
  if (next) {
    playPop();
  }
  return next;
}

// Bubbly Button Click / Pop
export function playPop() {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const now = ctx.currentTime;
    osc.type = "sine";
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);

    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.08);
  } catch (_e) {}
}

// Smooth Card Flip / Whoosh
export function playFlip() {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const now = ctx.currentTime;
    osc.type = "triangle";
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.exponentialRampToValueAtTime(540, now + 0.12);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.22);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.22);
  } catch (_e) {}
}

// Correct Answer / "Got it!" (Cheerful Major Arpeggio C5 -> E5 -> G5 -> C6)
export function playCorrect() {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6

    notes.forEach((freq, index) => {
      const startTime = now + index * 0.07;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.24, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.25);
    });
  } catch (_e) {}
}

// Incorrect Answer / "Didn't get it" (Gentle Warm Boop)
export function playIncorrect() {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(311.13, now); // Eb4
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.2); // A3

    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.25);
  } catch (_e) {}
}

// Sparkly XP Coin / Star Chime
export function playCoin() {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const notes = [987.77, 1318.51]; // B5 -> E6

    notes.forEach((freq, idx) => {
      const start = now + idx * 0.08;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.25, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + 0.3);
    });
  } catch (_e) {}
}

// Victory Fanfare / Quiz Complete Celebration
export function playFanfare() {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    // Triumphant chords: C major -> F major -> G major -> High C
    const melody = [
      { freq: 523.25, time: 0.0, dur: 0.12 }, // C5
      { freq: 523.25, time: 0.12, dur: 0.12 }, // C5
      { freq: 523.25, time: 0.24, dur: 0.12 }, // C5
      { freq: 659.25, time: 0.36, dur: 0.22 }, // E5
      { freq: 783.99, time: 0.58, dur: 0.15 }, // G5
      { freq: 1046.5, time: 0.75, dur: 0.45 }  // C6
    ];

    melody.forEach((note) => {
      const start = now + note.time;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(note.freq, start);

      gain.gain.setValueAtTime(0.28, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + note.dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + note.dur);
    });
  } catch (_e) {}
}
