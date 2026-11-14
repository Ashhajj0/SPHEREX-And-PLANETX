import React, { useState, useEffect, useMemo } from 'react';
import { RealDataset, EpochPair } from '../data/real.ts';
import { DataSourceChip } from './DataSourceChip.tsx';
import { BENCHMARK_MOVING_OBJECTS, MovingObject } from '../data/spherexData.ts';

interface MovingObjectsPageProps {
  dataSource?: 'real' | 'fixture';
  realDataset?: RealDataset | null;
}

type ViewerMode = 'epoch1' | 'epoch2' | 'blink' | 'diff';

export const MovingObjectsPage: React.FC<MovingObjectsPageProps> = ({
  dataSource = 'fixture',
  realDataset,
}) => {
  // Extract observation date range and span directly from real exposures
  const { dateRange, daySpanLabel } = (() => {
    if (realDataset?.exposures?.length) {
      const timestamps = realDataset.exposures
        .map((e) => Date.parse(e.time_utc))
        .filter((t) => !Number.isNaN(t))
        .sort((a, b) => a - b);
      const dates = realDataset.exposures
        .map((e) => e.time_utc.split('T')[0])
        .filter(Boolean)
        .sort();
      if (dates.length > 0) {
        const spanDays =
          timestamps.length >= 2
            ? Math.max(1, Math.round((timestamps[timestamps.length - 1] - timestamps[0]) / 86400000))
            : 3;
        return {
          dateRange: `${dates[0]} and ${dates[dates.length - 1]}`,
          daySpanLabel: `${spanDays} days`,
        };
      }
    }
    return { dateRange: '2025-04-24 and 2025-04-27', daySpanLabel: '3 days' };
  })();

  const exposureCount = realDataset?.manifest?.counts?.exposures ?? realDataset?.exposures?.length ?? 120;
  const epochPairs: EpochPair[] = realDataset?.manifest?.epoch_pairs || [];
  const regionName = realDataset?.manifest?.region?.name || 'North Ecliptic Pole Deep Field (NEP)';

  // Selected real epoch pair (when epochPairs.length > 0)
  const [selectedPairIdx, setSelectedPairIdx] = useState<number>(0);
  const selectedRealPair = epochPairs[selectedPairIdx] || null;

  // Interactive Workbench (Panel 2 — Fixture Benchmark & Proper-Motion Lab)
  const [selectedObjectId, setSelectedObjectId] = useState<string>(BENCHMARK_MOVING_OBJECTS[0].id);
  const selectedObject: MovingObject = useMemo(
    () => BENCHMARK_MOVING_OBJECTS.find((m) => m.id === selectedObjectId) || BENCHMARK_MOVING_OBJECTS[0],
    [selectedObjectId]
  );

  // Interactive Screening Parameters (default tuned per object type)
  const [baselineDays, setBaselineDays] = useState<number>(183);
  const [wavelengthDiffPct, setWavelengthDiffPct] = useState<number>(0.4);
  const [viewerMode, setViewerMode] = useState<ViewerMode>('blink');
  const [blinkEpoch, setBlinkEpoch] = useState<1 | 2>(1);

  // Update default baseline when switching between PM stars (183 days) & NEOs (21 days)
  useEffect(() => {
    if (selectedObject.id === 'MO-EROS-433' || selectedObject.id === 'MO-PHAETHON-3200') {
      setBaselineDays(21);
    } else {
      setBaselineDays(183);
    }
    setWavelengthDiffPct(0.4);
  }, [selectedObject.id]);

  // Blink animation timer when viewerMode === 'blink'
  useEffect(() => {
    if (viewerMode !== 'blink') return;
    const timer = setInterval(() => {
      setBlinkEpoch((prev) => (prev === 1 ? 2 : 1));
    }, 650);
    return () => clearInterval(timer);
  }, [viewerMode]);

  // Live screening evaluation
  const timePasses = baselineDays >= 14;
  const wavePasses = wavelengthDiffPct <= 2.0;
  const overallPasses = timePasses && wavePasses;

  // Compute cumulative angular shift from epoch 1 rates (dRA, dDEC are arcsec/hr)
  const e1 = selectedObject.epochs[0];
  const e2 = selectedObject.epochs[1] || selectedObject.epochs[0];
  const rateArcsecPerHr = Math.hypot(e1.dRA, e1.dDEC);
  const totalShiftArcsec = rateArcsecPerHr * baselineDays * 24;
  const totalShiftPixels = totalShiftArcsec / 6.15;

  // Sky Viewer vector scaling (bounded inside 280x220 viewport so fast NEOs stay inside frame)
  const viewerW = 280;
  const viewerH = 220;
  const dirX = rateArcsecPerHr > 0 ? e1.dRA / rateArcsecPerHr : 0.7;
  const dirY = rateArcsecPerHr > 0 ? -e1.dDEC / rateArcsecPerHr : -0.7; // north = up (-y)
  // Scale shift visually up to 58px max displacement
  const visualDisp = Math.min(58, Math.max(4, totalShiftPixels * 4.5));
  const cx1 = viewerW / 2 - (dirX * visualDisp) / 2;
  const cy1 = viewerH / 2 - (dirY * visualDisp) / 2;
  const cx2 = viewerW / 2 + (dirX * visualDisp) / 2;
  const cy2 = viewerH / 2 + (dirY * visualDisp) / 2;

  // Deterministic background field stars (stationary across both epochs)
  const backgroundStars = useMemo(() => {
    const stars: Array<{ x: number; y: number; r: number; opacity: number }> = [];
    for (let i = 0; i < 24; i++) {
      const x = 18 + ((Math.sin(i * 73.1 + 11.4) * 0.5 + 0.5) * (viewerW - 36));
      const y = 18 + ((Math.cos(i * 41.9 + 7.2) * 0.5 + 0.5) * (viewerH - 36));
      const r = 1.0 + ((Math.sin(i * 19.3) * 0.5 + 0.5) * 1.4);
      const opacity = 0.35 + ((Math.cos(i * 9.7) * 0.5 + 0.5) * 0.5);
      stars.push({ x, y, r, opacity });
    }
    return stars;
  }, []);

  // Reflectance chart geometry
  const refData = selectedObject.reflectanceCurve;
  const minRef = useMemo(() => Math.max(0, Math.min(...refData.map((d) => d.reflectance - d.error)) - 0.08), [refData]);
  const maxRef = useMemo(() => Math.max(...refData.map((d) => d.reflectance + d.error)) + 0.08, [refData]);
  const rChartW = 470;
  const rChartH = 140;
  const rPadL = 52;
  const rPadT = 18;
  const getRefX = (wl: number) => rPadL + ((wl - 0.75) / (5.0 - 0.75)) * rChartW;
  const getRefY = (val: number) =>
    rPadT + (1 - (val - minRef) / Math.max(0.05, maxRef - minRef)) * rChartH;

  const refPath = useMemo(() => {
    return refData
      .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${getRefX(pt.wavelength)} ${getRefY(pt.reflectance)}`)
      .join(' ');
  }, [refData, minRef, maxRef]);

  return (
    <div className="w-full pt-14 pb-12 flex-1 flex flex-col bg-surface">
      {/* Page Header */}
      <div className="w-full bg-surface-container-lowest border-b border-surface-container-high/60 px-gutter py-4">
        <div className="max-w-6xl mx-auto flex flex-col gap-1">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-space-sm">
              <span className="w-2 h-2 rounded-full bg-secondary"></span>
              <span className="font-label-editorial text-label-editorial tracking-[0.2em] uppercase text-outline">
                Solar System & Proper-Motion Baseline · {regionName}
              </span>
            </div>
            <DataSourceChip dataSource={dataSource} />
          </div>

          <h1 className="font-headline-lg text-headline-lg text-on-surface">
            Moving-object screening
          </h1>
          <p className="font-body-md text-on-surface-variant max-w-3xl font-light">
            Multi-epoch candidate screening, proper-motion shift estimation, and 0.75–5.0 µm reflectance inspection across survey passes.
          </p>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-6xl mx-auto w-full px-gutter py-8 flex flex-col gap-8 flex-1">
        {/* =================================================================
            PANEL 1: ACTIVE DATASET BASELINE AUDIT (STRICTLY HONEST)
           ================================================================= */}
        {epochPairs.length > 0 ? (
          <div className="w-full p-6 rounded-2xl bg-surface-container-lowest border border-surface-container-high shadow-xl flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-container-high pb-3">
              <div>
                <h2 className="font-headline-sm text-xl font-bold text-on-surface">
                  Active Dataset: Qualifying Multi-Epoch Exposure Pairs ({epochPairs.length})
                </h2>
                <p className="font-body-sm text-xs text-on-surface-variant mt-1">
                  Same detector array, central wavelength within 2 percent, observed between {dateRange}.
                </p>
              </div>
              <span className="px-2.5 py-1 rounded bg-secondary/15 text-secondary border border-secondary/40 font-data-mono-sm text-xs">
                &ge; 14 days baseline · Real SPHEREx QR2
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <div className="lg:col-span-7 overflow-x-auto max-h-72 overflow-y-auto border border-surface-container-high rounded-lg">
                <table className="w-full text-left font-data-mono-sm text-xs border-collapse">
                  <thead className="sticky top-0 bg-surface-container-low border-b border-surface-container-high text-outline text-[11px]">
                    <tr>
                      <th className="py-2 px-3">Detector</th>
                      <th className="py-2 px-3">Epoch 1</th>
                      <th className="py-2 px-3">Epoch 2</th>
                      <th className="py-2 px-3">Separation</th>
                      <th className="py-2 px-3">Wavelength &Delta;</th>
                    </tr>
                  </thead>
                  <tbody>
                    {epochPairs.slice(0, 50).map((pair, idx) => (
                      <tr
                        key={idx}
                        onClick={() => setSelectedPairIdx(idx)}
                        className={`border-b border-surface-container-high/40 cursor-pointer transition-colors ${
                          selectedPairIdx === idx
                            ? 'bg-primary/15 text-on-surface font-semibold'
                            : 'hover:bg-surface-container/40'
                        }`}
                      >
                        <td className="py-2 px-3 text-secondary font-bold">LVF {pair.detector}</td>
                        <td className="py-2 px-3 text-on-surface">
                          {pair.epoch_1.id} ({pair.epoch_1.time_utc?.split('T')[0]}) · {pair.epoch_1.wavelength_um?.toFixed(3)} µm
                        </td>
                        <td className="py-2 px-3 text-on-surface">
                          {pair.epoch_2.id} ({pair.epoch_2.time_utc?.split('T')[0]}) · {pair.epoch_2.wavelength_um?.toFixed(3)} µm
                        </td>
                        <td className="py-2 px-3 text-primary font-semibold">{pair.separation_days.toFixed(1)} days</td>
                        <td className="py-2 px-3 text-outline">{pair.wavelength_diff_pct.toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selectedRealPair && (
                <div className="lg:col-span-5 p-4 rounded-xl bg-surface-container-low border border-surface-container-high flex flex-col justify-between gap-3 font-data-mono-sm text-xs">
                  <div className="flex items-center justify-between border-b border-surface-container-high/60 pb-2">
                    <span className="text-secondary font-bold">
                      Pair Inspector · LVF {selectedRealPair.detector}
                    </span>
                    <span className="text-primary font-bold">
                      {selectedRealPair.separation_days.toFixed(1)} days apart
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-2.5 rounded bg-surface-container-lowest border border-surface-container-high">
                      <div className="text-[10px] text-outline uppercase">Epoch 1</div>
                      <div className="text-sm font-bold text-on-surface mt-0.5">{selectedRealPair.epoch_1.id}</div>
                      <div className="text-[11px] text-on-surface-variant">{selectedRealPair.epoch_1.time_utc?.split('T')[0]}</div>
                      <div className="text-[11px] text-secondary mt-1">{selectedRealPair.epoch_1.wavelength_um?.toFixed(3)} µm</div>
                    </div>
                    <div className="p-2.5 rounded bg-surface-container-lowest border border-surface-container-high">
                      <div className="text-[10px] text-outline uppercase">Epoch 2</div>
                      <div className="text-sm font-bold text-on-surface mt-0.5">{selectedRealPair.epoch_2.id}</div>
                      <div className="text-[11px] text-on-surface-variant">{selectedRealPair.epoch_2.time_utc?.split('T')[0]}</div>
                      <div className="text-[11px] text-secondary mt-1">{selectedRealPair.epoch_2.wavelength_um?.toFixed(3)} µm</div>
                    </div>
                  </div>

                  <div className="text-[11px] text-on-surface-variant">
                    Wavelength offset: <span className="text-on-surface font-semibold">{selectedRealPair.wavelength_diff_pct.toFixed(2)}%</span> (threshold &le; 2.00%). Click any row in the pair table to compare epochs.
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="w-full p-6 md:p-7 rounded-2xl bg-surface-container-lowest border border-surface-container-high shadow-xl flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-secondary border border-surface-container-high shrink-0">
                  <span className="material-symbols-outlined text-[22px]">schedule</span>
                </div>
                <div>
                  <h2 className="font-headline-sm text-lg font-bold text-on-surface">
                    Active Dataset Baseline Check: Moving Objects Mode Not Available for this Dataset
                  </h2>
                  <p className="font-body-sm text-xs md:text-sm text-on-surface-variant">
                    All <strong className="text-on-surface font-semibold">{exposureCount} exposures</strong> in this dataset were taken between{' '}
                    <strong className="text-on-surface font-semibold">{dateRange}</strong>.
                  </p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded bg-surface-container text-outline border border-surface-container-high font-data-mono-sm text-xs">
                Baseline: {daySpanLabel} (&lt; 14 days)
              </span>
            </div>

            {/* Screening Requirements (Project Criteria) */}
            <div className="w-full p-4 rounded-xl bg-surface-container-low border border-surface-container-high/80 text-left flex flex-col gap-2">
              <span className="text-xs font-data-mono-sm uppercase tracking-wider text-secondary font-semibold">
                Screening requirements (project criteria)
              </span>
              <ul className="text-xs text-on-surface-variant font-data-mono-sm space-y-1.5 list-disc list-inside">
                <li>
                  Time baseline: our rule requires two exposures at least 14 days apart.
                </li>
                <li>
                  Detector pairing: same detector array and central wavelength within 2 percent, so both images sample the same part of the spectrum.
                </li>
                <li>
                  This dataset: all {exposureCount} exposures were taken within about {daySpanLabel} (dates read from exposures.json), so no pair qualifies.
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* =================================================================
            PANEL 2: INTERACTIVE MOVING-OBJECT & PROPER-MOTION WORKBENCH
           ================================================================= */}
        <div className="w-full p-6 md:p-7 rounded-2xl bg-surface-container-lowest border border-amber-500/35 shadow-xl flex flex-col gap-6">
          {/* Header & Object Selector */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-surface-container-high pb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/40 font-data-mono-sm text-[10px] uppercase font-bold tracking-wider">
                  Fixture Benchmark & Proper-Motion Lab
                </span>
                <span className="font-data-mono-sm text-[11px] text-outline">
                  Interactive Multi-Epoch Simulator
                </span>
              </div>
              <h2 className="font-headline-sm text-xl font-bold text-on-surface">
                Interactive Moving-Object & Proper-Motion Screening Workbench
              </h2>
              <p className="font-body-sm text-xs text-on-surface-variant mt-0.5">
                Test epoch separation, detector wavelength matching, blink astrometry, and 0.75–5.0 µm reflectance curves across high-proper-motion stars and solar system NEOs.
              </p>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {BENCHMARK_MOVING_OBJECTS.map((obj) => (
                <button
                  key={obj.id}
                  type="button"
                  onClick={() => setSelectedObjectId(obj.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-data-mono-sm border transition-all cursor-pointer ${
                    selectedObject.id === obj.id
                      ? 'bg-primary text-on-primary border-primary font-bold shadow-md'
                      : 'bg-surface-container-low text-on-surface-variant border-surface-container-high hover:border-secondary/60 hover:text-on-surface'
                  }`}
                >
                  {obj.name.split('—')[0].split('(')[0].trim() || obj.designation}
                </button>
              ))}
            </div>
          </div>

          {/* Interactive Criteria Sliders & Live Shift Readout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Sliders Card */}
            <div className="lg:col-span-5 p-4 rounded-xl bg-surface-container-low border border-surface-container-high flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="font-data-mono-sm text-xs font-bold text-on-surface uppercase tracking-wider">
                  1. Pairing Criteria Simulator
                </span>
                <span
                  className={`px-2 py-0.5 rounded font-data-mono-sm text-[11px] font-bold border ${
                    overallPasses
                      ? 'bg-secondary/15 text-secondary border-secondary/50'
                      : 'bg-red-500/15 text-red-300 border-red-500/40'
                  }`}
                >
                  {overallPasses ? 'PASS · PAIR QUALIFIES' : 'FAIL · REJECTED'}
                </span>
              </div>

              {/* Baseline slider */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs font-data-mono-sm">
                  <span className="text-on-surface-variant">Time Baseline (&ge; 14 days rule):</span>
                  <span className={timePasses ? 'text-secondary font-bold' : 'text-red-300 font-bold'}>
                    {baselineDays} days {timePasses ? '✓' : '✗'}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={200}
                  step={1}
                  value={baselineDays}
                  onChange={(e) => setBaselineDays(Number(e.target.value))}
                  className="w-full accent-secondary cursor-pointer"
                />
                <div className="flex justify-between text-[10px] font-data-mono-sm text-outline">
                  <span>1 d</span>
                  <span className="text-amber-300">14 d min</span>
                  <span>180 d (6 mo)</span>
                </div>
              </div>

              {/* Wavelength delta slider */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs font-data-mono-sm">
                  <span className="text-on-surface-variant">Wavelength Delta (&le; 2.0% rule):</span>
                  <span className={wavePasses ? 'text-secondary font-bold' : 'text-red-300 font-bold'}>
                    {wavelengthDiffPct.toFixed(1)}% {wavePasses ? '✓' : '✗'}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={0.1}
                  value={wavelengthDiffPct}
                  onChange={(e) => setWavelengthDiffPct(Number(e.target.value))}
                  className="w-full accent-primary cursor-pointer"
                />
                <div className="flex justify-between text-[10px] font-data-mono-sm text-outline">
                  <span>0.0%</span>
                  <span className="text-amber-300">2.0% max</span>
                  <span>5.0%</span>
                </div>
              </div>

              {/* Computed displacement metrics */}
              <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-surface-container-high/60 font-data-mono-sm">
                <div className="p-2.5 rounded bg-surface-container-lowest border border-surface-container-high">
                  <div className="text-[10px] text-outline">ANGULAR SHIFT</div>
                  <div className="text-base font-bold text-primary mt-0.5">
                    {totalShiftArcsec < 10
                      ? `${totalShiftArcsec.toFixed(2)}"`
                      : totalShiftArcsec < 1000
                      ? `${totalShiftArcsec.toFixed(1)}"`
                      : `${(totalShiftArcsec / 60).toFixed(1)}'`}
                  </div>
                  <div className="text-[10px] text-outline">
                    at {rateArcsecPerHr.toFixed(2)}"/hr
                  </div>
                </div>
                <div className="p-2.5 rounded bg-surface-container-lowest border border-surface-container-high">
                  <div className="text-[10px] text-outline">DETECTOR SHIFT</div>
                  <div className="text-base font-bold text-secondary mt-0.5">
                    {totalShiftPixels.toFixed(2)} px
                  </div>
                  <div className="text-[10px] text-outline">
                    at 6.15"/px pixel scale
                  </div>
                </div>
              </div>

              {/* Object Metadata Summary */}
              <div className="p-2.5 rounded bg-surface-container-lowest border border-surface-container-high text-[11px] font-data-mono-sm flex flex-col gap-1">
                <div className="flex justify-between">
                  <span className="text-outline">ID / Designation:</span>
                  <span className="text-secondary font-semibold">{selectedObject.designation}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-outline">Classification:</span>
                  <span className="text-on-surface">{selectedObject.classification}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-outline">Spectral Type:</span>
                  <span className="text-on-surface">{selectedObject.spectralClass}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-outline">Key Band Signature:</span>
                  <span className="text-amber-300">{selectedObject.hydrationDepth}</span>
                </div>
              </div>
            </div>

            {/* Blink / Subtraction Astrometry Viewer */}
            <div className="lg:col-span-7 p-4 rounded-xl bg-surface-container-low border border-surface-container-high flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-data-mono-sm text-xs font-bold text-on-surface uppercase tracking-wider">
                  2. Multi-Epoch Astrometric Blink & Difference Viewer
                </span>
                <div className="flex items-center gap-1 font-data-mono-sm text-[11px]">
                  {(
                    [
                      { id: 'epoch1', label: 'Epoch 1' },
                      { id: 'epoch2', label: 'Epoch 2' },
                      { id: 'blink', label: 'Blink' },
                      { id: 'diff', label: 'Subtraction' },
                    ] as const
                  ).map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setViewerMode(mode.id)}
                      className={`px-2 py-0.5 rounded border cursor-pointer transition-colors ${
                        viewerMode === mode.id
                          ? 'bg-secondary text-on-primary border-secondary font-bold'
                          : 'bg-surface-container border-surface-container-high text-outline hover:text-on-surface'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* SVG Starfield Plate */}
              <div className="w-full rounded-lg bg-[#05070a] border border-surface-container-high overflow-hidden relative flex items-center justify-center">
                <svg viewBox={`0 0 ${viewerW} ${viewerH}`} className="w-full h-56">
                  {/* Subtle coordinate reticle */}
                  <line x1={viewerW / 2} y1={10} x2={viewerW / 2} y2={viewerH - 10} stroke="rgba(255,255,255,0.06)" />
                  <line x1={10} y1={viewerH / 2} x2={viewerW - 10} y2={viewerH / 2} stroke="rgba(255,255,255,0.06)" />

                  {/* Compass indicator */}
                  <text x={14} y={20} fill="#9ca3af" fontSize={9} fontFamily="monospace">
                    N ↑ · E ←
                  </text>
                  <text x={viewerW - 14} y={20} textAnchor="end" fill="#fbbf24" fontSize={9} fontFamily="monospace">
                    {viewerMode === 'blink'
                      ? `BLINK: EPOCH ${blinkEpoch}`
                      : viewerMode === 'diff'
                      ? 'EPOCH 2 − EPOCH 1'
                      : viewerMode.toUpperCase()}
                  </text>

                  {/* Fixed Reference Field Stars */}
                  {backgroundStars.map((st, idx) => (
                    <circle
                      key={idx}
                      cx={st.x}
                      cy={st.y}
                      r={st.r}
                      fill="#a7c8ff"
                      opacity={viewerMode === 'diff' ? st.opacity * 0.2 : st.opacity}
                    />
                  ))}

                  {/* Motion Vector Arrow (shown in diff or epoch2) */}
                  {(viewerMode === 'diff' || viewerMode === 'epoch2') && (
                    <line
                      x1={cx1}
                      y1={cy1}
                      x2={cx2}
                      y2={cy2}
                      stroke="#fbbf24"
                      strokeWidth={1.3}
                      strokeDasharray="3 2"
                    />
                  )}

                  {/* Epoch 1 Source Position */}
                  {(viewerMode === 'epoch1' ||
                    viewerMode === 'diff' ||
                    (viewerMode === 'blink' && blinkEpoch === 1)) && (
                    <g>
                      <circle
                        cx={cx1}
                        cy={cy1}
                        r={6}
                        fill={viewerMode === 'diff' ? 'none' : 'rgba(96, 165, 250, 0.25)'}
                        stroke="#60a5fa"
                        strokeWidth={1.8}
                      />
                      <circle
                        cx={cx1}
                        cy={cy1}
                        r={2.5}
                        fill={viewerMode === 'diff' ? 'none' : '#60a5fa'}
                      />
                      <text
                        x={cx1}
                        y={cy1 - 10}
                        textAnchor="middle"
                        fill="#93c5fd"
                        fontSize={9}
                        fontFamily="monospace"
                      >
                        E1 ({e1.date})
                      </text>
                    </g>
                  )}

                  {/* Epoch 2 Source Position */}
                  {(viewerMode === 'epoch2' ||
                    viewerMode === 'diff' ||
                    (viewerMode === 'blink' && blinkEpoch === 2)) && (
                    <g>
                      <circle
                        cx={cx2}
                        cy={cy2}
                        r={6}
                        fill="rgba(65, 222, 179, 0.28)"
                        stroke="#41deb3"
                        strokeWidth={1.8}
                      />
                      <circle cx={cx2} cy={cy2} r={2.8} fill="#41deb3" />
                      <text
                        x={cx2}
                        y={cy2 + 17}
                        textAnchor="middle"
                        fill="#41deb3"
                        fontSize={9}
                        fontFamily="monospace"
                      >
                        E2 (+{baselineDays}d · {e2.date})
                      </text>
                    </g>
                  )}
                </svg>
              </div>

              <div className="flex flex-wrap items-center justify-between text-[11px] font-data-mono-sm text-outline">
                <span>
                  Stationary background stars cancel in Subtraction mode; moving/high-PM target leaves dipole (E1 blue ring → E2 teal core).
                </span>
              </div>
            </div>
          </div>

          {/* Bottom Row: Reflectance Curve SVG + Ephemeris Table */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Reflectance Curve Chart */}
            <div className="lg:col-span-7 p-4 rounded-xl bg-surface-container-low border border-surface-container-high flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-data-mono-sm text-xs font-bold text-on-surface uppercase tracking-wider">
                  3. SPHEREx 0.75–5.0 µm Normalized Reflectance / SED Curve
                </span>
                <span className="font-data-mono-sm text-[11px] text-amber-300">
                  {selectedObject.hydrationDepth}
                </span>
              </div>

              <div className="w-full bg-surface-container-lowest rounded-lg border border-surface-container-high p-2">
                <svg viewBox="0 0 560 195" className="w-full h-44 overflow-visible">
                  <text
                    x={-(rPadT + rChartH / 2)}
                    y={14}
                    transform="rotate(-90)"
                    textAnchor="middle"
                    fill="#9ca3af"
                    fontSize={10}
                    fontFamily="monospace"
                  >
                    Norm. Reflectance
                  </text>
                  <text
                    x={rPadL + rChartW / 2}
                    y={rPadT + rChartH + 30}
                    textAnchor="middle"
                    fill="#9ca3af"
                    fontSize={10}
                    fontFamily="monospace"
                  >
                    Wavelength (µm)
                  </text>

                  {[1, 2, 3, 4, 5].map((wl) => {
                    const x = getRefX(wl);
                    return (
                      <g key={wl}>
                        <line
                          x1={x}
                          y1={rPadT}
                          x2={x}
                          y2={rPadT + rChartH}
                          stroke="rgba(255,255,255,0.06)"
                          strokeDasharray="3 3"
                        />
                        <text
                          x={x}
                          y={rPadT + rChartH + 15}
                          textAnchor="middle"
                          fill="#9ca3af"
                          fontSize={10}
                          fontFamily="monospace"
                        >
                          {wl}
                        </text>
                      </g>
                    );
                  })}

                  {[0, 0.33, 0.66, 1].map((frac, idx) => {
                    const val = minRef + frac * (maxRef - minRef);
                    const y = getRefY(val);
                    return (
                      <g key={idx}>
                        <line
                          x1={rPadL}
                          y1={y}
                          x2={rPadL + rChartW}
                          y2={y}
                          stroke="rgba(255,255,255,0.06)"
                          strokeDasharray="3 3"
                        />
                        <text
                          x={rPadL - 6}
                          y={y + 3}
                          textAnchor="end"
                          fill="#9ca3af"
                          fontSize={9}
                          fontFamily="monospace"
                        >
                          {val.toFixed(2)}
                        </text>
                      </g>
                    );
                  })}

                  <path d={refPath} fill="none" stroke="#41deb3" strokeWidth={1.8} />

                  {refData.map((pt, idx) => {
                    const x = getRefX(pt.wavelength);
                    const y = getRefY(pt.reflectance);
                    const y1 = getRefY(pt.reflectance + pt.error);
                    const y2 = getRefY(pt.reflectance - pt.error);
                    return (
                      <g key={idx}>
                        <line x1={x} y1={y1} x2={x} y2={y2} stroke="#41deb3" strokeWidth={1} opacity={0.65} />
                        <circle cx={x} cy={y} r={2.6} fill="#a7c8ff" stroke="#0b0d12" strokeWidth={0.8} />
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>

            {/* Ephemeris / Proper-Motion Table */}
            <div className="lg:col-span-5 p-4 rounded-xl bg-surface-container-low border border-surface-container-high flex flex-col gap-3">
              <span className="font-data-mono-sm text-xs font-bold text-on-surface uppercase tracking-wider">
                4. Multi-Epoch Astrometry & Rates
              </span>
              <div className="overflow-x-auto border border-surface-container-high rounded-lg bg-surface-container-lowest">
                <table className="w-full text-left font-data-mono-sm text-[11px] border-collapse">
                  <thead className="bg-surface-container text-outline border-b border-surface-container-high">
                    <tr>
                      <th className="py-2 px-2.5">Pass</th>
                      <th className="py-2 px-2.5">Date</th>
                      <th className="py-2 px-2.5">RA / Dec</th>
                      <th className="py-2 px-2.5">Rate ("/hr)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedObject.epochs.map((ep) => (
                      <tr key={ep.pass} className="border-b border-surface-container-high/40">
                        <td className="py-2 px-2.5 text-secondary font-bold">Pass {ep.pass}</td>
                        <td className="py-2 px-2.5 text-on-surface">{ep.date}</td>
                        <td className="py-2 px-2.5 text-on-surface-variant">
                          <div>{ep.ra}</div>
                          <div>{ep.dec}</div>
                        </td>
                        <td className="py-2 px-2.5 text-primary">
                          <div>dRA: {ep.dRA.toFixed(3)}</div>
                          <div>dDEC: {ep.dDEC.toFixed(3)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="text-[11px] font-body-sm text-on-surface-variant leading-relaxed">
                Real SPHEREx moving-object & proper-motion subtraction unlocks automatically whenever a locally exported IRSA field contains &ge; 2 same-detector exposures separated by &ge; 14 days.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
