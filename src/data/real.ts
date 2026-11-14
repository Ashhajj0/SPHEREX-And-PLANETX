/**
 * src/data/real.ts
 * ================
 * Data access layer for real SPHEREx QR2 observations exported by the Python pipeline.
 *
 * Provides:
 * 1. Runtime shape validation and safe error handling (falls back to synthetic data
 *    without crashing if real data is missing or incomplete).
 * 2. In-memory caching for spectra (4.4 MB) and exposure metadata so fetches happen once.
 * 3. Pure celestial coordinate transformations (pixelToSky and skyToPixel) based on the
 *    manifest's common TAN gnomonic projection grid.
 */

export interface CommonGrid {
  ra_deg: number;
  dec_deg: number;
  pixel_scale_arcsec: number;
  width: number;
  height: number;
  north_up: boolean;
}

export interface EpochPairEndpoint {
  id?: string;
  file?: string;
  time_utc?: string;
  wavelength_um?: number | null;
}

export interface EpochPair {
  detector: number;
  epoch_1: EpochPairEndpoint;
  epoch_2: EpochPairEndpoint;
  separation_days: number;
  wavelength_diff_pct: number;
}

export interface ExportedRegionSummary {
  id: string;
  name: string;
  ra_deg: number;
  dec_deg: number;
  size_arcmin: number;
  target_identifiers?: string | null;
  description?: string | null;
  catalogue?: {
    name?: string;
    rows?: number;
  };
  counts?: {
    exposures?: number;
    sources?: number;
    spectrum_points?: number;
    null_points?: number;
    suspect_points?: number;
    epoch_pairs?: number;
  };
  path: string;
}

export interface ManifestData {
  kind: 'real' | string;
  release: string;
  doi: string;
  collection: string;
  region: {
    id: string;
    name: string;
    ra_deg: number;
    dec_deg: number;
    size_arcmin: number;
    target_identifiers?: string | null;
    description?: string | null;
  };
  generated_utc: string;
  counts: {
    exposures: number;
    sources: number;
    spectrum_points: number;
    null_points: number;
    unplaceable_points: number;
    suspect_points?: number;
    suspect_reasons?: Record<string, number>;
    epoch_pairs?: number;
  };
  units: {
    flux: string;
    wavelength: string;
  };
  solid_angle_kind: string;
  bad_flag_bits?: number[];
  detection: {
    reference_exposure_id: string;
    wavelength_um: number;
    threshold_sigma: number;
  };
  catalogue: {
    name: string;
    rows: number;
  };
  common_grid: CommonGrid;
  epoch_pairs?: EpochPair[];
  notes?: string[];
}

export interface RealExposure {
  index: number;
  id: string; // e.g. "E001"
  file: string;
  detector: number; // 1-6
  time_utc: string;
  wavelength_um: number; // Central wavelength at field centre
  wavelength_min_um?: number | null;
  wavelength_max_um?: number | null;
  bandwidth_um: number;
  image: string; // e.g. "images/E001.png"
  vmin: number;
  vmax: number;
  pct_good_pixels: number;
}

export interface RealSourceMatch {
  catalogue: string;
  identifier: string;
  separation_arcsec: number;
  n_candidates_in_radius: number;
  ads_url: string;
}

export interface RealSource {
  id: string; // e.g. "SPX-NEP-001"
  ra_deg: number;
  dec_deg: number;
  x: number; // Pixels on common grid (0 to width-1)
  y: number; // Pixels on common grid (0 to height-1)
  peak_snr: number;
  valid_points: number;
  total_points: number;
  wavelength_min_um: number | null;
  wavelength_max_um: number | null;
  match: RealSourceMatch | null;
}

export interface RealSpectrumPoint {
  exposure_id: string;
  exposure_file?: string;
  wavelength_um: number | null;
  bandwidth_um: number | null;
  flux_uJy: number | null;
  flux_err_uJy: number | null;
  n_good_pixels: number;
  detector: number;
  time_utc: string;
  null_reason: string | null;
  solid_angle_kind?: string | null;
  n_background_pixels?: number;
  n_aperture_pixels?: number;
  n_flagged_in_aperture?: number;
  edge_distance_pix?: number | null;
  peak_pixel_flagged?: boolean;
  quality?: 'ok' | 'suspect' | string;
  quality_reasons?: string[];
}

export interface RealDataset {
  basePath: string; // '/real' or '/real/regions/<region_id>'
  manifest: ManifestData;
  exposures: RealExposure[];
  sources: RealSource[];
  spectra: Record<string, RealSpectrumPoint[]>;
}

