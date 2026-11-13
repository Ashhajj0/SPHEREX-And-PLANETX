import React, { useEffect, useState } from 'react';

type Link = {
  id: string; ra_deg: number; dec_deg: number; ra_b_deg: number; dec_b_deg: number;
  x_a: number; y_a: number; x_b: number; y_b: number;
  motion_arcsec: number; motion_err_arcsec: number; significance: number; pa_deg: number;
  snr_a: number; snr_b: number;
};
type Pair = {
  id: string; detector: number; wavelength_um: number; wavelength_b_um: number;
  time_a: string; time_b: string; days_apart: number; width: number; height: number;
  image_a: string; image_b: string; image_diff: string;
  alignment: { n_matched: number; offset_ra_arcsec: number; offset_dec_arcsec: number; rms_arcsec: number };
  stationary_tolerance_arcsec: number; default_threshold_arcsec: number;
  n_sources_a: number; n_sources_b: number; n_stationary: number; links: Link[];
};
type Index = {
  doi: string; settings: { min_days: number; wavelength_tolerance: number; min_snr: number; max_link_arcsec: number };
  pairs: Pair[];
};

const MINT = '#3DDBB0';
const panel = 'rounded-xl bg-surface-container-lowest border border-surface-container-high';

const Pane: React.FC<{
  title: string; src: string; pair: Pair;
  rings: { x: number; y: number; id: string }[]; arrows?: Link[];
  selected: string | null; onPick: (id: string) => void;
}> = ({ title, src, pair, rings, arrows, selected, onPick }) => {
  const W = pair.width, H = pair.height;
  const cx = (x: number) => x + 0.5;
  const cy = (y: number) => H - y - 0.5;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-on-surface-variant font-semibold">{title}</div>
      <div className="relative w-full" style={{ aspectRatio: `${W} / ${H}`, background: '#12171C' }}>
        <img src={src} alt={title} className="absolute inset-0 w-full h-full" style={{ imageRendering: 'pixelated' }} />
        <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${W} ${H}`}>
          {arrows && arrows.map((l) => (
            <line key={'a' + l.id} x1={cx(l.x_a)} y1={cy(l.y_a)} x2={cx(l.x_b)} y2={cy(l.y_b)}
              stroke={MINT} strokeWidth={0.5} strokeDasharray="1.5 1" opacity={0.9} />
          ))}
          {rings.map((r) => (
            <circle key={r.id} cx={cx(r.x)} cy={cy(r.y)} r={selected === r.id ? 6 : 4}
              fill="rgba(0,0,0,0)" stroke={MINT} strokeWidth={selected === r.id ? 1.2 : 0.7}
              style={{ cursor: 'pointer' }} onClick={() => onPick(r.id)} />
          ))}
        </svg>
      </div>
    </div>
  );
};

export const MovingObjectsPage: React.FC<any> = () => {
  const [index, setIndex] = useState<Index | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [pairIdx, setPairIdx] = useState(0);
  const [threshold, setThreshold] = useState(6.15);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/real/moving/index.json')
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((j: Index) => {
        if (!alive) return;
        if (!j.pairs || j.pairs.length === 0) { setState('missing'); return; }
        setIndex(j);
        setThreshold(j.pairs[0].default_threshold_arcsec);
        setState('ready');
      })
      .catch(() => { if (alive) setState('missing'); });
    return () => { alive = false; };
  }, []);

  const header = (
    <div className="flex flex-col gap-1 mb-4">
      <h1 className="text-2xl font-semibold text-on-surface">Moving-object screening</h1>
      <p className="text-sm text-on-surface-variant">
        Position changes between two epochs of the same field. Results are candidates only.
      </p>
    </div>
  );

  if (state === 'loading') {
    return <div className="p-6 text-sm text-on-surface-variant">{header}Loading...</div>;
  }

  if (state === 'missing' || !index) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        {header}
        <div className={`${panel} p-5 flex flex-col gap-3 text-sm text-on-surface-variant`}>
          <div className="text-on-surface font-semibold">Not available in this build</div>
          <p>
            Screening needs two exposures of the same detector at similar wavelength, taken at least
            14 days apart. The main dataset (120 exposures) was observed within about 3 days, and no
            second-epoch file set is present.
          </p>
          <p>To generate it: run pipeline/get_epoch_b.py, then python -m backend.compute.moving_candidates.</p>
        </div>
      </div>
    );
  }

  const pair = index.pairs[pairIdx];
  const shown = pair.links.filter((l) => l.motion_arcsec >= threshold);
  const selLink = shown.find((l) => l.id === selected) || null;

  const changePair = (i: number) => {
    setPairIdx(i);
    setThreshold(index.pairs[i].default_threshold_arcsec);
    setSelected(null);
  };

  return (
    <div className="p-4 md:p-6 w-full">
      {header}
      <div className="flex flex-wrap items-center gap-3 mb-4 text-xs text-on-surface-variant">
        <label className="flex items-center gap-2">
          Epoch pair
          <select className="bg-surface-container-low border border-surface-container-high rounded px-2 py-1 text-on-surface"
            value={pairIdx} onChange={(e) => changePair(Number(e.target.value))}>
            {index.pairs.map((p, i) => (
              <option key={p.id} value={i}>
                {p.id}: detector {p.detector}, {p.wavelength_um.toFixed(2)} µm, {p.time_a.slice(0, 10)} to {p.time_b.slice(0, 10)} ({p.days_apart.toFixed(0)} days)
              </option>
            ))}
          </select>
        </label>
        <span className="px-2 py-1 rounded border border-surface-container-high">Real SPHEREx · epoch A: QR2, epoch B: DR1 deep fields · DOI {index.doi}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
        <Pane title={`Epoch A, ${pair.time_a.slice(0, 10)}`} src={`/real/${pair.image_a}`} pair={pair}
          rings={shown.map((l) => ({ x: l.x_a, y: l.y_a, id: l.id }))} selected={selected} onPick={setSelected} />
        <Pane title={`Epoch B, ${pair.time_b.slice(0, 10)}`} src={`/real/${pair.image_b}`} pair={pair}
          rings={shown.map((l) => ({ x: l.x_b, y: l.y_b, id: l.id }))} selected={selected} onPick={setSelected} />
        <Pane title="Difference (A − B): red = A brighter, blue = B brighter" src={`/real/${pair.image_diff}`} pair={pair}
          rings={shown.map((l) => ({ x: l.x_a, y: l.y_a, id: l.id }))} arrows={shown} selected={selected} onPick={setSelected} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className={`${panel} p-4 flex flex-col gap-3 text-xs text-on-surface-variant`}>
          <div className="text-on-surface font-semibold text-sm">Threshold</div>
          <input type="range" min={3} max={60} step={0.5} value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))} />
          <div>
            Position change at least <span className="text-on-surface font-semibold">{threshold.toFixed(1)} arcsec</span>:{' '}
            <span className="text-on-surface font-semibold">{shown.length}</span> candidate{shown.length === 1 ? '' : 's'}
          </div>
          <div className="text-on-surface font-semibold text-sm mt-2">Alignment</div>
          <div>Stationary stars matched: {pair.alignment.n_matched}</div>
          <div>Offset removed: {pair.alignment.offset_ra_arcsec.toFixed(2)}″ (RA), {pair.alignment.offset_dec_arcsec.toFixed(2)}″ (Dec)</div>
          <div>Residual scatter: {pair.alignment.rms_arcsec.toFixed(2)}″</div>
          <div>Sources A / B: {pair.n_sources_a} / {pair.n_sources_b} (signal-to-noise ≥ {index.settings.min_snr})</div>
          <div>Treated as stationary: within {pair.stationary_tolerance_arcsec.toFixed(1)}″ ({pair.n_stationary} sources)</div>
          <div>Wavelength match: {pair.wavelength_um.toFixed(3)} vs {pair.wavelength_b_um.toFixed(3)} µm (tolerance {(index.settings.wavelength_tolerance * 100).toFixed(0)}%)</div>
        </div>

        <div className={`${panel} p-4 lg:col-span-2 flex flex-col gap-2`}>
          <div className="flex items-center justify-between">
            <div className="text-on-surface font-semibold text-sm">Candidates</div>
            <div className="text-xs text-on-surface-variant">Candidates need independent confirmation.</div>
          </div>
          {shown.length === 0 ? (
            <div className="text-xs text-on-surface-variant py-6 text-center">
              No position change above {threshold.toFixed(1)} arcsec in this pair. Lower the threshold or pick another pair.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-on-surface-variant border-b border-surface-container-high">
                    <th className="py-2 pr-3">ID</th><th className="pr-3">RA, Dec (epoch A)</th>
                    <th className="pr-3">Motion</th><th className="pr-3">PA</th>
                    <th className="pr-3">SNR A / B</th><th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((l) => (
                    <tr key={l.id} onClick={() => setSelected(l.id)}
                      className="cursor-pointer border-b border-surface-container-high/50"
                      style={{ background: selected === l.id ? 'rgba(61,219,176,0.10)' : undefined }}>
                      <td className="py-2 pr-3 font-semibold text-on-surface">{l.id}</td>
                      <td className="pr-3">{l.ra_deg.toFixed(4)}, {l.dec_deg.toFixed(4)}</td>
                      <td className="pr-3">{l.motion_arcsec.toFixed(1)} ± {l.motion_err_arcsec.toFixed(1)}″</td>
                      <td className="pr-3">{l.pa_deg.toFixed(0)}°</td>
                      <td className="pr-3">{l.snr_a.toFixed(0)} / {l.snr_b.toFixed(0)}</td>
                      <td><span className="px-2 py-0.5 rounded text-[10px]" style={{ color: MINT, border: `1px solid ${MINT}` }}>Candidate</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {selLink && (
            <div className="text-xs text-on-surface-variant mt-1">
              {selLink.id}: epoch A at {selLink.ra_deg.toFixed(5)}, {selLink.dec_deg.toFixed(5)}; epoch B (after alignment) at{' '}
              {selLink.ra_b_deg.toFixed(5)}, {selLink.dec_b_deg.toFixed(5)}. Significance {selLink.significance.toFixed(1)} × scatter.
            </div>
          )}
          <p className="text-[11px] text-on-surface-variant mt-2">
            A position change between two small cutouts is often caused by image artifacts (cosmic-ray hits, flagged pixels),
            noise, or two unrelated sources being paired. Sources are linked only if their brightness is within a factor of 2.5,
            both are detected at signal-to-noise ≥ {index.settings.min_snr}, and they are less than {index.settings.max_link_arcsec}″ apart.
          </p>
        </div>
      </div>
    </div>
  );
};

export default MovingObjectsPage;