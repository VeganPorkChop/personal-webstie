/* ============================================================================
 * bombfinder.js — DFT explosion-vs-earthquake discriminator (browser port)
 * ----------------------------------------------------------------------------
 * The real project (C:\Users\graha\DFT_bombfindr) pulls real seismograms from
 * FDSN networks, picks the P arrival with STA/LTA, extracts frequency-domain
 * discriminants with an FFT, and classifies explosion vs earthquake. This
 * module ports the pure math verbatim — `extract_features()` and the physics
 * `heuristic_score()` from the real `features.py` / `discriminate.py` — and
 * feeds it a SYNTHETIC seismogram so the whole pipeline runs offline.
 *
 * ── How to optimize (this is the file to edit) ──────────────────────────────
 *   • `heuristicScore()` is the real transparent classifier — retune its
 *     thresholds, or replace it with weights exported from your RandomForest.
 *   • `synthTrace()` controls the physics of the fake explosion/earthquake.
 *
 * ── Public interface (consumed by demos/bombfinder.js) ──────────────────────
 *   CFG                              windows / bands (mirrors real config.py)
 *   synthTrace(kind, fs, seconds)  → { data:Float64Array, fs, truePick, kind }
 *   staLtaPick(data, fs)             → pick sample index (STA/LTA trigger)
 *   spectrum(signal, fs)             → { freqs, mag } DFT magnitude spectrum
 *   extractFeatures(data, pickIdx, fs) → feature object (the 12 discriminants)
 *   heuristicScore(feats)            → P(explosion) in [0,1]  (verbatim port)
 *   classify(feats, threshold)       → { label, p }
 * ========================================================================== */

export const CFG = {
  FREQMAX: 5.0,
  FEATURE_PRE_S: 2.0,
  FEATURE_POST_S: 40.0,
  STA_S: 2.0, LTA_S: 30.0, TRIGGER_ON: 4.0,
};

// ── Small helpers ───────────────────────────────────────────────────────────
let _spare = null;
function gauss() {                       // standard normal (Box–Muller)
  if (_spare !== null) { const s = _spare; _spare = null; return s; }
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const r = Math.sqrt(-2 * Math.log(u));
  _spare = r * Math.sin(2 * Math.PI * v);
  return r * Math.cos(2 * Math.PI * v);
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);

// ── Iterative radix-2 FFT (Cooley–Tukey), in place on re/im arrays ──────────
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wpr = Math.cos(ang), wpi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const tr = wr * re[b] - wi * im[b];
        const ti = wr * im[b] + wi * re[b];
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nwr = wr * wpr - wi * wpi;
        wi = wr * wpi + wi * wpr; wr = nwr;
      }
    }
  }
}

function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

// One-sided magnitude spectrum of a real signal (Hann-windowed, like features.py).
export function spectrum(signal, fs) {
  const n = signal.length;
  const N = nextPow2(n);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < n; i++) re[i] = signal[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  fft(re, im);
  const half = N / 2;
  const freqs = new Float64Array(half + 1), mag = new Float64Array(half + 1);
  for (let i = 0; i <= half; i++) {
    freqs[i] = (i * fs) / N;
    mag[i] = Math.hypot(re[i], im[i]);
  }
  return { freqs, mag };
}

// ── Synthetic seismogram ────────────────────────────────────────────────────
// A Ricker-like wavelet centered at t0 with center frequency fc and duration.
function wavelet(data, fs, t0, fc, amp, decay) {
  const n = data.length;
  const i0 = Math.round(t0 * fs);
  for (let i = 0; i < n; i++) {
    const t = (i - i0) / fs;
    if (t < -0.5) continue;
    const env = t < 0 ? Math.exp(t * 8) : Math.exp(-t / decay);   // sharp rise, decay tail
    data[i] += amp * env * Math.sin(2 * Math.PI * fc * t);
  }
}

