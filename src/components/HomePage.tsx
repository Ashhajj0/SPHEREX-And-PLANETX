import React, { useState, useEffect, useRef, useMemo } from 'react';
import { RealDataset, RealSource, RealSpectrumPoint } from '../data/real.ts';
import { DataSourceChip } from './DataSourceChip.tsx';
import { TargetObject, SPHEREX_TARGETS } from '../data/spherexData.ts';

interface HomePageProps {
  dataSource: 'real' | 'fixture';
  realDataset: RealDataset | null;
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
  missingDetails,
  onEnterExplorer,
  onNavigateTab,
  onSelectRealSource,
  onSelectTarget,
  onOpenPinpoint,
  onOpenFilterPopover,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFeedback, setSearchFeedback] = useState<string | null>(null);

  // Hovered source on hero sky canvas
  const [hoveredSource, setHoveredSource] = useState<{
    source: RealSource;
    screenX: number;
    screenY: number;
    points: RealSpectrumPoint[];
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isReal = dataSource === 'real' && realDataset !== null;

  // Real stats from manifest and exposures
  const stats = useMemo(() => {
    if (isReal) {
      const c = realDataset.manifest.counts;
      const validPoints = c.spectrum_points - c.null_points;
      const expList = realDataset.exposures;
      const wavesMin = expList.length
        ? Math.min(...expList.map((e) => e.wavelength_min_um ?? e.wavelength_um))
        : 0.74;
      const wavesMax = expList.length
        ? Math.max(...expList.map((e) => e.wavelength_max_um ?? e.wavelength_um))
        : 4.83;
      const refExpId = realDataset.manifest.detection?.reference_exposure_id || 'E076';

      const suspectPoints = c.suspect_points ?? 0;

      return {
        exposures: c.exposures,
        sources: c.sources,
        validPoints: validPoints,
        suspectPoints,
        waveMin: wavesMin.toFixed(2),
        waveMax: wavesMax.toFixed(2),
        refExpId,
        regionName: realDataset.manifest.region.name,
      };
    }
    return {
      exposures: 120,
      sources: 72,
      validPoints: 8342,
      suspectPoints: 0,
      waveMin: '0.74',
      waveMax: '4.83',
      refExpId: 'E076',
      regionName: 'North Ecliptic Pole Deep Field',
    };
  }, [isReal, realDataset]);

  // Handle Search
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
    } else {
      const matched = SPHEREX_TARGETS.find(
        (t) =>
          t.id.toLowerCase().includes(query) ||
          t.name.toLowerCase().includes(query)
      );
      if (matched) {
        onSelectTarget(matched);
        onEnterExplorer();
        return;
      }
    }

    setSearchFeedback(`Target / query "${searchQuery}" queued for Explorer search`);
    setTimeout(() => {
      onEnterExplorer();
    }, 600);
  };

  // Draw Hero Sky Canvas with Real Sources and Faint Seeded Background Stars
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
      const starCount = 65;
      for (let i = 0; i < starCount; i++) {
        const sx = ((Math.sin(seed + i * 43.1) * 0.5 + 0.5) * (w - 40)) + 20;
        const sy = ((Math.cos(seed + i * 59.3) * 0.5 + 0.5) * (h - 40)) + 20;
        const size = (Math.sin(i * 13.7) * 0.5 + 0.5) * 1.5 + 0.5;
        const alpha = (Math.sin(t * 0.02 + i) * 0.2 + 0.3);

        ctx.beginPath();
        ctx.arc(sx, sy, size, 0, 2 * Math.PI);
        ctx.fillStyle = `rgba(167, 200, 255, ${alpha.toFixed(2)})`;
        ctx.fill();
      }

      // Real SPHEREx sources: small crisp points without glowing halos
      const sourcesList = isReal ? realDataset.sources : [];
      for (const src of sourcesList) {
        const sx = (src.x / 145) * (w - 80) + 40;
        const sy = (src.y / 145) * (h - 80) + 40;

        // Small crisp point
        ctx.beginPath();
        ctx.arc(sx, sy, 1.5, 0, 2 * Math.PI);
        ctx.fillStyle = '#41deb3';
        ctx.fill();
      }

      t++;
      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [isReal, realDataset]);

  // Handle Mouse Move on Hero Canvas to detect hovered real source
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isReal) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const w = canvas.width;
    const h = canvas.height;

    let closest: RealSource | null = null;
    let closestDist = 18; // 18 px hit test radius

    for (const src of realDataset.sources) {
      const sx = (src.x / 145) * (w - 80) + 40;
      const sy = (src.y / 145) * (h - 80) + 40;
      const dist = Math.hypot(mouseX - sx, mouseY - sy);
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
  };

  const handleCanvasClick = () => {
    if (hoveredSource) {
      onSelectRealSource(hoveredSource.source);
      onEnterExplorer();
    }
  };

  return (
    <main className="w-full pt-14 pb-12 flex flex-col justify-center flex-1 bg-surface">
      <div className="relative min-h-[calc(100vh-3.5rem-2rem)] w-full flex flex-col justify-center items-center overflow-hidden">
        {/* Sky Canvas Background with real sources */}
        <div className="absolute inset-0 z-0 overflow-hidden">
          <canvas
            ref={canvasRef}
            width={900}
            height={500}
            onMouseMove={handleCanvasMouseMove}
            onMouseLeave={() => setHoveredSource(null)}
            onClick={handleCanvasClick}
            className="w-full h-full object-cover cursor-pointer"
          />

          {/* Interactive Hover Sparkline Tooltip */}
          {hoveredSource && (
            <div
              className="absolute z-30 pointer-events-none p-2.5 rounded-lg bg-surface-container-lowest/95 border border-surface-container-high shadow-2xl flex flex-col gap-1 -translate-x-1/2 -translate-y-full mb-3"
              style={{ left: `${hoveredSource.screenX}px`, top: `${hoveredSource.screenY}px` }}
            >
              <div className="flex items-center justify-between text-xs font-data-mono-sm gap-3">
                <span className="text-secondary font-bold">{hoveredSource.source.id}</span>
                <span className="text-outline">SNR {hoveredSource.source.peak_snr.toFixed(1)}</span>
              </div>

              {/* Sparkline */}
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
                      const y = 35 - (( (pt.flux_uJy as number) - minF) / Math.max(1, maxF - minF)) * 30;
                      return idx === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
                    }, '');
                    return (
                      <path d={pathD} fill="none" stroke="#41deb3" strokeWidth={1.5} />
                    );
                  })()}
                </svg>
              </div>
              <span className="text-[10px] text-outline text-center">Click to open in Explorer</span>
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
            Explore the Infrared Universe<br className="hidden sm:inline" /> Across 120 Real SPHEREx Exposures
          </h1>

          {/* Subtitle */}
          <p className="font-body-lg text-base sm:text-lg text-on-surface-variant max-w-3xl font-light text-center mb-6 leading-relaxed">
            Calibrated spectrophotometric measurements from NASA's SPHEREx mission Quick Release 2 (QR2),
            mapping point sources across 6 Hawaii-2RG detector arrays.
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
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 bg-transparent border-none outline-none text-on-surface placeholder:text-outline/70 font-body-md text-sm"
                  placeholder="Search SPHEREx catalogue (e.g. SPX-NEP-001) or Gaia ID..."
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

            {/* Buttons */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleSearch()}
                className="px-5 py-1.5 rounded-md bg-surface-container hover:bg-surface-container-high border border-surface-container-high text-on-surface font-body-sm text-xs transition-colors cursor-pointer"
                type="button"
              >
                Search Field
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

          {/* STAT STRIP FROM MANIFEST */}
          <div className="w-full max-w-4xl grid grid-cols-2 sm:grid-cols-4 gap-3 text-left mb-6 font-data-mono-sm text-xs">
            <div className="p-3 rounded-xl bg-surface-container-lowest border border-surface-container-high flex flex-col">
              <span className="text-outline text-[10px]">REAL EXPOSURES:</span>
              <span className="text-lg font-bold text-on-surface mt-0.5">{stats.exposures}</span>
              <span className="text-outline text-[10px]">6 Detector Arrays</span>
            </div>

            <div className="p-3 rounded-xl bg-surface-container-lowest border border-surface-container-high flex flex-col">
              <span className="text-outline text-[10px]">SOURCES EXTRACTED:</span>
              <span className="text-lg font-bold text-secondary mt-0.5">{stats.sources} sources</span>
              <span className="text-outline text-[10px]">Detected on reference exposure {stats.refExpId}</span>
            </div>

            <div className="p-3 rounded-xl bg-surface-container-lowest border border-surface-container-high flex flex-col">
              <span className="text-outline text-[10px]">VALID SPECTRAL POINTS:</span>
              <span className="text-lg font-bold text-primary mt-0.5">{stats.validPoints.toLocaleString()}</span>
              <span className="text-outline text-[10px]">of which {stats.suspectPoints.toLocaleString()} suspect</span>
            </div>

            <div className="p-3 rounded-xl bg-surface-container-lowest border border-surface-container-high flex flex-col">
              <span className="text-outline text-[10px]">WAVELENGTH RANGE:</span>
              <span className="text-lg font-bold text-on-surface mt-0.5">{stats.waveMin} – {stats.waveMax} µm</span>
              <span className="text-outline text-[10px]">{stats.exposures} separate exposures</span>
            </div>
          </div>

          {/* ONE REAL REGION TILE (North Ecliptic Pole) */}
          <div className="w-full max-w-4xl flex flex-col text-left">
            <button
              onClick={onEnterExplorer}
              className="p-4 rounded-xl bg-surface-container-lowest hover:bg-surface-container-low border border-surface-container-high hover:border-primary/50 transition-all shadow-lg flex flex-col sm:flex-row items-center justify-between gap-4 text-left cursor-pointer group"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-secondary"></span>
                  <span className="font-headline-sm text-base font-bold text-on-surface group-hover:text-primary transition-colors">
                    {stats.regionName}
                  </span>
                </div>
                <p className="font-body-sm text-xs text-on-surface-variant font-light">
                  Primary calibration field observed across 120 exposures from 2025-04-24 to 2025-04-27.
                  Center coordinates: RA 270.3317°, DEC +66.5614° (15.0 arcmin diameter).
                </p>
                <span className="font-data-mono-sm text-[11px] text-outline mt-1">
                  Cross-matched against Gaia DR3 reference stars within 6.15 arcsec.
                </span>
              </div>

              <div className="flex items-center gap-2 text-primary font-data-mono-sm text-xs shrink-0 group-hover:translate-x-1 transition-transform">
                <span>Open in Explorer</span>
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </div>
            </button>
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
