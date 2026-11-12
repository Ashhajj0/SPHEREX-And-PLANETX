import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  RealDataset,
  RealExposure,
  RealSource,
  RealSpectrumPoint,
  pixelToSky,
} from '../data/real.ts';
import { DataSourceChip } from './DataSourceChip.tsx';
import { TargetObject, SpectralBand } from '../data/spherexData.ts';

interface ExplorerPageProps {
  // Real dataset props
  dataSource: 'real' | 'fixture';
  realDataset: RealDataset | null;
  missingDetails?: {
    files: string[];
    keys: string[];
    error?: string;
  } | null;
  selectedRealExposure: RealExposure | null;
  onSelectRealExposure: (exp: RealExposure) => void;
  selectedRealSource: RealSource | null;
  onSelectRealSource: (src: RealSource) => void;
  onCursorMove: (status: {
    ra_deg: number | null;
    dec_deg: number | null;
    exposure_id: string | null;
    wavelength_um: number | null;
    detector: number | null;
    zoom: number;
    selectedSourceId?: string | null;
  }) => void;

  // Fallback synthetic props
  currentTarget: TargetObject;
  onSelectTarget: (target: TargetObject) => void;
  currentBand: SpectralBand;
  onSelectBand: (band: SpectralBand) => void;
  coordFormat: 'sexagesimal' | 'decimal';
  fluxUnit: 'uJy' | 'mJy' | 'abmag';
  colormap: string;
}

// Colormap lookup palette for Infrared: warm palette (black, deep red, orange, pale gold)
function createInfraredRamp(v: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, v));
  if (clamped <= 0) return [0, 0, 0];
  if (clamped < 0.25) {
    const t = clamped / 0.25;
    return [Math.round(120 * t), Math.round(10 * t), Math.round(10 * t)];
  }
  if (clamped < 0.55) {
    const t = (clamped - 0.25) / 0.30;
    return [
      Math.round(120 + 90 * t),
      Math.round(10 + 55 * t),
      10,
    ];
  }
  if (clamped < 0.80) {
    const t = (clamped - 0.55) / 0.25;
    return [
      Math.round(210 + 40 * t),
      Math.round(65 + 85 * t),
      Math.round(10 + 15 * t),
    ];
  }
  const t = (clamped - 0.80) / 0.20;
  return [
    Math.round(250 + 5 * t),
    Math.round(150 + 90 * t),
    Math.round(25 + 155 * t),
  ];
}

// Detector color palette
const DETECTOR_COLORS: Record<number, { bg: string; text: string; hex: string }> = {
  1: { bg: 'bg-blue-500/20', text: 'text-blue-400', hex: '#60a5fa' },
  2: { bg: 'bg-cyan-500/20', text: 'text-cyan-400', hex: '#22d3ee' },
  3: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', hex: '#34d399' },
  4: { bg: 'bg-amber-500/20', text: 'text-amber-400', hex: '#fbbf24' },
  5: { bg: 'bg-orange-500/20', text: 'text-orange-400', hex: '#fb923c' },
  6: { bg: 'bg-rose-500/20', text: 'text-rose-400', hex: '#f87171' },
};

