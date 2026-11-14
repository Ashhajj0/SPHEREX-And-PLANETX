import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ExportedRegionSummary,
  RealDataset,
  RealSource,
  RealSpectrumPoint,
} from '../data/real.ts';
import { DataSourceChip } from './DataSourceChip.tsx';
import {
  CONFIGURED_SKY_REGIONS,
  SPHEREX_TARGETS,
  TargetObject,
} from '../data/spherexData.ts';

interface HomePageProps {
  dataSource: 'real' | 'fixture';
  realDataset: RealDataset | null;
  availableRegions?: ExportedRegionSummary[];
  activeRegionId?: string;
  onSelectRegion?: (regionId: string) => void;
  onSelectFixtureRegion?: (regionId: string) => void;
  missingDetails?: {
    files: string[];
    keys: string[];
    error?: string;
  } | null;
  onEnterExplorer: () => void;
  onNavigateTab: (tab: string) => void;
  onSelectRealSource: (src: RealSource) => void;
  onSelectTarget: (target: TargetObject) => void;
  onOpenPinpoint: () => void;
  onOpenFilterPopover: () => void;
}

export const HomePage: React.FC<HomePageProps> = ({
  dataSource,
  realDataset,
  availableRegions = [],
  activeRegionId,
  onSelectRegion,
  onSelectFixtureRegion,
  missingDetails,
  onEnterExplorer,
  onNavigateTab: _onNavigateTab,
  onSelectRealSource,
  onSelectTarget,
  onOpenPinpoint,
  onOpenFilterPopover,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFeedback, setSearchFeedback] = useState<string | null>(null);

  // Hovered source on hero sky canvas (real or fixture)
  const [hoveredSource, setHoveredSource] = useState<{
    source: RealSource;
    screenX: number;
    screenY: number;
    points: RealSpectrumPoint[];
  } | null>(null);

  const [hoveredFixtureTarget, setHoveredFixtureTarget] = useState<{
    target: TargetObject;
    screenX: number;
    screenY: number;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isReal = dataSource === 'real' && realDataset !== null;

  const gridW = realDataset?.manifest.common_grid?.width || 146;
  const gridH = realDataset?.manifest.common_grid?.height || 146;

  // Stats from manifest (real) or SPHEREX_TARGETS (fixture)
  const stats = useMemo(() => {
    if (isReal) {
      const m = realDataset.manifest;
      const c = m.counts;
      const validPoints = c.spectrum_points - c.null_points;
      const expList = realDataset.exposures;
      const wavesMin = expList.length
        ? Math.min(...expList.map((e) => e.wavelength_min_um ?? e.wavelength_um))
        : 0.74;
      const wavesMax = expList.length
        ? Math.max(...expList.map((e) => e.wavelength_max_um ?? e.wavelength_um))
        : 4.83;
      const dates = expList
        .map((e) => (e.time_utc ? e.time_utc.split('T')[0] : ''))
        .filter(Boolean)
        .sort();
      const dateSpan =
        dates.length >= 2
          ? `${dates[0]} to ${dates[dates.length - 1]}`
          : dates[0] || 'single epoch';

      const refExpId = m.detection?.reference_exposure_id || 'E076';
      const suspectPoints = c.suspect_points ?? 0;

      return {
        exposures: c.exposures,
        sources: c.sources,
        validPoints,
        suspectPoints,
        waveMin: wavesMin.toFixed(2),
        waveMax: wavesMax.toFixed(2),
        refExpId,
        regionId: m.region.id,
        regionName: m.region.name,
        raDeg: m.region.ra_deg.toFixed(4),
        decDeg: `${m.region.dec_deg >= 0 ? '+' : ''}${m.region.dec_deg.toFixed(4)}`,
        sizeArcmin: m.region.size_arcmin.toFixed(1),
        catalogueName: m.catalogue?.name || 'Gaia DR3',
        targetIdentifiers: m.region.target_identifiers || null,
        dateSpan,
      };
    }

    const activeCfg =
      CONFIGURED_SKY_REGIONS.find((r) => r.id === activeRegionId) ||
      CONFIGURED_SKY_REGIONS[1]; // Default highlight Barnard's Star or configured field
    return {
      exposures: 102,
      sources: SPHEREX_TARGETS.length,
      validPoints: SPHEREX_TARGETS.length * 102,
      suspectPoints: 0,
      waveMin: '0.75',
      waveMax: '5.00',
      refExpId: 'B038',
      regionId: activeCfg.id,
      regionName: activeCfg.name,
      raDeg: activeCfg.raDeg.toFixed(4),
      decDeg: `${activeCfg.decDeg >= 0 ? '+' : ''}${activeCfg.decDeg.toFixed(4)}`,
      sizeArcmin: activeCfg.sizeArcmin.toFixed(1),
      catalogueName: activeCfg.catalogue,
      targetIdentifiers: activeCfg.identifiers.join(' · '),
      dateSpan: 'Fixture SED & Sky Preview',
    };
  }, [isReal, realDataset, activeRegionId]);

  // Handle Search across loaded real sources, exported regions, or configured benchmark targets
  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      onEnterExplorer();
      return;
    }

    if (isReal) {
      const match = realDataset.sources.find(
        (s) =>
          s.id.toLowerCase().includes(query) ||
          (s.match?.identifier && s.match.identifier.toLowerCase().includes(query))
      );
      if (match) {
        onSelectRealSource(match);
        onEnterExplorer();
        return;
      }
    }

    // Check if query matches an exported sky region
    const matchedExported = availableRegions.find(
      (r) =>
        r.id.toLowerCase().includes(query) ||
        r.name.toLowerCase().includes(query) ||
        (r.target_identifiers && r.target_identifiers.toLowerCase().includes(query))
    );
    if (matchedExported && onSelectRegion) {
      onSelectRegion(matchedExported.id);
      return;
    }

    // Check benchmark targets directly (supports Gaia DR3 IDs, SIMBAD IDs, GJ 699, V* R Dra, etc.)
    const matchedTarget = SPHEREX_TARGETS.find(
      (t) =>
        t.id.toLowerCase().includes(query) ||
        t.name.toLowerCase().includes(query) ||
        t.field.toLowerCase().includes(query) ||
        t.keyFeatures.some((kf) => kf.toLowerCase().includes(query)) ||
        t.description.toLowerCase().includes(query)
    );
    if (matchedTarget) {
      const cfg = CONFIGURED_SKY_REGIONS.find((c) => c.targetId === matchedTarget.id);
      if (cfg && onSelectFixtureRegion) {
        onSelectFixtureRegion(cfg.id);
      } else {
        onSelectTarget(matchedTarget);
        onEnterExplorer();
      }
      return;
    }

    // Check configured regions list
    const matchedConfigured = CONFIGURED_SKY_REGIONS.find(
      (r) =>
        r.id.toLowerCase().includes(query) ||
        r.name.toLowerCase().includes(query) ||
        r.identifiers.some((idStr) => idStr.toLowerCase().includes(query))
    );
    if (matchedConfigured) {
      if (onSelectFixtureRegion) {
        onSelectFixtureRegion(matchedConfigured.id);
      } else {
        const tgt = SPHEREX_TARGETS.find((t) => t.id === matchedConfigured.targetId);
        if (tgt) onSelectTarget(tgt);
        onEnterExplorer();
      }
      return;
    }

    setSearchFeedback(`No exact ID match for "${searchQuery}" — opening Explorer`);
    setTimeout(() => {
      onEnterExplorer();
    }, 350);
  };

  // Draw Hero Sky Canvas with Real Sources or Benchmark Targets + Faint Seeded Background Stars
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let t = 0;

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = '#060709';
      ctx.fillRect(0, 0, w, h);

      // Faint seeded background stars
      const seed = 9182;
      const starCount = 75;
      for (let i = 0; i < starCount; i++) {
        const sx = ((Math.sin(seed + i * 43.1) * 0.5 + 0.5) * (w - 40)) + 20;
        const sy = ((Math.cos(seed + i * 59.3) * 0.5 + 0.5) * (h - 40)) + 20;
        const size = (Math.sin(i * 13.7) * 0.5 + 0.5) * 1.5 + 0.5;
        const alpha = Math.sin(t * 0.02 + i) * 0.2 + 0.3;

        ctx.beginPath();
        ctx.arc(sx, sy, size, 0, 2 * Math.PI);
        ctx.fillStyle = `rgba(167, 200, 255, ${alpha.toFixed(2)})`;
        ctx.fill();
      }

      if (isReal) {
        const sourcesList = realDataset.sources;
        const denomX = Math.max(1, gridW - 1);
        const denomY = Math.max(1, gridH - 1);
        for (const src of sourcesList) {
          const sx = (src.x / denomX) * (w - 80) + 40;
          const sy = (src.y / denomY) * (h - 80) + 40;

          ctx.beginPath();
          ctx.arc(sx, sy, 1.5, 0, 2 * Math.PI);
          ctx.fillStyle = '#41deb3';
          ctx.fill();
        }
      } else {
        // Plot all configured benchmark targets across celestial RA/Dec space
        for (const tgt of SPHEREX_TARGETS) {
          const sx = (tgt.raDeg / 360) * (w - 140) + 70;
          const sy = ((90 - tgt.decDeg) / 180) * (h - 100) + 50;
          const isFeatured =
            tgt.id === 'BARNARDS-STAR' ||
            tgt.id === 'EPSILON-INDI' ||
            tgt.id === 'WISE-0855-0714' ||
            tgt.id === 'RW-AURIGAE' ||
            tgt.id === 'R-DRACONIS';

          ctx.beginPath();
          ctx.arc(sx, sy, isFeatured ? 3.0 : 2.0, 0, 2 * Math.PI);
          ctx.fillStyle = isFeatured ? '#fbbf24' : '#41deb3';
          ctx.fill();

          if (isFeatured) {
            ctx.beginPath();
            ctx.arc(sx, sy, 6, 0, 2 * Math.PI);
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.35)';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      t++;
      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [isReal, realDataset, gridW, gridH]);

  // Handle Mouse Move on Hero Canvas to detect hovered real source or fixture target
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const canvasX = mouseX * scaleX;
    const canvasY = mouseY * scaleY;

    const w = canvas.width;
    const h = canvas.height;

    if (isReal) {
      const denomX = Math.max(1, gridW - 1);
      const denomY = Math.max(1, gridH - 1);

      let closest: RealSource | null = null;
      let closestDist = 18;

      for (const src of realDataset.sources) {
        const sx = (src.x / denomX) * (w - 80) + 40;
        const sy = (src.y / denomY) * (h - 80) + 40;
        const dist = Math.hypot(canvasX - sx, canvasY - sy);
        if (dist < closestDist) {
          closest = src;
          closestDist = dist;
        }
      }

      if (closest) {
        const pts = realDataset.spectra[closest.id] || [];
        setHoveredSource({
          source: closest,
          screenX: mouseX,
          screenY: mouseY,
          points: pts,
        });
      } else {
        setHoveredSource(null);
      }
      setHoveredFixtureTarget(null);
      return;
    }

    // Fixture mode hover detection across SPHEREX_TARGETS
    let closestTgt: TargetObject | null = null;
    let closestDist = 22;
    for (const tgt of SPHEREX_TARGETS) {
      const sx = (tgt.raDeg / 360) * (w - 140) + 70;
      const sy = ((90 - tgt.decDeg) / 180) * (h - 100) + 50;
      const dist = Math.hypot(canvasX - sx, canvasY - sy);
      if (dist < closestDist) {
        closestTgt = tgt;
        closestDist = dist;
      }
    }

    if (closestTgt) {
      setHoveredFixtureTarget({
        target: closestTgt,
        screenX: mouseX,
        screenY: mouseY,
      });
    } else {
      setHoveredFixtureTarget(null);
    }
    setHoveredSource(null);
  };

  const handleCanvasClick = () => {
    if (hoveredSource) {
      onSelectRealSource(hoveredSource.source);
      onEnterExplorer();
    } else if (hoveredFixtureTarget) {
      onSelectTarget(hoveredFixtureTarget.target);
      onEnterExplorer();
    }
  };

  return (
    <main className="w-full pt-14 pb-12 flex flex-col justify-center flex-1 bg-surface">
      <div className="relative min-h-[calc(100vh-3.5rem-2rem)] w-full flex flex-col justify-center items-center overflow-hidden">
        {/* Sky Canvas Background */}
        <div className="absolute inset-0 z-0 overflow-hidden">
          <canvas
            ref={canvasRef}
            width={900}
            height={500}
            onMouseMove={handleCanvasMouseMove}
            onMouseLeave={() => {
              setHoveredSource(null);
              setHoveredFixtureTarget(null);
            }}
            onClick={handleCanvasClick}
            className="w-full h-full object-cover cursor-pointer"
          />

          {/* Interactive Hover Sparkline Tooltip (Real Source) */}
          {hoveredSource && (
            <div
              className="absolute z-30 pointer-events-none p-2.5 rounded-lg bg-surface-container-lowest/95 border border-surface-container-high shadow-2xl flex flex-col gap-1 -translate-x-1/2 -translate-y-full mb-3"
              style={{ left: `${hoveredSource.screenX}px`, top: `${hoveredSource.screenY}px` }}
            >
              <div className="flex items-center justify-between text-xs font-data-mono-sm gap-3">
                <span className="text-secondary font-bold">{hoveredSource.source.id}</span>
                <span className="text-outline">SNR {hoveredSource.source.peak_snr.toFixed(1)}</span>
              </div>

              <div className="w-32 h-10 mt-1">
                <svg viewBox="0 0 120 40" className="w-full h-full overflow-visible">
                  {(() => {
                    const valid = hoveredSource.points.filter((p) => p.flux_uJy !== null && p.wavelength_um !== null);
                    if (valid.length < 2) return null;
                    const fluxes = valid.map((p) => p.flux_uJy as number);
                    const minF = Math.min(...fluxes);
                    const maxF = Math.max(...fluxes);
                    const pathD = valid.reduce((acc, pt, idx) => {
                      const x = (idx / (valid.length - 1)) * 120;
                      const y = 35 - (((pt.flux_uJy as number) - minF) / Math.max(1, maxF - minF)) * 30;
                      return idx === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
                    }, '');
                    return <path d={pathD} fill="none" stroke="#41deb3" strokeWidth={1.5} />;
                  })()}
                </svg>
              </div>
              <span className="text-[10px] text-outline text-center">Click to open in Explorer</span>
            </div>
          )}

          {/* Interactive Hover Sparkline Tooltip (Fixture Target) */}
          {hoveredFixtureTarget && (
            <div
              className="absolute z-30 pointer-events-none p-2.5 rounded-lg bg-surface-container-lowest/95 border border-amber-500/40 shadow-2xl flex flex-col gap-1 -translate-x-1/2 -translate-y-full mb-3"
              style={{ left: `${hoveredFixtureTarget.screenX}px`, top: `${hoveredFixtureTarget.screenY}px` }}
            >
              <div className="flex items-center justify-between text-xs font-data-mono-sm gap-3">
                <span className="text-amber-300 font-bold">{hoveredFixtureTarget.target.name}</span>
                <span className="text-outline text-[10px]">Fixture</span>
              </div>

              <div className="w-32 h-10 mt-1">
                <svg viewBox="0 0 120 40" className="w-full h-full overflow-visible">
                  {(() => {
                    const sed = hoveredFixtureTarget.target.sedData;
                    if (sed.length < 2) return null;
                    const fluxes = sed.map((p) => p.flux);
                    const minF = Math.min(...fluxes);
                    const maxF = Math.max(...fluxes);
                    const pathD = sed.reduce((acc, pt, idx) => {
                      const x = (idx / (sed.length - 1)) * 120;
                      const y = 35 - ((pt.flux - minF) / Math.max(1, maxF - minF)) * 30;
                      return idx === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
                    }, '');
                    return <path d={pathD} fill="none" stroke="#fbbf24" strokeWidth={1.5} />;
                  })()}
                </svg>
              </div>
              <span className="text-[10px] text-outline text-center">Click to inspect Fixture SED</span>
            </div>
          )}

          {/* Subtle gradient scrim */}
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/40 to-surface/60 pointer-events-none"></div>
        </div>

        {/* Content Container */}
        <div className="relative z-10 w-full max-w-5xl mx-auto px-gutter py-6 flex flex-col items-center text-center">
          {/* Release Chip */}
          <div className="flex items-center gap-space-sm mb-3">
            <DataSourceChip dataSource={dataSource} missingDetails={missingDetails} />
          </div>

          {/* Headline */}
          <h1 className="font-headline-xl text-3xl sm:text-4xl md:text-5xl lg:text-[3.25rem] leading-[1.15] text-on-surface tracking-tight font-medium text-center max-w-4xl mb-3">
            {isReal ? (
              <>
                Explore the Infrared Universe<br className="hidden sm:inline" /> Across {stats.exposures} Real SPHEREx Exposures
              </>
            ) : (
              <>
                Explore the Infrared Universe<br className="hidden sm:inline" /> Across 102 SPHEREx Spectral Bands
              </>
            )}
          </h1>

          {/* Subtitle */}
          <p className="font-body-lg text-base sm:text-lg text-on-surface-variant max-w-3xl font-light text-center mb-6 leading-relaxed">
            {isReal
              ? "Calibrated spectrophotometric measurements from NASA's SPHEREx mission Quick Release 2 (QR2), mapping point sources across 6 Hawaii-2RG detector arrays."
              : "Spectrophotometric workbench for NASA's SPHEREx 0.75–5.0 µm mission. Currently showing fixture benchmark models while local IRSA QR2 cutouts are pending export."}
          </p>

          {/* Search Box */}
          <div className="w-full max-w-2xl flex flex-col items-center gap-3 mb-8">
            <form onSubmit={handleSearch} className="w-full">
              <div className="w-full flex items-center gap-3 px-5 py-2.5 rounded-full bg-surface-container-lowest border border-surface-container-high shadow-xl transition-all focus-within:border-primary/60">
                <span className="material-symbols-outlined text-outline text-[22px]">
                  search
                </span>
                <input
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (searchFeedback) setSearchFeedback(null);
                  }}
                  className="flex-1 bg-transparent border-none outline-none text-on-surface placeholder:text-outline/70 font-body-md text-sm"
                  placeholder="Search target (Barnard's Star, Epsilon Indi, WISE 0855, RW Aur, R Dra, Gaia ID)..."
                  type="text"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={onOpenPinpoint}
                    className="text-outline hover:text-on-surface transition-colors p-1 cursor-pointer"
                    title="Target Center Pinpoint"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[20px]">my_location</span>
                  </button>
                  <button
                    onClick={onOpenFilterPopover}
                    className="text-outline hover:text-secondary transition-colors p-1 cursor-pointer"
                    title="Spectral Filter"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[20px]">tune</span>
                  </button>
                </div>
              </div>
            </form>

            {searchFeedback && (
              <span className="text-secondary font-data-mono-sm text-xs">
                {searchFeedback}
              </span>
            )}

            {/* Quick Target Jump Chips for Requested Targets */}
            <div className="flex flex-wrap items-center justify-center gap-1.5 text-[11px] font-data-mono-sm">
              <span className="text-outline mr-1">Quick targets:</span>
              {[
                { id: 'barnards-star', label: "Barnard's Star" },
                { id: 'epsilon-indi', label: 'ε Indi A & Ba' },
                { id: 'wise-0855-0714', label: 'WISE 0855-0714' },
                { id: 'rw-aurigae', label: 'RW Aurigae A & B' },
                { id: 'r-draconis', label: 'R Draconis' },
              ].map((qt) => {
                const isExported = availableRegions.some((r) => r.id === qt.id);
                return (
                  <button
                    key={qt.id}
                    type="button"
                    onClick={() => {
                      if (isExported && onSelectRegion) onSelectRegion(qt.id);
                      else if (onSelectFixtureRegion) onSelectFixtureRegion(qt.id);
                      else onEnterExplorer();
                    }}
                    className="px-2.5 py-0.5 rounded bg-surface-container-low hover:bg-surface-container border border-surface-container-high hover:border-secondary/60 text-on-surface-variant hover:text-secondary transition-colors cursor-pointer"
                  >
                    {qt.label}
                  </button>
                );
              })}
            </div>

            {/* Buttons */}
            <div className="flex items-center gap-3 mt-1">
              <button
                onClick={() => handleSearch()}
                className="px-5 py-1.5 rounded-md bg-surface-container hover:bg-surface-container-high border border-surface-container-high text-on-surface font-body-sm text-xs transition-colors cursor-pointer"
                type="button"
              >
                Search Target
              </button>
              <button
                onClick={onEnterExplorer}
                className="px-5 py-1.5 rounded-md bg-primary-container hover:bg-primary text-on-primary font-body-sm text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-md"
                type="button"
              >
                <span>Enter Explorer</span>
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </button>
            </div>
          </div>

          {/* STAT STRIP FROM MANIFEST / FIXTURE BENCHMARK */}
          <div className="w-full max-w-4xl grid grid-cols-2 sm:grid-cols-4 gap-3 text-left mb-6 font-data-mono-sm text-xs">
            <div className="p-3 rounded-xl bg-surface-container-lowest border border-surface-container-high flex flex-col">
              <span className="text-outline text-[10px]">
                {isReal ? 'REAL EXPOSURES:' : 'FIXTURE BANDS:'}
              </span>
              <span className="text-lg font-bold text-on-surface mt-0.5">{stats.exposures}</span>
              <span className="text-outline text-[10px]">
                {isReal ? '6 Detector Arrays' : '6 Detector Arrays (Fixture)'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-surface-container-lowest border border-surface-container-high flex flex-col">
              <span className="text-outline text-[10px]">
                {isReal ? 'SOURCES EXTRACTED:' : 'BENCHMARK TARGETS:'}
              </span>
              <span className="text-lg font-bold text-secondary mt-0.5">
                {stats.sources} {isReal ? 'sources' : 'targets'}
              </span>
              <span className="text-outline text-[10px]">
                {isReal
                  ? `Detected on reference exposure ${stats.refExpId}`
                  : 'All 5 requested stars ready'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-surface-container-lowest border border-surface-container-high flex flex-col">
              <span className="text-outline text-[10px]">VALID SPECTRAL POINTS:</span>
              <span className="text-lg font-bold text-primary mt-0.5">{stats.validPoints.toLocaleString()}</span>
              <span className="text-outline text-[10px]">of which {stats.suspectPoints.toLocaleString()} suspect</span>
            </div>

            <div className="p-3 rounded-xl bg-surface-container-lowest border border-surface-container-high flex flex-col">
              <span className="text-outline text-[10px]">WAVELENGTH RANGE:</span>
              <span className="text-lg font-bold text-on-surface mt-0.5">{stats.waveMin} – {stats.waveMax} µm</span>
              <span className="text-outline text-[10px]">
                {stats.exposures} {isReal ? 'separate exposures' : 'LVF spectral bands'}
              </span>
            </div>
          </div>

          {/* ACTIVE REGION / PREVIEW TILE */}
          <div className="w-full max-w-4xl flex flex-col text-left mb-6">
            <button
              onClick={() => {
                if (isReal) onEnterExplorer();
                else if (onSelectFixtureRegion) onSelectFixtureRegion(stats.regionId);
                else onEnterExplorer();
              }}
              className="p-4 rounded-xl bg-surface-container-lowest hover:bg-surface-container-low border border-surface-container-high hover:border-primary/50 transition-all shadow-lg flex flex-col sm:flex-row items-center justify-between gap-4 text-left cursor-pointer group"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${isReal ? 'bg-secondary' : 'bg-amber-400'}`}></span>
                  <span className="font-headline-sm text-base font-bold text-on-surface group-hover:text-primary transition-colors">
                    {stats.regionName}
                  </span>
                </div>
                <p className="font-body-sm text-xs text-on-surface-variant font-light">
                  {isReal
                    ? `Observed across ${stats.exposures} exposures (${stats.dateSpan}).`
                    : `Interactive fixture preview (${stats.dateSpan}).`}{' '}
                  Center coordinates: RA {stats.raDeg}°, DEC {stats.decDeg}° ({stats.sizeArcmin} arcmin diameter).
                </p>
                {stats.targetIdentifiers && (
                  <span className="font-data-mono-sm text-[11px] text-secondary">
                    Target IDs: {stats.targetIdentifiers}
                  </span>
                )}
                <span className="font-data-mono-sm text-[11px] text-outline mt-0.5">
                  {isReal
                    ? `Cross-matched against ${stats.catalogueName} reference catalogue within 6.15 arcsec.`
                    : `Reference catalogue: ${stats.catalogueName} · Export local FITS to replace fixture model with real QR2 photometry.`}
                </span>
              </div>

              <div className="flex items-center gap-2 text-primary font-data-mono-sm text-xs shrink-0 group-hover:translate-x-1 transition-transform">
                <span>{isReal ? 'Open in Explorer' : 'Open Preview'}</span>
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </div>
            </button>
          </div>

          {/* CONFIGURED TARGETS & SKY FIELDS GRID */}
          <div className="w-full max-w-4xl flex flex-col text-left gap-3 mb-4">
            <div className="flex items-center justify-between border-b border-surface-container-high/60 pb-2">
              <span className="font-label-editorial text-[11px] uppercase tracking-[0.16em] text-outline">
                Configured Targets & Sky Fields ({CONFIGURED_SKY_REGIONS.length})
              </span>
              <span className="font-data-mono-sm text-[11px] text-outline">
                {availableRegions.length} real exports · {CONFIGURED_SKY_REGIONS.length} fixture previews ready
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {CONFIGURED_SKY_REGIONS.map((cfg) => {
                const exported = availableRegions.find((r) => r.id === cfg.id);
                const isActive = (activeRegionId || stats.regionId) === cfg.id;

                return (
                  <div
                    key={cfg.id}
                    className={`p-3.5 rounded-xl border transition-all flex flex-col justify-between gap-2.5 ${
                      isActive && isReal
                        ? 'bg-surface-container-low border-secondary/70 shadow-md'
                        : exported
                        ? 'bg-surface-container-lowest border-surface-container-high hover:border-primary/50'
                        : 'bg-surface-container-lowest border-surface-container-high/80 hover:border-amber-500/50'
                    }`}
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-headline-sm text-sm font-semibold text-on-surface">
                          {cfg.name}
                        </span>
                        {exported ? (
                          <span className="px-2 py-0.5 rounded bg-secondary/15 text-secondary border border-secondary/40 font-data-mono-sm text-[10px] shrink-0">
                            Real QR2 Ready
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/40 font-data-mono-sm text-[10px] shrink-0">
                            Fixture Preview
                          </span>
                        )}
                      </div>

                      <div className="font-data-mono-sm text-[11px] text-outline">
                        RA {cfg.raHMS} · DEC {cfg.decDMS} · {cfg.catalogue}
                      </div>

                      <div className="font-data-mono-sm text-[10px] text-secondary/90 truncate" title={cfg.identifiers.join(' · ')}>
                        {cfg.identifiers.join(' · ')}
                      </div>

                      <p className="font-body-sm text-xs text-on-surface-variant font-light line-clamp-2 mt-0.5">
                        {cfg.description}
                      </p>
                    </div>

                    {exported ? (
                      <div className="flex items-center justify-between pt-2 border-t border-surface-container-high/40 text-[11px] font-data-mono-sm">
                        <span className="text-outline">
                          {exported.counts?.exposures ?? 0} exp · {exported.counts?.sources ?? 0} sources
                        </span>
                        <button
                          type="button"
                          onClick={() => onSelectRegion?.(cfg.id)}
                          className="text-primary hover:text-secondary font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <span>{isActive && isReal ? 'Viewing in Explorer' : 'Open Real QR2'}</span>
                          <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1.5 pt-2 border-t border-surface-container-high/40">
                        <div className="flex items-center justify-between text-[11px] font-data-mono-sm">
                          <span className="text-outline text-[10px]">
                            102 fixture bands · {cfg.sizeArcmin}' field
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              if (onSelectFixtureRegion) onSelectFixtureRegion(cfg.id);
                              else {
                                const tgt = SPHEREX_TARGETS.find((t) => t.id === cfg.targetId);
                                if (tgt) onSelectTarget(tgt);
                                onEnterExplorer();
                              }
                            }}
                            className="text-amber-300 hover:text-secondary font-semibold flex items-center gap-1 cursor-pointer"
                          >
                            <span>Open Fixture Preview</span>
                            <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
                          </button>
                        </div>
                        <div className="text-[10px] font-data-mono-sm text-outline/80 truncate">
                          Fetch real FITS: <code className="text-on-surface-variant">python pipeline/fetch_spherex.py --region {cfg.id}</code>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Citation Tag */}
          <div className="mt-4 flex items-center justify-center">
            <p className="font-data-mono-sm text-xs text-outline tracking-wider uppercase text-[11px]">
              SPHEREx Release QR2 · DOI: 10.26131/IRSA652 · NASA / Caltech / IPAC IRSA
            </p>
          </div>
        </div>
      </div>
    </main>
  );
};
