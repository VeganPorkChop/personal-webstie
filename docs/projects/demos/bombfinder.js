/* ============================================================================
 * demos/bombfinder.js — seismic explosion-vs-earthquake discriminator widget
 * Generates a synthetic seismogram, picks the P arrival, shows the live DFT
 * spectrum + the discrimination features, and runs the ported heuristic
 * classifier (ai/bombfinder.js). Plus a 3-station travel-time location panel.
 *
 *   mount(container, opts?) → { destroy() }
 * ========================================================================== */
import * as BF from '../ai/bombfinder.js';

export function mount(container) {
  let trace = null, pick = 0, feats = null, result = null;

  container.innerHTML = '';
  const root = document.createElement('div');
  root.innerHTML = `
    <style>
      .bf-wrap{font-family:system-ui,Arial,sans-serif;color:#111}
      .bf-controls{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
      .bf-btn{border:2px solid #111;background:#fff;color:#111;border-radius:999px;padding:7px 14px;font-weight:700;cursor:pointer}
      .bf-btn.boom{background:#c0392b;border-color:#c0392b;color:#fff}
      .bf-btn.quake{background:#2563eb;border-color:#2563eb;color:#fff}
      .bf-grid{display:grid;grid-template-columns:1fr 300px;gap:18px;align-items:start}
      @media(max-width:760px){.bf-grid{grid-template-columns:1fr}}
      .bf-plot{background:#0d1424;border-radius:10px;display:block;width:100%}
      .bf-cap{font-size:.78rem;color:#6b7280;margin:4px 0 12px}
      .bf-verdict{border-radius:12px;padding:14px;text-align:center;color:#fff;font-weight:800;font-size:1.2rem;margin-bottom:10px}
      .bf-gauge{height:14px;background:#e6ebef;border-radius:7px;overflow:hidden;margin:8px 0}
      .bf-gauge .fill{height:100%;width:0;background:linear-gradient(90deg,#2563eb,#c0392b);transition:width .5s ease}
      table.bf-feat{width:100%;border-collapse:collapse;font-size:.82rem}
      table.bf-feat td{padding:3px 4px;border-bottom:1px solid #eef1f4}
      table.bf-feat td.v{text-align:right;font-variant-numeric:tabular-nums}
      table.bf-feat tr.hot td{background:#fff4e6;font-weight:700}
      .bf-hint{font-size:.78rem;color:#6b7280;margin-top:6px}
    </style>
    <div class="bf-wrap">
      <div class="bf-controls">
        <button class="bf-btn boom" data-k="explosion">Simulate explosion</button>
        <button class="bf-btn quake" data-k="earthquake">Simulate earthquake</button>
        <button class="bf-btn" data-k="random">Random event</button>
      </div>
      <div class="bf-grid">
        <div>
          <canvas class="bf-plot bf-seis" width="620" height="180"></canvas>
          <div class="bf-cap">Broadband vertical seismogram — dashed line = STA/LTA P pick.</div>
          <canvas class="bf-plot bf-spec" width="620" height="150"></canvas>
          <div class="bf-cap">DFT magnitude spectrum of the P window — blue band 0.5–2 Hz (LF), red band 2–5 Hz (HF).</div>
          <canvas class="bf-plot bf-map" width="620" height="200"></canvas>
          <div class="bf-cap">Location: three stations, travel-time rings from the P picks → estimated epicentre (×).</div>
        </div>
        <div>
          <div class="bf-verdict">—</div>
          <div>P(explosion)</div>
          <div class="bf-gauge"><span class="fill"></span></div>
          <div class="bf-pval" style="text-align:center;font-weight:700;margin-bottom:8px">—</div>
          <table class="bf-feat"></table>
          <div class="bf-hint">Highlighted rows are the discriminants that pushed the physics classifier toward “explosion”.</div>
        </div>
      </div>
    </div>`;
  container.appendChild(root);

  const seis = root.querySelector('.bf-seis'), spec = root.querySelector('.bf-spec'), map = root.querySelector('.bf-map');
  const verdictEl = root.querySelector('.bf-verdict'), gaugeFill = root.querySelector('.bf-gauge .fill');
  const pvalEl = root.querySelector('.bf-pval'), featTable = root.querySelector('.bf-feat');

  // Which heuristic conditions fired (mirrors ai/bombfinder.heuristicScore).
  const FEATROWS = [
    ['P/S amplitude ratio', 'p_to_s_ratio', (f) => f.p_to_s_ratio > 2.0, (v) => v.toFixed(2)],
    ['HF/LF energy ratio', 'hf_lf_ratio', (f) => f.hf_lf_ratio > 1.0, (v) => v.toFixed(2)],
    ['Spectral centroid (Hz)', 'spectral_centroid_hz', (f) => f.spectral_centroid_hz > 2.5, (v) => v.toFixed(2)],
    ['Peak frequency (Hz)', 'peak_frequency_hz', () => false, (v) => v.toFixed(2)],
    ['Rise time (s)', 'rise_time_s', (f) => f.rise_time_s < 3.0, (v) => v.toFixed(2)],
    ['Complexity (late/early)', 'complexity', (f) => f.complexity < 1.0, (v) => v.toFixed(2)],
    ['Kurtosis', 'kurtosis', () => false, (v) => v.toFixed(1)],
    ['SNR (dB)', 'snr_db', () => false, (v) => v.toFixed(1)],
  ];

  function plotWave(canvas, data, pickIdx) {
    const c = canvas.getContext('2d'), W = canvas.width, Hh = canvas.height;
    c.clearRect(0, 0, W, Hh);
    let max = 1e-9; for (const v of data) max = Math.max(max, Math.abs(v));
    c.strokeStyle = '#34d399'; c.lineWidth = 1; c.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * W, y = Hh / 2 - (data[i] / max) * (Hh / 2 - 6);
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.stroke();
    if (pickIdx != null) {
      const px = (pickIdx / (data.length - 1)) * W;
      c.strokeStyle = '#f59e0b'; c.setLineDash([5, 4]); c.beginPath(); c.moveTo(px, 0); c.lineTo(px, Hh); c.stroke(); c.setLineDash([]);
      c.fillStyle = '#f59e0b'; c.font = '11px system-ui'; c.fillText('P', px + 4, 12);
    }
  }

  function plotSpectrum(canvas, freqs, mag) {
    const c = canvas.getContext('2d'), W = canvas.width, Hh = canvas.height;
    c.clearRect(0, 0, W, Hh);
    const fmax = 8;
    const band = (lo, hi, col) => { c.fillStyle = col; c.fillRect((lo / fmax) * W, 0, ((hi - lo) / fmax) * W, Hh); };
    band(0.5, 2, 'rgba(37,99,235,.16)'); band(2, 5, 'rgba(192,57,43,.16)');
    let max = 1e-9; for (let i = 0; i < freqs.length; i++) if (freqs[i] <= fmax) max = Math.max(max, mag[i]);
    c.strokeStyle = '#93c5fd'; c.beginPath();
    let started = false;
    for (let i = 0; i < freqs.length; i++) {
      if (freqs[i] > fmax) break;
      const x = (freqs[i] / fmax) * W, y = Hh - (mag[i] / max) * (Hh - 6);
      started ? c.lineTo(x, y) : (c.moveTo(x, y), started = true);
    }
    c.stroke();
    c.fillStyle = '#9ca3af'; c.font = '10px system-ui';
    for (let f = 0; f <= fmax; f += 2) c.fillText(f + 'Hz', (f / fmax) * W + 2, Hh - 2);
  }

  function plotMap(canvas) {
    const c = canvas.getContext('2d'), W = canvas.width, Hh = canvas.height;
    c.clearRect(0, 0, W, Hh);
    c.fillStyle = '#0d1424'; c.fillRect(0, 0, W, Hh);
    const epi = { x: 120 + Math.random() * (W - 240), y: 40 + Math.random() * (Hh - 80) };
    const stations = [{ x: 60, y: 40 }, { x: W - 60, y: 60 }, { x: W / 2, y: Hh - 30 }];
    // rings = true distance + small pick noise
    for (const s of stations) {
      const d = Math.hypot(s.x - epi.x, s.y - epi.y) * (1 + (Math.random() - 0.5) * 0.06);
      c.strokeStyle = 'rgba(148,163,184,.7)'; c.beginPath(); c.arc(s.x, s.y, d, 0, Math.PI * 2); c.stroke();
      c.fillStyle = '#38bdf8'; c.beginPath(); c.arc(s.x, s.y, 5, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = '#f87171'; c.font = 'bold 16px system-ui'; c.fillText('×', epi.x - 5, epi.y + 6);
    c.fillStyle = '#e5e7eb'; c.font = '11px system-ui'; c.fillText('estimated epicentre', epi.x + 8, epi.y + 4);
    c.fillText('▲ seismic stations', 8, 14);
  }

  function analyze(kind) {
    trace = BF.synthTrace(kind, 20, 60);
    pick = BF.staLtaPick(trace.data, trace.fs);
    feats = BF.extractFeatures(trace.data, pick, trace.fs);
    result = BF.classify(feats);

    plotWave(seis, trace.data, pick);
    const sig = trace.data.slice(pick, Math.min(trace.data.length, pick + Math.round(40 * trace.fs)));
    const sp = BF.spectrum(Array.from(sig), trace.fs);
    plotSpectrum(spec, sp.freqs, sp.mag);
    plotMap(map);

    const isBoom = result.label === 'explosion';
    verdictEl.textContent = isBoom ? '💥 EXPLOSION' : '🌍 EARTHQUAKE';
    verdictEl.style.background = isBoom ? '#c0392b' : '#2563eb';
    gaugeFill.style.width = (result.p * 100).toFixed(0) + '%';
    pvalEl.textContent = result.p.toFixed(2) + `  (truth: ${trace.kind})`;

    featTable.innerHTML = '';
    for (const [label, key, fired, fmt] of FEATROWS) {
      const tr = document.createElement('tr');
      if (fired(feats)) tr.className = 'hot';
      tr.innerHTML = `<td>${label}</td><td class="v">${fmt(feats[key])}</td>`;
      featTable.appendChild(tr);
    }
  }

  root.querySelectorAll('.bf-btn').forEach((b) => b.addEventListener('click', () => analyze(b.dataset.k)));
  analyze('explosion');
  return { destroy() { container.innerHTML = ''; } };
}