export const ExplorerPage: React.FC<ExplorerPageProps> = ({
  dataSource,
  realDataset,
  missingDetails,
  selectedRealExposure,
  onSelectRealExposure,
  selectedRealSource,
  onSelectRealSource,
  onCursorMove,
  currentTarget,
  onSelectTarget,
  currentBand,
  onSelectBand,
  fluxUnit,
  colormap: initialColormap,
}) => {
  const isReal = dataSource === 'real' && realDataset !== null;

  // Active colormap: 'infrared' | 'grayscale' | 'inverted'
  const [activeColormap, setActiveColormap] = useState<'infrared' | 'grayscale' | 'inverted'>('infrared');
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Suspect points toggle (default on)
  const [showSuspectPoints, setShowSuspectPoints] = useState<boolean>(true);

  // Inspector tab: 'spectrum' | 'match' | 'sources'
  const [activeInspectorTab, setActiveInspectorTab] = useState<'spectrum' | 'match' | 'sources'>('spectrum');
  const [isLogY, setIsLogY] = useState<boolean>(true);
  const [hoveredPoint, setHoveredPoint] = useState<RealSpectrumPoint | null>(null);
  const [hoveredSourceId, setHoveredSourceId] = useState<string | null>(null);

  // Sources table search & sort
  const [sourceSearch, setSourceSearch] = useState<string>('');
  const [sourceSortCol, setSourceSortCol] = useState<'id' | 'peak_snr' | 'valid_points' | 'matched'>('peak_snr');
  const [sourceSortAsc, setSourceSortAsc] = useState<boolean>(false);

  // Canvas & viewer container refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerContainerRef = useRef<HTMLDivElement | null>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const lastBBoxRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
  const hasFittedRef = useRef<boolean>(false);

  // 1. Exposures & Sources from real dataset
  const exposures = useMemo(() => realDataset?.exposures || [], [realDataset]);
  const sources = useMemo(() => realDataset?.sources || [], [realDataset]);
  const currentExposure = selectedRealExposure || exposures[0] || null;
  const currentSource = selectedRealSource || sources[0] || null;

  // Spectrum points for current selected source
  const currentSpectrum = useMemo<RealSpectrumPoint[]>(() => {
    if (!realDataset || !currentSource) return [];
    return realDataset.spectra[currentSource.id] || [];
  }, [realDataset, currentSource]);

  // Preload neighbouring exposures for instantaneous switching
  useEffect(() => {
    if (!exposures.length || !currentExposure) return;
    const curIdx = exposures.findIndex((e) => e.id === currentExposure.id);
    const indicesToPreload = [curIdx - 2, curIdx - 1, curIdx + 1, curIdx + 2].filter(
      (idx) => idx >= 0 && idx < exposures.length
    );

    for (const idx of indicesToPreload) {
      const exp = exposures[idx];
      const imgUrl = `/real/${exp.image}`;
      if (!imageCacheRef.current.has(imgUrl)) {
        const img = new Image();
        img.src = imgUrl;
        imageCacheRef.current.set(imgUrl, img);
      }
    }
  }, [exposures, currentExposure]);

  // Keyboard navigation for exposures: '[' for previous, ']' for next
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!exposures.length || !currentExposure) return;
      const curIdx = exposures.findIndex((x) => x.id === currentExposure.id);
      if (e.key === '[') {
        e.preventDefault();
        const prevIdx = Math.max(0, curIdx - 1);
        onSelectRealExposure(exposures[prevIdx]);
      } else if (e.key === ']') {
        e.preventDefault();
        const nextIdx = Math.min(exposures.length - 1, curIdx + 1);
        onSelectRealExposure(exposures[nextIdx]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [exposures, currentExposure, onSelectRealExposure]);

  // Fits viewer to bounding box of valid non-transparent pixels with 16px padding
  const fitViewerToBBox = useCallback((bbox: { minX: number; minY: number; maxX: number; maxY: number }) => {
    const container = viewerContainerRef.current;
    if (!container) return;
    const cW = container.clientWidth;
    const cH = container.clientHeight;
    if (cW <= 0 || cH <= 0) return;

    const pad = 16;
    const availW = Math.max(40, cW - pad * 2);
    const availH = Math.max(40, cH - pad * 2);

    const bboxW = Math.max(10, bbox.maxX - bbox.minX + 1);
    const bboxH = Math.max(10, bbox.maxY - bbox.minY + 1);

    const newZoom = Math.min(availW / bboxW, availH / bboxH);
    const clampedZoom = Math.max(0.6, Math.min(8.0, Number(newZoom.toFixed(2))));
    setZoomLevel(clampedZoom);

    // Center the bounding box in the viewer container
    const bboxCenterX = (bbox.minX + bbox.maxX) / 2.0;
    const bboxCenterY = (bbox.minY + bbox.maxY) / 2.0;

    const dispCenterX = (bboxCenterX / 145) * 146 * clampedZoom;
    const dispCenterY = (bboxCenterY / 145) * 146 * clampedZoom;

    setPanOffset({
      x: cW / 2 - dispCenterX,
      y: cH / 2 - dispCenterY,
    });
  }, []);

  // Observe container resize to maintain fit with 16px padding
  useEffect(() => {
    const container = viewerContainerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      if (lastBBoxRef.current) {
        fitViewerToBBox(lastBBoxRef.current);
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [fitViewerToBBox]);

  // Render Image onto Canvas with selected Colormap
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!isReal || !currentExposure) {
      // Render simple synthetic backdrop for fallback
      ctx.fillStyle = '#08090b';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#6b7280';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Synthetic Fallback Plate', canvas.width / 2, canvas.height / 2);
      return;
    }

    const imgUrl = `/real/${currentExposure.image}`;
    let img = imageCacheRef.current.get(imgUrl);

    const drawProcessedImage = (imageEl: HTMLImageElement) => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Create an offscreen buffer to read raw grayscale pixel intensities
      const offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      const offCtx = offscreen.getContext('2d');
      if (!offCtx) return;

      offCtx.drawImage(imageEl, 0, 0, w, h);
      const imgData = offCtx.getImageData(0, 0, w, h);
      const d = imgData.data;

      // Colormap transform & detect bounding box of valid non-transparent pixels
      let minX = w;
      let minY = h;
      let maxX = -1;
      let maxY = -1;

      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const idx = (py * w + px) * 4;
          const alpha = d[idx + 3];
          if (alpha === 0) continue; // Keep transparent invalid pixels

          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;

          const gray = d[idx]; // Input is grayscale (R=G=B)
          const v = gray / 255.0;

          if (activeColormap === 'grayscale') {
            // Already grayscale
            continue;
          } else if (activeColormap === 'inverted') {
            d[idx] = 255 - gray;
            d[idx + 1] = 255 - gray;
            d[idx + 2] = 255 - gray;
          } else if (activeColormap === 'infrared') {
            const [r, g, b] = createInfraredRamp(v);
            d[idx] = r;
            d[idx + 1] = g;
            d[idx + 2] = b;
          }
        }
      }

      ctx.putImageData(imgData, 0, 0);

      // Fit to bounding box of valid pixels with 16px padding on load
      if (maxX >= minX && maxY >= minY) {
        const bbox = { minX, minY, maxX, maxY };
        lastBBoxRef.current = bbox;
        if (!hasFittedRef.current) {
          fitViewerToBBox(bbox);
          hasFittedRef.current = true;
        }
      }
    };

    if (img && img.complete && img.naturalWidth > 0) {
      drawProcessedImage(img);
    } else {
      const newImg = new Image();
      newImg.src = imgUrl;
      newImg.onload = () => {
        imageCacheRef.current.set(imgUrl, newImg);
        drawProcessedImage(newImg);
      };
      newImg.onerror = () => {
        ctx.fillStyle = '#0a0c10';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#9ca3af';
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`Image ${currentExposure.image} not available`, canvas.width / 2, canvas.height / 2);
      };
    }
  }, [isReal, currentExposure, activeColormap, fitViewerToBBox]);

  // Mouse Move over Canvas -> calculate Sky Coordinates and forward to status bar
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - panOffset.x;
    const mouseY = e.clientY - rect.top - panOffset.y;

    const displaySize = 146 * zoomLevel;
    const normX = (mouseX / displaySize) * 145;
    const normY = (mouseY / displaySize) * 145;

    if (normX >= 0 && normX <= 145 && normY >= 0 && normY <= 145 && realDataset?.manifest.common_grid) {
      const sky = pixelToSky(normX, normY, realDataset.manifest.common_grid);
      onCursorMove({
        ra_deg: sky.ra_deg,
        dec_deg: sky.dec_deg,
        exposure_id: currentExposure?.id || null,
        wavelength_um: currentExposure?.wavelength_um || null,
        detector: currentExposure?.detector || null,
        zoom: zoomLevel,
        selectedSourceId: currentSource?.id || null,
      });
    }
  };

  const handleCanvasMouseLeave = () => {
    onCursorMove({
      ra_deg: null,
      dec_deg: null,
      exposure_id: currentExposure?.id || null,
      wavelength_um: currentExposure?.wavelength_um || null,
      detector: currentExposure?.detector || null,
      zoom: zoomLevel,
      selectedSourceId: currentSource?.id || null,
    });
  };

  // Zoom handlers
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.2 : 0.2;
    setZoomLevel((prev) => Math.min(8.0, Math.max(0.6, Number((prev + delta).toFixed(1)))));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPanOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const resetZoomPan = () => {
    if (lastBBoxRef.current) {
      fitViewerToBBox(lastBBoxRef.current);
    } else {
      setZoomLevel(1);
      setPanOffset({ x: 0, y: 0 });
    }
  };

  // Center on source in pixel coordinates
  const centerOnSource = useCallback((src: RealSource) => {
    onSelectRealSource(src);
    // Center the viewer plate around this source
    const displaySize = 146 * zoomLevel;
    const plateWidth = 480;
    const plateHeight = 480;
    const srcDispX = (src.x / 145) * displaySize;
    const srcDispY = (src.y / 145) * displaySize;

    setPanOffset({
      x: plateWidth / 2 - srcDispX,
      y: plateHeight / 2 - srcDispY,
    });
  }, [zoomLevel, onSelectRealSource]);

  // Export Spectrum CSV with quality fields
  const handleExportCSV = () => {
    if (!currentSource || !currentSpectrum.length) return;
    const headers = [
      'exposure_id',
      'wavelength_um',
      'bandwidth_um',
      'flux_uJy',
      'flux_err_uJy',
      'detector',
      'time_utc',
      'n_good_pixels',
      'quality',
      'quality_reasons',
      'null_reason',
    ];

    const rows = currentSpectrum.map((pt) => [
      pt.exposure_id,
      pt.wavelength_um ?? '',
      pt.bandwidth_um ?? '',
      pt.flux_uJy ?? '',
      pt.flux_err_uJy ?? '',
      pt.detector,
      pt.time_utc,
      pt.n_good_pixels,
      pt.quality ?? 'ok',
      pt.quality_reasons && pt.quality_reasons.length ? `"${pt.quality_reasons.join('; ')}"` : '""',
      pt.null_reason ? `"${pt.null_reason}"` : '',
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `SPHEREx_${currentSource.id}_spectrum.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Sortable sources list
  const filteredAndSortedSources = useMemo(() => {
    const list = sources.filter((s) =>
      s.id.toLowerCase().includes(sourceSearch.toLowerCase()) ||
      (s.match?.identifier && s.match.identifier.toLowerCase().includes(sourceSearch.toLowerCase()))
    );

    list.sort((a, b) => {
      let valA: number | string = 0;
      let valB: number | string = 0;
      if (sourceSortCol === 'id') {
        valA = a.id;
        valB = b.id;
      } else if (sourceSortCol === 'peak_snr') {
        valA = a.peak_snr;
        valB = b.peak_snr;
      } else if (sourceSortCol === 'valid_points') {
        valA = a.valid_points;
        valB = b.valid_points;
      } else if (sourceSortCol === 'matched') {
        valA = a.match ? 1 : 0;
        valB = b.match ? 1 : 0;
      }

      if (valA < valB) return sourceSortAsc ? -1 : 1;
      if (valA > valB) return sourceSortAsc ? 1 : -1;
      return 0;
    });

    return list;
  }, [sources, sourceSearch, sourceSortCol, sourceSortAsc]);

  // Spectrum chart min/max calculations
  const validPoints = useMemo(
    () => currentSpectrum.filter((p) => p.flux_uJy !== null && p.wavelength_um !== null),
    [currentSpectrum]
  );

  const { minWave, maxWave, minFlux, maxFlux } = useMemo(() => {
    if (!validPoints.length) {
      return { minWave: 0.75, maxWave: 5.0, minFlux: 1, maxFlux: 1000 };
    }
    const waves = validPoints.map((p) => p.wavelength_um as number);
    const fluxes = validPoints.map((p) => p.flux_uJy as number);
    return {
      minWave: Math.min(...waves),
      maxWave: Math.max(...waves),
      minFlux: isLogY ? Math.max(0.1, Math.min(...fluxes.map((f) => (f > 0 ? f : 0.1)))) : Math.min(...fluxes),
      maxFlux: Math.max(...fluxes),
    };
  }, [validPoints, isLogY]);

  // Chart dimensions in SVG coordinates (viewBox 0 0 600 240)
  const chartW = 490;
  const chartH = 155;
  const padLeft = 70;
  const padBottom = 40;
  const padTop = 20;

  const getChartX = useCallback(
    (wave: number) => {
      return padLeft + ((wave - minWave) / Math.max(0.01, maxWave - minWave)) * chartW;
    },
    [minWave, maxWave, padLeft, chartW]
  );

  const getChartY = useCallback(
    (flux: number) => {
      if (isLogY) {
        const logMin = Math.log10(minFlux);
        const logMax = Math.log10(Math.max(minFlux * 1.05, maxFlux));
        const logVal = Math.log10(Math.max(minFlux, flux));
        const ratio = (logVal - logMin) / Math.max(0.01, logMax - logMin);
        return padTop + (1 - ratio) * chartH;
      } else {
        const ratio = (flux - minFlux) / Math.max(0.01, maxFlux - minFlux);
        return padTop + (1 - ratio) * chartH;
      }
    },
    [isLogY, minFlux, maxFlux, padTop, chartH]
  );

  // Discrete integer X-axis ticks at 1, 2, 3, 4, 5 µm
  const xTicks = useMemo(() => {
    return [1, 2, 3, 4, 5].filter((w) => w >= Math.floor(minWave) && w <= Math.ceil(maxWave));
  }, [minWave, maxWave]);

  // 4 to 6 readable Y-axis ticks with thousands separators
  const yTicks = useMemo(() => {
    if (isLogY) {
      const minLog = Math.floor(Math.log10(minFlux));
      const maxLog = Math.ceil(Math.log10(maxFlux));
      const raw: number[] = [];
      for (let e = minLog; e <= maxLog; e++) {
        raw.push(Math.pow(10, e));
      }
      if (raw.length >= 4 && raw.length <= 6) return raw;
      if (raw.length > 6) {
        const step = Math.ceil(raw.length / 5);
        return raw.filter((_, idx) => idx % step === 0 || idx === raw.length - 1);
      }
      const expanded: number[] = [];
      for (let e = minLog; e <= maxLog; e++) {
        [1, 2, 5].forEach((m) => {
          const val = m * Math.pow(10, e);
          if (val >= minFlux * 0.9 && val <= maxFlux * 1.1) {
            expanded.push(val);
          }
        });
      }
      return expanded.slice(0, 6);
    } else {
      const count = 5;
      const step = (maxFlux - minFlux) / (count - 1);
      return Array.from({ length: count }, (_, i) => minFlux + i * step);
    }
  }, [minFlux, maxFlux, isLogY]);

  // Connecting line segments ONLY between consecutive valid, non-suspect points of the SAME detector
  const connectingSegments = useMemo(() => {
    const segments: Array<{ d: string; color: string }> = [];
    let prev: RealSpectrumPoint | null = null;

    for (const pt of currentSpectrum) {
      const isValid = pt.flux_uJy !== null && pt.wavelength_um !== null;
      const isSuspect = pt.quality === 'suspect';

      // Break segment at detector change or null or suspect
      if (!isValid || isSuspect) {
        prev = null;
        continue;
      }

      if (prev !== null) {
        if (prev.detector === pt.detector) {
          const x1 = getChartX(prev.wavelength_um as number);
          const y1 = getChartY(prev.flux_uJy as number);
          const x2 = getChartX(pt.wavelength_um as number);
          const y2 = getChartY(pt.flux_uJy as number);
          const color = DETECTOR_COLORS[pt.detector]?.hex || '#41deb3';
          segments.push({
            d: `M ${x1} ${y1} L ${x2} ${y2}`,
            color,
          });
        }
      }
      prev = pt;
    }
    return segments;
  }, [currentSpectrum, getChartX, getChartY]);

  return (
    <div className="w-full pt-14 pb-10 flex-1 flex flex-col bg-surface overflow-hidden">
      {/* Top Region and Metadata Header Bar */}
      <div className="w-full bg-surface-container-lowest border-b border-surface-container-high/60 px-gutter py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-secondary"></span>
            <span className="font-headline-sm text-sm font-bold text-on-surface">
              {isReal
                ? realDataset.manifest.region.name
                : 'Synthetic Demo Field (Fallback)'}
            </span>
          </div>

          <span className="text-outline-variant text-xs">·</span>

          <span className="font-data-mono-sm text-xs text-outline">
            RA {isReal ? realDataset.manifest.region.ra_deg.toFixed(4) : currentTarget.raHMS}° · DEC{' '}
            {isReal ? realDataset.manifest.region.dec_deg.toFixed(4) : currentTarget.decDMS}° · {isReal ? realDataset.manifest.region.size_arcmin : '15'} arcmin
          </span>

          <DataSourceChip dataSource={dataSource} missingDetails={missingDetails} />
        </div>

        {/* Plate Controls: Colormap, Stretch & Zoom */}
        <div className="flex items-center gap-3 font-data-mono-sm text-xs">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-surface-container border border-surface-container-high">
            <span className="text-outline text-[11px]">Colormap:</span>
            {(['infrared', 'grayscale', 'inverted'] as const).map((cm) => (
              <button
                key={cm}
                onClick={() => setActiveColormap(cm)}
                className={`px-1.5 py-0.5 rounded text-[11px] capitalize cursor-pointer transition-colors ${
                  activeColormap === cm
                    ? 'bg-primary text-on-primary font-bold'
                    : 'text-outline hover:text-on-surface'
                }`}
              >
                {cm}
              </button>
            ))}
          </div>

          <div className="px-2 py-0.5 rounded bg-surface-container-low border border-surface-container-high text-outline text-[11px]">
            Stretch: <span className="text-on-surface font-semibold">asinh, 1–99.5%</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setZoomLevel((z) => Math.min(8.0, Number((z + 0.2).toFixed(1))))}
              className="px-1.5 py-0.5 rounded bg-surface-container border border-surface-container-high hover:bg-surface-container-high text-on-surface cursor-pointer"
              title="Zoom In"
            >
              +
            </button>
            <button
              onClick={() => setZoomLevel((z) => Math.max(0.6, Number((z - 0.2).toFixed(1))))}
              className="px-1.5 py-0.5 rounded bg-surface-container border border-surface-container-high hover:bg-surface-container-high text-on-surface cursor-pointer"
              title="Zoom Out"
            >
              -
            </button>
            <button
              onClick={resetZoomPan}
              className="px-1.5 py-0.5 rounded bg-surface-container border border-surface-container-high hover:bg-surface-container-high text-outline hover:text-on-surface text-[10px] cursor-pointer"
              title="Reset Zoom & Pan"
            >
              1:1
            </button>
          </div>
        </div>
      </div>

      {/* Main Workspace: Left Image Viewer + Right Multi-Tab Inspector */}
      <div className="flex-1 w-full grid grid-cols-1 lg:grid-cols-12 gap-0 overflow-hidden">
        {/* LEFT COLUMN (7 COLS): Image Plate & Exposure Ribbon */}
        <div className="lg:col-span-7 flex flex-col border-r border-surface-container-high/60 bg-surface-container-lowest relative overflow-hidden">
          {/* Exposure Quick Header */}
          <div className="px-4 py-2 border-b border-surface-container-high/40 flex items-center justify-between text-xs font-data-mono-sm">
            <div className="flex items-center gap-2">
              <span className="text-primary font-bold">{currentExposure?.id || 'E001'}</span>
              <span className="text-on-surface">{currentExposure?.wavelength_um.toFixed(3)} µm</span>
              <span className="text-outline text-[11px]">
                (Detector {currentExposure?.detector || 1})
              </span>
              <span className="text-outline-variant text-[11px]">
                {currentExposure?.time_utc ? currentExposure.time_utc.split('T')[0] : ''}
              </span>
            </div>

            <div className="text-outline text-[11px]">
              Use <kbd className="px-1 py-0.5 bg-surface-container rounded border border-surface-container-high text-[10px] text-on-surface font-mono">[</kbd> and <kbd className="px-1 py-0.5 bg-surface-container rounded border border-surface-container-high text-[10px] text-on-surface font-mono">]</kbd> to step exposures
            </div>
          </div>

          {/* Image Display Area with Pan, Zoom & Source Overlay */}
          <div
            ref={viewerContainerRef}
            className="flex-1 relative flex items-center justify-center overflow-hidden cursor-crosshair select-none bg-[#07080a]"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={(e) => {
              handleMouseMove(e);
              handleCanvasMouseMove(e);
            }}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => {
              handleMouseUp();
              handleCanvasMouseLeave();
            }}
          >
            <div
              className="relative transition-transform duration-75"
              style={{
                width: `${146 * zoomLevel}px`,
                height: `${146 * zoomLevel}px`,
                transform: `translate(${panOffset.x}px, ${panOffset.y}px)`,
                imageRendering: 'pixelated',
              }}
            >
              {/* Underlying Clean Canvas */}
              <canvas
                ref={canvasRef}
                width={146}
                height={146}
                className="w-full h-full block"
              />

              {/* Source Overlays: 72 Real Sources */}
              {sources.map((src) => {
                const isSelected = currentSource?.id === src.id;
                const isHovered = hoveredSourceId === src.id;
                const leftPct = (src.x / 145) * 100;
                const topPct = (src.y / 145) * 100;

                return (
                  <div
                    key={src.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectRealSource(src);
                    }}
                    onMouseEnter={() => setHoveredSourceId(src.id)}
                    onMouseLeave={() => setHoveredSourceId(null)}
                    className="absolute cursor-pointer -translate-x-1/2 -translate-y-1/2 group"
                    style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                  >
                    {/* Ring Marker */}
                    <div
                      className={`rounded-full transition-all ${
                        isSelected
                          ? 'w-5 h-5 border-2 border-secondary shadow-[0_0_8px_rgba(65,222,179,0.8)]'
                          : isHovered
                          ? 'w-4 h-4 border border-primary bg-primary/20'
                          : 'w-3 h-3 border border-secondary/60 hover:border-secondary'
                      }`}
                    ></div>

                    {/* Label */}
                    {(isSelected || isHovered) && (
                      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-1.5 py-0.5 rounded bg-surface-container-lowest/95 border border-surface-container-high text-[10px] font-data-mono-sm text-on-surface whitespace-nowrap shadow-xl z-20 pointer-events-none">
                        <span className="text-secondary font-bold">{src.id}</span>
                        <span className="text-outline ml-1">Detection SNR {src.peak_snr.toFixed(1)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 120-EXPOSURE RIBBON */}
          <div className="border-t border-surface-container-high/60 bg-surface-container-lowest p-2.5 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[11px] font-data-mono-sm">
              <span className="text-outline">
                120 Multi-Extension Exposures (Sorted by Central Wavelength)
              </span>
              <span className="text-secondary">
                Selected: {currentExposure?.id} · {currentExposure?.wavelength_um.toFixed(3)} µm · Det {currentExposure?.detector}
              </span>
            </div>

            {/* Ticks Bar */}
            <div className="relative w-full h-10 bg-surface-container-low rounded border border-surface-container-high/50 flex items-center px-1 overflow-x-auto">
              <div className="w-full h-full flex items-end justify-between relative">
                {exposures.map((exp) => {
                  const isSelected = currentExposure?.id === exp.id;
                  // Check if this exposure gives a null point for selected source
                  const pt = currentSpectrum.find((p) => p.exposure_id === exp.id);
                  const isNull = pt && pt.flux_uJy === null;
                  const nullReason = pt?.null_reason || 'Corrupted or unobserved';
                  const detColor = DETECTOR_COLORS[exp.detector]?.hex || '#41deb3';

                  return (
                    <button
                      key={exp.id}
                      onClick={() => onSelectRealExposure(exp)}
                      title={`${exp.id}: ${exp.wavelength_um.toFixed(3)} µm (Det ${exp.detector})${
                        isNull ? ` — Null: ${nullReason}` : ''
                      }`}
                      className={`flex-1 h-full flex items-end justify-center transition-all group cursor-pointer focus:outline-none`}
                    >
                      <div
                        className={`w-[2.5px] rounded-t transition-all ${
                          isSelected
                            ? 'h-8 w-[4px] shadow-[0_0_6px_rgba(255,255,255,0.8)]'
                            : isNull
                            ? 'h-3.5 border border-dashed border-red-400/80 bg-transparent'
                            : 'h-4 hover:h-6'
                        }`}
                        style={{
                          backgroundColor: isNull ? 'transparent' : isSelected ? '#ffffff' : detColor,
                          borderColor: isNull ? '#f87171' : undefined,
                        }}
                      ></div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Ribbon Wavelength Axis Marks */}
            <div className="flex items-center justify-between text-[10px] font-data-mono-sm text-outline px-1">
              <span>0.75 µm</span>
              <span>1.5 µm</span>
              <span>2.5 µm</span>
              <span>3.5 µm</span>
              <span>4.5 µm</span>
              <span>5.0 µm</span>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN (5 COLS): Inspector Tabs */}
        <div className="lg:col-span-5 flex flex-col bg-surface border-t lg:border-t-0 overflow-y-auto">
          {/* Tab Selector Buttons */}
          <div className="flex items-center border-b border-surface-container-high/60 bg-surface-container-lowest px-4">
            {(['spectrum', 'match', 'sources'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveInspectorTab(tab)}
                className={`py-2.5 px-4 font-label-editorial text-xs uppercase tracking-wider transition-colors border-b-2 cursor-pointer ${
                  activeInspectorTab === tab
                    ? 'border-primary text-primary font-bold'
                    : 'border-transparent text-outline hover:text-on-surface'
                }`}
              >
                {tab === 'spectrum' ? 'Spectrum' : tab === 'match' ? 'Match (Gaia DR3)' : 'Sources (72)'}
              </button>
            ))}
          </div>

          {/* TAB 1: SPECTRUM */}
          {activeInspectorTab === 'spectrum' && (
            <div className="p-4 flex flex-col gap-4">
              {/* Header Info */}
              <div className="flex items-center justify-between border-b border-surface-container-high/50 pb-2">
                <div>
                  <span className="font-headline-sm text-base font-bold text-on-surface">
                    {currentSource?.id || 'SPX-NEP-001'}
                  </span>
                  <span className="font-data-mono-sm text-xs text-secondary ml-2">
                    Detection SNR {currentSource?.peak_snr.toFixed(1) || '18.5'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsLogY(!isLogY)}
                    className="px-2 py-0.5 rounded text-xs font-data-mono-sm bg-surface-container border border-surface-container-high text-on-surface hover:bg-surface-container-high cursor-pointer"
                  >
                    {isLogY ? 'Log Y' : 'Linear Y'}
                  </button>

                  <button
                    onClick={handleExportCSV}
                    className="px-2 py-0.5 rounded text-xs font-data-mono-sm bg-primary-container text-on-primary hover:bg-primary transition-colors cursor-pointer flex items-center gap-1"
                    title="Export complete spectrum with nulls as CSV"
                  >
                    <span className="material-symbols-outlined text-[14px]">download</span>
                    <span>CSV</span>
                  </button>
                </div>
              </div>

              {/* Disclaimer & Boundary Step Alert */}
              <div className="p-2.5 rounded bg-surface-container-low border border-surface-container-high text-[11px] font-body-sm text-outline flex flex-col gap-1">
                <span className="text-amber-300 font-semibold flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">info</span>
                  Absolute flux is approximate (nominal pixel solid angle)
                </span>
                <span>
                  Notice: Step changes at detector boundaries (LVF 1–6) can be instrumental.
                </span>
              </div>

              {/* Spectral Chart SVG */}
              <div className="relative w-full bg-surface-container-lowest rounded-lg border border-surface-container-high p-2 flex flex-col">
                <svg
                  viewBox="0 0 600 240"
                  className="w-full h-48 overflow-visible"
                >
                  {/* Y Axis Label */}
                  <text
                    x={-((padTop + chartH / 2))}
                    y={16}
                    transform="rotate(-90)"
                    textAnchor="middle"
                    fill="#9ca3af"
                    fontSize={11}
                    fontFamily="monospace"
                  >
                    Flux (µJy)
                  </text>

                  {/* X Axis Label */}
                  <text
                    x={padLeft + chartW / 2}
                    y={padTop + chartH + 34}
                    textAnchor="middle"
                    fill="#9ca3af"
                    fontSize={11}
                    fontFamily="monospace"
                  >
                    Wavelength (µm)
                  </text>

                  {/* Horizontal Gridlines and Y Ticks */}
                  {yTicks.map((val, idx) => {
                    const y = getChartY(val);
                    return (
                      <g key={`ytick-${idx}`}>
                        <line
                          x1={padLeft}
                          y1={y}
                          x2={padLeft + chartW}
                          y2={y}
                          stroke="rgba(255,255,255,0.06)"
                          strokeDasharray="3 3"
                        />
                        <line
                          x1={padLeft - 4}
                          y1={y}
                          x2={padLeft}
                          y2={y}
                          stroke="rgba(255,255,255,0.3)"
                          strokeWidth={1}
                        />
                        <text
                          x={padLeft - 7}
                          y={y + 3}
                          textAnchor="end"
                          fill="#9ca3af"
                          fontSize={9}
                          fontFamily="monospace"
                        >
                          {Math.round(val).toLocaleString()}
                        </text>
                      </g>
                    );
                  })}

                  {/* Vertical Gridlines and X Ticks (at 1, 2, 3, 4, 5 µm) */}
                  {xTicks.map((wVal) => {
                    const x = getChartX(wVal);
                    if (x < padLeft || x > padLeft + chartW) return null;
                    return (
                      <g key={`xtick-${wVal}`}>
                        <line
                          x1={x}
                          y1={padTop}
                          x2={x}
                          y2={padTop + chartH}
                          stroke="rgba(255,255,255,0.06)"
                          strokeDasharray="3 3"
                        />
                        <line
                          x1={x}
                          y1={padTop + chartH}
                          x2={x}
                          y2={padTop + chartH + 4}
                          stroke="rgba(255,255,255,0.3)"
                          strokeWidth={1}
                        />
                        <text
                          x={x}
                          y={padTop + chartH + 16}
                          textAnchor="middle"
                          fill="#9ca3af"
                          fontSize={10}
                          fontFamily="monospace"
                        >
                          {wVal}
                        </text>
                      </g>
                    );
                  })}

                  {/* Active Exposure Wavelength Marker */}
                  {currentExposure && (
                    <line
                      x1={getChartX(currentExposure.wavelength_um)}
                      y1={padTop}
                      x2={getChartX(currentExposure.wavelength_um)}
                      y2={padTop + chartH}
                      stroke="#41deb3"
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                    />
                  )}

                  {/* Connecting Line Segments (ONLY consecutive valid non-suspect points of SAME detector) */}
                  {connectingSegments.map((seg, idx) => (
                    <path
                      key={`seg-${idx}`}
                      d={seg.d}
                      fill="none"
                      stroke={seg.color}
                      strokeWidth={1.2}
                      strokeOpacity={0.75}
                    />
                  ))}

                  {/* Spectral Points with Error Bars */}
                  {currentSpectrum.map((pt, idx) => {
                    if (pt.flux_uJy === null || pt.wavelength_um === null) {
                      // Hollow null point on X axis
                      const x = pt.wavelength_um
                        ? getChartX(pt.wavelength_um)
                        : padLeft + (idx / currentSpectrum.length) * chartW;
                      const y = padTop + chartH + 8;
                      return (
                        <circle
                          key={`null-${idx}`}
                          cx={x}
                          cy={y}
                          r={2.5}
                          fill="none"
                          stroke="#f87171"
                          strokeWidth={1.2}
                          className="cursor-pointer hover:r-3.5 transition-all"
                          onMouseEnter={() => setHoveredPoint(pt)}
                        />
                      );
                    }

                    const isSuspect = pt.quality === 'suspect';
                    if (isSuspect && !showSuspectPoints) {
                      return null;
                    }

                    const x = getChartX(pt.wavelength_um);
                    const y = getChartY(pt.flux_uJy);
                    const color = DETECTOR_COLORS[pt.detector]?.hex || '#41deb3';
                    const err = pt.flux_err_uJy || 0;
                    const yErrTop = getChartY(pt.flux_uJy + err);
                    const yErrBot = getChartY(Math.max(0.01, pt.flux_uJy - err));
                    const isSelected = currentExposure?.id === pt.exposure_id;

                    return (
                      <g
                        key={`pt-${idx}`}
                        className="cursor-pointer"
                        onMouseEnter={() => setHoveredPoint(pt)}
                        onClick={() => {
                          const exp = exposures.find((e) => e.id === pt.exposure_id);
                          if (exp) onSelectRealExposure(exp);
                        }}
                      >
                        {/* Error Bar */}
                        <line
                          x1={x}
                          y1={yErrTop}
                          x2={x}
                          y2={yErrBot}
                          stroke={color}
                          strokeWidth={1}
                          opacity={isSuspect ? 0.4 : 0.7}
                        />
                        {/* Point Marker: Suspect points drawn hollow */}
                        {isSuspect ? (
                          <circle
                            cx={x}
                            cy={y}
                            r={isSelected ? 4.5 : 3.2}
                            fill="none"
                            stroke={isSelected ? '#ffffff' : color}
                            strokeWidth={1.8}
                          />
                        ) : (
                          <circle
                            cx={x}
                            cy={y}
                            r={isSelected ? 4 : 2.5}
                            fill={isSelected ? '#ffffff' : color}
                            stroke={color}
                            strokeWidth={1}
                          />
                        )}
                      </g>
                    );
                  })}
                </svg>

                {/* Detector Legend & Suspect Toggle */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-data-mono-sm mt-2 pt-2 border-t border-surface-container-high/40">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-outline">Detectors:</span>
                    {[1, 2, 3, 4, 5, 6].map((det) => (
                      <div key={det} className="flex items-center gap-1">
                        <span
                          className="w-2 h-2 rounded-full inline-block"
                          style={{ backgroundColor: DETECTOR_COLORS[det].hex }}
                        ></span>
                        <span className="text-outline">LVF {det}</span>
                      </div>
                    ))}
                    <div className="flex items-center gap-1" title="Points with flagged pixels, image edge proximity, or flagged peak">
                      <span className="w-2.5 h-2.5 rounded-full border border-amber-400 inline-block"></span>
                      <span className="text-amber-400 font-semibold">Suspect</span>
                    </div>
                    <div className="flex items-center gap-1" title="Corrupted or unobserved exposure point">
                      <span className="w-2 h-2 rounded-full border border-dashed border-red-400 inline-block"></span>
                      <span className="text-red-400">Null</span>
                    </div>
                  </div>

                  <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-outline hover:text-on-surface select-none">
                    <input
                      type="checkbox"
                      checked={showSuspectPoints}
                      onChange={(e) => setShowSuspectPoints(e.target.checked)}
                      className="rounded accent-amber-400 cursor-pointer"
                    />
                    <span>Show suspect points</span>
                  </label>
                </div>
              </div>

              {/* Photometry Table for Hovered / Selected Point */}
              {(() => {
                const pt =
                  hoveredPoint ||
                  currentSpectrum.find((p) => p.exposure_id === currentExposure?.id) ||
                  currentSpectrum[0] ||
                  null;

                if (!pt) return null;

                const isSuspect = pt.quality === 'suspect';

                return (
                  <div className="p-3 rounded-lg bg-surface-container-lowest border border-surface-container-high flex flex-col gap-2">
                    <div className="flex items-center justify-between border-b border-surface-container-high/40 pb-1.5 text-xs font-data-mono-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-on-surface font-bold">
                          Photometry: Exposure {pt.exposure_id}
                        </span>
                        {isSuspect && (
                          <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] uppercase font-bold">
                            Suspect
                          </span>
                        )}
                      </div>
                      <span className="text-outline text-[11px]">
                        λ = {pt.wavelength_um ? `${pt.wavelength_um.toFixed(3)} µm` : 'None'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-data-mono-sm">
                      <div className="p-1.5 rounded bg-surface-container-low border border-surface-container-high flex flex-col">
                        <span className="text-outline text-[10px]">DETECTOR</span>
                        <span className="text-primary font-bold">LVF {pt.detector}</span>
                      </div>
                      <div className="p-1.5 rounded bg-surface-container-low border border-surface-container-high flex flex-col">
                        <span className="text-outline text-[10px]">FLUX</span>
                        <span className="text-on-surface font-semibold">
                          {pt.flux_uJy !== null ? `${pt.flux_uJy.toFixed(2)} µJy` : 'null'}
                        </span>
                      </div>
                      <div className="p-1.5 rounded bg-surface-container-low border border-surface-container-high flex flex-col">
                        <span className="text-outline text-[10px]">1-σ ERROR</span>
                        <span className="text-on-surface">
                          {pt.flux_err_uJy !== null ? `±${pt.flux_err_uJy.toFixed(2)} µJy` : 'null'}
                        </span>
                      </div>
                      <div className="p-1.5 rounded bg-surface-container-low border border-surface-container-high flex flex-col">
                        <span className="text-outline text-[10px]">POINT SNR</span>
                        <span className="text-secondary font-bold">
                          {pt.flux_uJy !== null && pt.flux_err_uJy
                            ? (pt.flux_uJy / pt.flux_err_uJy).toFixed(1)
                            : '--'}
                        </span>
                      </div>
                    </div>

                    {isSuspect && pt.quality_reasons && pt.quality_reasons.length > 0 && (
                      <div className="px-2.5 py-1.5 rounded bg-amber-950/30 border border-amber-500/40 text-amber-200 text-xs font-data-mono-sm flex flex-col gap-0.5">
                        <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider">
                          Suspect Measurement Reasons:
                        </span>
                        <span className="text-[11px]">
                          {pt.quality_reasons.join(', ')}
                        </span>
                      </div>
                    )}

                    {pt.null_reason && (
                      <div className="px-2 py-1 rounded bg-red-950/30 border border-red-500/40 text-red-300 text-xs font-data-mono-sm">
                        Null Reason: <span className="font-semibold">{pt.null_reason}</span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* TAB 2: MATCH */}
          {activeInspectorTab === 'match' && (
            <div className="p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-surface-container-high/50 pb-2">
                <span className="font-headline-sm text-sm font-bold text-on-surface">
                  Catalogue Cross-Match: {currentSource?.id}
                </span>
                <span className="font-data-mono-sm text-xs text-outline">
                  Radius: 6.15 arcsec
                </span>
              </div>

              {currentSource?.match ? (
                <div className="flex flex-col gap-3 font-data-mono-sm text-xs">
                  <div className="p-3 rounded-lg bg-surface-container-lowest border border-surface-container-high flex flex-col gap-2">
                    <span className="text-outline text-[11px]">MATCHED CATALOGUE IDENTIFIER:</span>
                    <span className="text-base font-bold text-secondary">
                      {currentSource.match.identifier}
                    </span>
                    <span className="text-outline text-xs">
                      Reference Catalogue: {currentSource.match.catalogue}
                    </span>
                  </div>

                  {/* Separation Gauge against 6.15 arcsec beam */}
                  <div className="p-3 rounded-lg bg-surface-container-lowest border border-surface-container-high flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-outline text-[11px]">ANGULAR SEPARATION:</span>
                      <span className="text-on-surface font-bold">
                        {currentSource.match.separation_arcsec.toFixed(2)} arcsec
                      </span>
                    </div>

                    {/* Gauge bar */}
                    <div className="w-full h-2.5 rounded-full bg-surface-container-high overflow-hidden relative">
                      <div
                        className="h-full bg-secondary transition-all"
                        style={{
                          width: `${Math.min(100, (currentSource.match.separation_arcsec / 6.15) * 100)}%`,
                        }}
                      ></div>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-outline">
                      <span>0.0"</span>
                      <span>Match Limit: 6.15" (1 SPHEREx pixel)</span>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-surface-container-lowest border border-surface-container-high flex items-center justify-between">
                    <span className="text-outline">Candidates inside radius:</span>
                    <span className="font-bold text-on-surface">
                      {currentSource.match.n_candidates_in_radius}
                    </span>
                  </div>

                  {/* ADS Open Button */}
                  {currentSource.match.ads_url && (
                    <a
                      href={currentSource.match.ads_url}
                      target="_blank"
                      rel="noreferrer"
                      className="w-full py-2 px-4 rounded bg-primary-container hover:bg-primary text-on-primary font-body-sm text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <span>Open in NASA ADS</span>
                      <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                    </a>
                  )}
                </div>
              ) : (
                <div className="p-6 rounded-lg bg-surface-container-lowest border border-surface-container-high flex flex-col items-center justify-center text-center gap-2">
                  <span className="material-symbols-outlined text-outline text-[32px]">search_off</span>
                  <span className="font-data-mono-sm text-sm text-on-surface font-semibold">
                    No Gaia match within 6.15 arcsec
                  </span>
                  <p className="font-body-sm text-xs text-outline max-w-xs">
                    This source has no corresponding counterpart in the Gaia DR3 reference catalogue inside the search beam.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SOURCES LIST */}
          {activeInspectorTab === 'sources' && (
            <div className="p-4 flex flex-col gap-3 flex-1 overflow-hidden">
              {/* Search input */}
              <input
                type="text"
                placeholder="Filter 72 sources by ID or Gaia..."
                value={sourceSearch}
                onChange={(e) => setSourceSearch(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded bg-surface-container-lowest text-on-surface border border-surface-container-high outline-none font-data-mono-sm placeholder:text-outline/60"
              />

              {/* Table */}
              <div className="flex-1 overflow-y-auto max-h-[480px] border border-surface-container-high rounded-lg">
                <table className="w-full text-left font-data-mono-sm text-xs border-collapse">
                  <thead className="sticky top-0 bg-surface-container-lowest z-10 border-b border-surface-container-high text-outline text-[11px]">
                    <tr>
                      <th
                        onClick={() => {
                          if (sourceSortCol === 'id') setSourceSortAsc(!sourceSortAsc);
                          else { setSourceSortCol('id'); setSourceSortAsc(true); }
                        }}
                        className="py-2 px-2.5 cursor-pointer hover:text-on-surface"
                      >
                        Source ID
                      </th>
                      <th
                        onClick={() => {
                          if (sourceSortCol === 'peak_snr') setSourceSortAsc(!sourceSortAsc);
                          else { setSourceSortCol('peak_snr'); setSourceSortAsc(false); }
                        }}
                        className="py-2 px-2.5 cursor-pointer hover:text-on-surface"
                      >
                        SNR
                      </th>
                      <th
                        onClick={() => {
                          if (sourceSortCol === 'valid_points') setSourceSortAsc(!sourceSortAsc);
                          else { setSourceSortCol('valid_points'); setSourceSortAsc(false); }
                        }}
                        className="py-2 px-2.5 cursor-pointer hover:text-on-surface"
                      >
                        Valid Pts
                      </th>
                      <th className="py-2 px-2.5">Gaia DR3 Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAndSortedSources.map((s) => {
                      const isSelected = currentSource?.id === s.id;
                      return (
                        <tr
                          key={s.id}
                          onClick={() => centerOnSource(s)}
                          className={`border-b border-surface-container-high/30 transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-primary/20 text-on-surface font-semibold'
                              : 'hover:bg-surface-container-high/40 text-on-surface-variant'
                          }`}
                        >
                          <td className="py-2 px-2.5 text-secondary">{s.id}</td>
                          <td className="py-2 px-2.5 font-bold text-on-surface">
                            {s.peak_snr.toFixed(1)}
                          </td>
                          <td className="py-2 px-2.5">
                            {s.valid_points}/{s.total_points}
                          </td>
                          <td className="py-2 px-2.5 text-[11px] truncate max-w-[120px]">
                            {s.match ? s.match.identifier : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