export interface RealLoadResult {
  success: boolean;
  data: RealDataset | null;
  missingFiles: string[];
  missingKeys: string[];
  errorMessage?: string;
}

// In-memory cache per region key to prevent re-fetching spectra.json
const _cachedDatasets = new Map<string, RealDataset>();

/**
 * Fetches the multi-region export index (/real/regions.json) if available.
 */
export async function loadAvailableRegions(): Promise<ExportedRegionSummary[]> {
  try {
    const res = await fetch('/real/regions.json');
    if (!res.ok) return [];
    const payload = await res.json();
    if (Array.isArray(payload?.regions)) {
      return payload.regions;
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Loads real SPHEREx QR2 dataset from /real/ (or /real/regions/<regionId>/ when specified).
 * If any file or essential key is missing, logs a warning and returns
 * failure info without throwing exceptions, enabling graceful fallback.
 */
export async function loadRealData(regionId?: string): Promise<RealLoadResult> {
  const cacheKey = regionId || '__default__';
  const cached = _cachedDatasets.get(cacheKey);
  if (cached) {
    return {
      success: true,
      data: cached,
      missingFiles: [],
      missingKeys: [],
    };
  }

  const basePath = regionId ? `/real/regions/${regionId}` : '/real';
  const missingFiles: string[] = [];
  const missingKeys: string[] = [];

  try {
    // 1. Fetch manifest.json
    const manifestRes = await fetch(`${basePath}/manifest.json`);
    if (!manifestRes.ok) {
      if (regionId) {
        const defaultCached = _cachedDatasets.get('__default__');
        if (defaultCached && defaultCached.manifest?.region?.id === regionId) {
          _cachedDatasets.set(cacheKey, defaultCached);
          return {
            success: true,
            data: defaultCached,
            missingFiles: [],
            missingKeys: [],
          };
        }
        const defaultRes = await loadRealData();
        if (defaultRes.success && defaultRes.data?.manifest?.region?.id === regionId) {
          _cachedDatasets.set(cacheKey, defaultRes.data);
          return {
            success: true,
            data: defaultRes.data,
            missingFiles: [],
            missingKeys: [],
          };
        }
      }
      missingFiles.push(`${basePath}/manifest.json`);
      console.warn(`[RealData] ${basePath}/manifest.json not found (HTTP ${manifestRes.status})`);
      return {
        success: false,
        data: null,
        missingFiles,
        missingKeys,
        errorMessage: 'Real SPHEREx manifest.json is not present.',
      };
    }
    const manifest: ManifestData = await manifestRes.json();
    if (!manifest.common_grid) missingKeys.push('manifest.common_grid');
    if (!manifest.region) missingKeys.push('manifest.region');
    if (!manifest.counts) missingKeys.push('manifest.counts');

    // 2. Fetch exposures.json
    const exposuresRes = await fetch(`${basePath}/exposures.json`);
    if (!exposuresRes.ok) {
      missingFiles.push(`${basePath}/exposures.json`);
    }
    const exposuresRaw = exposuresRes.ok ? await exposuresRes.json() : null;
    const exposures: RealExposure[] = Array.isArray(exposuresRaw)
      ? exposuresRaw
      : Array.isArray(exposuresRaw?.exposures)
      ? exposuresRaw.exposures
      : [];
    if (!exposures.length) missingKeys.push('exposures (empty or invalid)');

    // 3. Fetch sources.json (accepts either array or {"sources": [...]})
    const sourcesRes = await fetch(`${basePath}/sources.json`);
    if (!sourcesRes.ok) {
      missingFiles.push(`${basePath}/sources.json`);
    }
    const sourcesRaw = sourcesRes.ok ? await sourcesRes.json() : null;
    const sources: RealSource[] = Array.isArray(sourcesRaw)
      ? sourcesRaw
      : Array.isArray(sourcesRaw?.sources)
      ? sourcesRaw.sources
      : [];
    if (!sources.length) missingKeys.push('sources (empty or invalid)');

    // 4. Fetch spectra.json (object keyed by source ID)
    const spectraRes = await fetch(`${basePath}/spectra.json`);
    if (!spectraRes.ok) {
      missingFiles.push(`${basePath}/spectra.json`);
    }
    const spectra: Record<string, RealSpectrumPoint[]> = spectraRes.ok ? await spectraRes.json() : {};
    if (!spectra || typeof spectra !== 'object' || Object.keys(spectra).length === 0) {
      missingKeys.push('spectra (empty or invalid)');
    }

    if (missingFiles.length > 0 || missingKeys.length > 0) {
      const msg = `Missing files: [${missingFiles.join(', ')}], missing keys: [${missingKeys.join(', ')}]`;
      console.warn('[RealData] Incomplete real dataset:', msg);
      return {
        success: false,
        data: null,
        missingFiles,
        missingKeys,
        errorMessage: msg,
      };
    }

    const dataset: RealDataset = {
      basePath,
      manifest,
      exposures,
      sources,
      spectra,
    };

    _cachedDatasets.set(cacheKey, dataset);
    return {
      success: true,
      data: dataset,
      missingFiles: [],
      missingKeys: [],
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn('[RealData] Exception while loading real SPHEREx data:', errorMsg);
    return {
      success: false,
      data: null,
      missingFiles,
      missingKeys,
      errorMessage: errorMsg,
    };
  }
}

/**
 * Standard gnomonic (TAN) projection: converts sky coordinates (RA, Dec in degrees)
 * into detector pixel coordinates (x, y) on the common grid.
 *
 * North is up (+Dec -> +y in celestial WCS), East is left (+RA -> -x).
 */
export function skyToPixel(ra: number, dec: number, grid: CommonGrid): { x: number; y: number } {
  const ra0Rad = (grid.ra_deg * Math.PI) / 180.0;
  const dec0Rad = (grid.dec_deg * Math.PI) / 180.0;
  const raRad = (ra * Math.PI) / 180.0;
  const decRad = (dec * Math.PI) / 180.0;

  const scaleRad = ((grid.pixel_scale_arcsec / 3600.0) * Math.PI) / 180.0;
  const x0 = (grid.width - 1) / 2.0;
  const y0 = (grid.height - 1) / 2.0;

  const deltaRa = raRad - ra0Rad;
  const cosC = Math.sin(dec0Rad) * Math.sin(decRad) + Math.cos(dec0Rad) * Math.cos(decRad) * Math.cos(deltaRa);

  if (cosC <= 0) {
    return { x: x0, y: y0 };
  }

  // Standard TAN coordinates: xi (East-ward in radians), eta (North-ward in radians)
  const xi = (Math.cos(decRad) * Math.sin(deltaRa)) / cosC;
  const eta = (Math.cos(dec0Rad) * Math.sin(decRad) - Math.sin(dec0Rad) * Math.cos(decRad) * Math.cos(deltaRa)) / cosC;

  // East is Left (-xi), North is Up (+eta in celestial WCS)
  const x = x0 - xi / scaleRad;
  const y = y0 + eta / scaleRad;

  return { x, y };
}

/**
 * Converts detector pixel coordinates (x, y) back into celestial coordinates (RA, Dec in degrees)
 * using the inverse gnomonic (TAN) projection.
 */
export function pixelToSky(x: number, y: number, grid: CommonGrid): { ra_deg: number; dec_deg: number } {
  const scaleRad = ((grid.pixel_scale_arcsec / 3600.0) * Math.PI) / 180.0;
  const x0 = (grid.width - 1) / 2.0;
  const y0 = (grid.height - 1) / 2.0;

  const dx = x - x0;
  const dy = y - y0;

  // Invert the forward pixel transformation
  const xi = -dx * scaleRad;
  const eta = dy * scaleRad;

  const rho = Math.hypot(xi, eta);
  if (rho < 1e-12) {
    return { ra_deg: grid.ra_deg, dec_deg: grid.dec_deg };
  }

  const c = Math.atan(rho);
  const dec0Rad = (grid.dec_deg * Math.PI) / 180.0;
  const ra0Rad = (grid.ra_deg * Math.PI) / 180.0;

  const sinC = Math.sin(c);
  const cosC = Math.cos(c);
  const sinDec0 = Math.sin(dec0Rad);
  const cosDec0 = Math.cos(dec0Rad);

  const decRad = Math.asin(cosC * sinDec0 + (eta * sinC * cosDec0) / rho);
  const raRad = ra0Rad + Math.atan2(xi * sinC, rho * cosDec0 * cosC - eta * sinDec0 * sinC);

  let raDeg = (raRad * 180.0) / Math.PI;
  raDeg = ((raDeg % 360.0) + 360.0) % 360.0;
  const decDeg = (decRad * 180.0) / Math.PI;

  return { ra_deg: raDeg, dec_deg: decDeg };
}