export function synthTrace(kind, fs = 20, seconds = 60) {
  if (kind === 'random') kind = Math.random() < 0.5 ? 'explosion' : 'earthquake';
  const n = Math.round(fs * seconds);
  const data = new Float64Array(n);
  for (let i = 0; i < n; i++) data[i] = 0.04 * gauss();   // background noise
  const tP = 10.0;

  if (kind === 'explosion') {
    // Impulsive, HF-rich P; weak S; short coda.
    wavelet(data, fs, tP, 3.6, 1.0, 1.2);
    wavelet(data, fs, tP + 6, 2.8, 0.22, 1.0);            // weak S
    for (let i = 0; i < n; i++) {                          // short coda
      const t = (i / fs) - tP;
      if (t > 0) data[i] += 0.12 * Math.exp(-t / 3) * gauss() * 3;
    }
  } else {
    // Emergent, LF P; strong S ~8 s later; long complex coda.
    wavelet(data, fs, tP, 1.1, 0.7, 3.5);
    wavelet(data, fs, tP + 8, 0.9, 1.1, 5.0);             // strong S
    for (let i = 0; i < n; i++) {                          // long coda
      const t = (i / fs) - tP;
      if (t > 0) data[i] += 0.18 * Math.exp(-t / 18) * gauss() * 3;
    }
  }
  return { data, fs, truePick: Math.round(tP * fs), kind };
}

// ── STA/LTA P picker ────────────────────────────────────────────────────────
export function staLtaPick(data, fs) {
  const staN = Math.max(1, Math.round(CFG.STA_S * fs));
  const ltaN = Math.max(staN + 1, Math.round(CFG.LTA_S * fs));
  const cf = new Float64Array(data.length);
  for (let i = 0; i < data.length; i++) cf[i] = data[i] * data[i];
  let sta = 0, lta = 0;
  for (let i = 0; i < data.length; i++) {
    sta += cf[i] / staN - (i >= staN ? cf[i - staN] / staN : 0);
    lta += cf[i] / ltaN - (i >= ltaN ? cf[i - ltaN] / ltaN : 0);
    if (i > ltaN && lta > 1e-12 && sta / lta > CFG.TRIGGER_ON) return i - staN;
  }
  return Math.round(10 * fs);   // fallback near expected origin
}

// ── Feature extraction (ported from bombfindr/features.py) ──────────────────
function bandEnergy(freqs, psd, lo, hi) {
  let s = 0;
  for (let i = 0; i < freqs.length; i++) if (freqs[i] >= lo && freqs[i] < hi) s += psd[i];
  return s + 1e-12;
}
function kurtosis(a) {          // Fisher (excess) kurtosis
  const m = mean(a); let m2 = 0, m4 = 0;
  for (const x of a) { const d = x - m; m2 += d * d; m4 += d * d * d * d; }
  m2 /= a.length; m4 /= a.length;
  return m2 < 1e-20 ? 0 : m4 / (m2 * m2) - 3;
}
function skewness(a) {
  const m = mean(a); let m2 = 0, m3 = 0;
  for (const x of a) { const d = x - m; m2 += d * d; m3 += d * d * d; }
  m2 /= a.length; m3 /= a.length;
  return m2 < 1e-20 ? 0 : m3 / Math.pow(m2, 1.5);
}

export function extractFeatures(data, pickIndex, fs) {
  const n = data.length;
  const pre = Math.round(CFG.FEATURE_PRE_S * fs);
  const post = Math.round(CFG.FEATURE_POST_S * fs);
  const start = Math.max(0, pickIndex - pre);
  const end = Math.min(n, pickIndex + post);
  if (end - pickIndex < Math.round(5 * fs)) return null;

  const noise = pickIndex - start > Math.round(0.5 * fs)
    ? Array.from(data.slice(start, pickIndex)) : Array.from(data.slice(0, pre));
  const signal = Array.from(data.slice(pickIndex, end));
  const noiseRms = rms(noise) + 1e-12;
  const signalRms = rms(signal) + 1e-12;

  const pWin = signal.slice(0, Math.round(5 * fs));
  const sWin = signal.length > Math.round(5 * fs)
    ? signal.slice(Math.round(5 * fs), Math.round(20 * fs)) : signal;
  const coda = signal.length > Math.round(20 * fs) ? signal.slice(Math.round(20 * fs)) : signal;

  const pAmp = Math.max(...pWin.map(Math.abs)) + 1e-12;
  const sAmp = (sWin.length ? Math.max(...sWin.map(Math.abs)) : 0) + 1e-12;
  const codaAmp = (coda.length ? rms(coda) : 0) + 1e-12;
  const pToS = pAmp / sAmp;
  const pToCoda = pAmp / codaAmp;

  const { freqs, mag } = spectrum(signal, fs);
  const psd = mag.map((m) => m * m);
  const lf = bandEnergy(freqs, psd, 0.5, 2.0);
  const hf = bandEnergy(freqs, psd, 2.0, CFG.FREQMAX);
  const hfLf = hf / lf;
  let total = 1e-12; for (const p of psd) total += p;
  let centroid = 0; for (let i = 0; i < freqs.length; i++) centroid += freqs[i] * psd[i];
  centroid /= total;
  let bw = 0; for (let i = 0; i < freqs.length; i++) bw += (freqs[i] - centroid) ** 2 * psd[i];
  bw = Math.sqrt(bw / total);
  let peakI = 0; for (let i = 1; i < psd.length; i++) if (psd[i] > psd[peakI]) peakI = i;
  const peakFreq = freqs[peakI];

  const env = signal.map(Math.abs);
  let peakIdx = 0; for (let i = 1; i < env.length; i++) if (env[i] > env[peakIdx]) peakIdx = i;
  const riseTime = peakIdx / fs;

  const tail = env.slice(peakIdx);
  let codaDecay = 0;
  if (tail.length > Math.round(2 * fs)) {                 // slope of log-envelope
    const t = tail.map((_, i) => i / fs);
    const logE = tail.map((v) => Math.log(v + 1e-12));
    const tm = mean(t), lm = mean(logE);
    let num = 0, den = 0;
    for (let i = 0; i < t.length; i++) { num += (t[i] - tm) * (logE[i] - lm); den += (t[i] - tm) ** 2; }
    codaDecay = den < 1e-20 ? 0 : num / den;
  }

  const half = Math.floor(signal.length / 2);
  let earlyE = 1e-12, lateE = 1e-12;
  for (let i = 0; i < half; i++) earlyE += signal[i] ** 2;
  for (let i = half; i < signal.length; i++) lateE += signal[i] ** 2;
  const complexity = lateE / earlyE;

  return {
    p_to_s_ratio: pToS,
    p_to_coda_ratio: pToCoda,
    hf_lf_ratio: hfLf,
    spectral_centroid_hz: centroid,
    spectral_bandwidth_hz: bw,
    peak_frequency_hz: peakFreq,
    rise_time_s: riseTime,
    coda_decay_rate: codaDecay,
    complexity,
    kurtosis: kurtosis(signal),
    skewness: skewness(signal),
    snr_db: 20 * Math.log10(signalRms / noiseRms),
  };
}

// ── Transparent physics classifier (verbatim port of heuristic_score) ───────
export function heuristicScore(feats) {
  let score = 0;
  if (feats.p_to_s_ratio > 2.0) score += 0.30;
  if (feats.hf_lf_ratio > 1.0) score += 0.25;
  if (feats.spectral_centroid_hz > 2.5) score += 0.20;
  if (feats.rise_time_s < 3.0) score += 0.15;
  if (feats.complexity < 1.0) score += 0.10;
  return Math.min(score, 1.0);
}

export function classify(feats, threshold = 0.5) {
  const p = heuristicScore(feats);
  return { label: p >= threshold ? 'explosion' : 'earthquake', p };
}
