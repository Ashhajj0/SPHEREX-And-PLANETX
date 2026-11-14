#!/usr/bin/env python3
"""
backend/compute/export_region.py
================================
Exports real SPHEREx QR2 scientific results to JSON and aligned display PNGs
for the web explorer interface.

Usage:
  python -m backend.compute.export_region north-ecliptic-pole

Outputs written to web/public/real/ (and mirrored to public/real/):
1. manifest.json: Metadata, dataset counts, units, detection parameters, common WCS grid.
2. exposures.json: Array of exposures sorted by wavelength with stretch limits.
3. images/E###.png: Grayscale 8-bit asinh-stretched PNGs on a common North-up grid.
4. sources.json: Detected sources with coordinates, SNR, and Gaia DR3 crossmatches.
5. spectra.json: Complete 120-exposure spectra sorted by wavelength with preserved nulls.

Strict Rules:
- Reuses existing backend/compute/ algorithms without duplicate implementation.
- All JSON is strictly validated with allow_nan=False; NaNs and Infinities become null.
- Reprojection onto the common North-Up grid is strictly for DISPLAY ONLY.
  All scientific aperture photometry uses the authentic, un-resampled original pixels.
- Halts with an error if cache/spherex/ is empty. Never uses synthetic fixtures.
"""

import sys
import json
import math
import zlib
import struct
import argparse
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, List, Tuple, Any

# Root paths
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
CACHE_SPHEREX = REPO_ROOT / "cache" / "spherex"
CACHE_CATALOGUE = REPO_ROOT / "cache" / "catalogue"
REGIONS_CONFIG = REPO_ROOT / "pipeline" / "regions.yaml"

# Target web export folders
WEB_EXPORT_DIR = REPO_ROOT / "web" / "public" / "real"
ROOT_EXPORT_DIR = REPO_ROOT / "public" / "real"

# Scientific compute modules
from backend.compute.exposure import Exposure, load_region_exposures
from backend.compute.detect import pick_reference_exposure, detect_sources, is_bad_pixel
from backend.compute.common import BAD_FLAG_BITS
from backend.compute.photometry import get_pixel_solid_angle_sr, sanitize_scalar
from backend.compute.spectrum import build_spectrum, Spectrum, sort_spectrum_points
from backend.compute.crossmatch import crossmatch_sources, CrossmatchResult
from backend.compute.diagnose_dips import run_diagnostics

try:
    import numpy as np
except ImportError:
    np = None

try:
    from astropy.wcs import WCS
    from astropy.coordinates import SkyCoord
except ImportError:
    WCS = None
    SkyCoord = None

try:
    from reproject import reproject_interp
except ImportError:
    reproject_interp = None

try:
    from PIL import Image
except ImportError:
    Image = None


# ---------------------------------------------------------------------------
# JSON Sanitizer (Converts NaN / Inf to None)
# ---------------------------------------------------------------------------
def sanitize_json(obj: Any) -> Any:
    """Recursively converts NaN, Infinity, and numpy scalars to valid JSON types."""
    if obj is None:
        return None
    elif isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return round(obj, 6)
    elif isinstance(obj, (int, str, bool)):
        return obj
    elif isinstance(obj, dict):
        return {k: sanitize_json(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [sanitize_json(item) for item in obj]
    elif hasattr(obj, "item"):  # numpy scalar
        return sanitize_json(obj.item())
    return obj


# ---------------------------------------------------------------------------
# Pure-Python Standalone RGBA PNG Writer
# ---------------------------------------------------------------------------
def save_rgba_png(file_path: Path, rgba_bytes: bytes, width: int, height: int):
    """
    Saves an 8-bit RGBA image to a standard PNG file.
    Uses Pillow if available; otherwise uses a built-in zlib writer.
    """
    file_path.parent.mkdir(parents=True, exist_ok=True)
    if Image is not None and np is not None:
        arr = np.frombuffer(rgba_bytes, dtype=np.uint8).reshape((height, width, 4))
        img = Image.fromarray(arr, mode="RGBA")
        img.save(file_path, "PNG", optimize=True)
        return

    # Lightweight pure-Python PNG writer (zero dependencies)
    png = bytearray(b"\x89PNG\r\n\x1a\n")

    def make_chunk(chunk_type: bytes, data: bytes) -> bytes:
        length = struct.pack(">I", len(data))
        crc = struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
        return length + chunk_type + data + crc

    # IHDR chunk: width, height, 8-bit depth, color type 6 (RGBA), default compression/filter
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png += make_chunk(b"IHDR", ihdr_data)

    # IDAT chunk: filter byte 0 prefixing each scanline
    raw_lines = bytearray()
    row_bytes = width * 4
    for y in range(height):
        raw_lines.append(0)  # Filter 0 (None)
        raw_lines.extend(rgba_bytes[y * row_bytes : (y + 1) * row_bytes])

    compressed = zlib.compress(bytes(raw_lines), level=6)
    png += make_chunk(b"IDAT", compressed)
    png += make_chunk(b"IEND", b"")

    with open(file_path, "wb") as f:
        f.write(png)


# ---------------------------------------------------------------------------
# Common North-Up TAN Grid Generator
# ---------------------------------------------------------------------------
def make_common_wcs(ra_deg: float, dec_deg: float, pixel_scale_arcsec: float = 6.15, size_pix: int = 146):
    """
    Creates a standard North-Up, East-Left gnomonic TAN WCS centered on the sky region.
    All display images are aligned to this common pixel grid.
    """
    if WCS is None:
        return None
    w = WCS(naxis=2)
    w.wcs.crpix = [size_pix / 2.0 + 0.5, size_pix / 2.0 + 0.5]
    scale_deg = pixel_scale_arcsec / 3600.0
    w.wcs.cdelt = [-scale_deg, scale_deg]  # -scale for RA (East left), +scale for Dec (North up)
    w.wcs.crval = [ra_deg, dec_deg]
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    return w


# ---------------------------------------------------------------------------
# Display Image Generator with Asinh Stretch
# ---------------------------------------------------------------------------
def render_display_png(
    exp: Exposure,
    common_wcs: Any,
    out_path: Path,
    width: int = 146,
    height: int = 146
) -> Tuple[float, float, float]:
    """
    Reprojects an exposure cutout onto the common North-up grid and exports an
    8-bit grayscale RGBA PNG with asinh non-linear tone curve.
    
    DISPLAY ONLY: Reprojected pixels are used exclusively for visualization.
    Photometry is always computed on the original un-resampled science data.
    
    Returns: (vmin, vmax, pct_good_pixels)
    """
    img = exp.image
    flags = exp.flags
    bad_mask = is_bad_pixel(flags)

    # Calculate overall good pixel percentage on original cutout
    pct_good = round(float(np.mean(~bad_mask) * 100.0), 2) if np is not None else 100.0

    # Reproject science image and bad pixel mask onto the common grid
    if reproject_interp is not None and common_wcs is not None and exp.wcs is not None:
        reprojected_flux, footprint = reproject_interp(
            (img, exp.wcs),
            common_wcs,
            shape_out=(height, width)
        )
        reprojected_bad, _ = reproject_interp(
            (bad_mask.astype(np.float32), exp.wcs),
            common_wcs,
            shape_out=(height, width),
            order="nearest-neighbor"
        )
        valid_mask = (footprint > 0) & (~np.isnan(reprojected_flux)) & (reprojected_bad < 0.5)
        display_data = reprojected_flux
    else:
        # Fallback if reproject is not installed
        display_data = img[:height, :width] if (img.shape[0] >= height and img.shape[1] >= width) else img
        valid_mask = ~bad_mask[:height, :width] if (bad_mask.shape[0] >= height and bad_mask.shape[1] >= width) else ~bad_mask

    # Asinh tone curve stretch using 1st to 99.5th percentile
    valid_vals = display_data[valid_mask]
    if len(valid_vals) > 10:
        p1 = float(np.percentile(valid_vals, 1.0))
        p995 = float(np.percentile(valid_vals, 99.5))
    else:
        p1, p995 = 0.0, 1.0

    if p995 <= p1:
        p995 = p1 + 1e-4

    # Sanitize display_data of NaNs / Infs for tone-curve normalization
    display_clean = np.nan_to_num(display_data, nan=p1, posinf=p995, neginf=p1)
    norm_val = np.clip((display_clean - p1) / (p995 - p1), 0.0, 1.0)

    # Asinh non-linear stretch (Q = 8.0)
    # asinh(Q * x) / asinh(Q) enhances faint structures while preserving bright stars
    q_factor = 8.0
    denom = math.asinh(q_factor)
    stretched = np.arcsinh(q_factor * norm_val) / denom

    # Clean any possible NaN/inf in stretched data and clip to [0.0, 1.0] before casting
    stretched_clean = np.nan_to_num(stretched, nan=0.0, posinf=1.0, neginf=0.0)
    stretched_clean = np.clip(stretched_clean, 0.0, 1.0)

    # Clean alpha mask to ensure valid [0, 255] range
    alpha_clean = np.nan_to_num(valid_mask.astype(np.float32) * 255.0, nan=0.0, posinf=255.0, neginf=0.0)
    alpha_clean = np.clip(alpha_clean, 0.0, 255.0)

    # Build 8-bit RGBA buffer (pure transparent alpha=0 where invalid; grayscale where valid)
    gray_bytes = (stretched_clean * 255.0).astype(np.uint8)
    alpha_bytes = alpha_clean.astype(np.uint8)

    rgba_stack = np.dstack([gray_bytes, gray_bytes, gray_bytes, alpha_bytes])
    raw_rgba = rgba_stack.tobytes()

    save_rgba_png(out_path, raw_rgba, width, height)

    return round(p1, 5), round(p995, 5), pct_good


# ---------------------------------------------------------------------------
# Region Config Loader & Epoch Pair Finder
# ---------------------------------------------------------------------------
def load_regions_config() -> List[Dict[str, Any]]:
    """Loads all region definitions from pipeline/regions.yaml (with pure-Python fallback)."""
    if not REGIONS_CONFIG.exists():
        return []

    try:
        import yaml
        with open(REGIONS_CONFIG, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f)
            return list(cfg.get("regions", []))
    except Exception:
        regions: List[Dict[str, Any]] = []
        current_reg: Optional[Dict[str, Any]] = None
        with open(REGIONS_CONFIG, "r", encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if s.startswith("- id:"):
                    current_reg = {"id": s.split(":", 1)[1].strip().strip('"\'')}
                    regions.append(current_reg)
                elif current_reg is not None and ":" in s and not s.startswith("#"):
                    k, v = s.split(":", 1)
                    k, v = k.strip(), v.strip().strip('"\'')
                    try:
                        current_reg[k] = float(v) if "." in v else int(v)
                    except ValueError:
                        current_reg[k] = v
        return regions


def get_region_metadata(region_id: str) -> Dict[str, Any]:
    """Reads region coordinates and metadata from pipeline/regions.yaml."""
    for r in load_regions_config():
        if r.get("id") == region_id:
            return r

    return {
        "id": region_id,
        "name": region_id.replace("-", " ").title(),
        "ra_deg": 270.3317 if "north" in region_id else (90.0 if "south" in region_id else 150.1192),
        "dec_deg": 66.5614 if "north" in region_id else (-66.5614 if "south" in region_id else 2.2058),
        "size_arcmin": 15.0
    }


def compute_epoch_pairs_from_exposures(exposures_export: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Finds exposure pairs on the same detector with central wavelength within 2%
    and observation separation >= 14.0 days.
    """
    def parse_iso(ts: str) -> Optional[datetime]:
        if not ts:
            return None
        clean = str(ts).strip().split("+")[0].rstrip("Z")
        for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime(clean, fmt)
            except ValueError:
                continue
        return None

    pairs: List[Dict[str, Any]] = []
    n = len(exposures_export)
    for i in range(n):
        e1 = exposures_export[i]
        d1 = parse_iso(e1.get("time_utc", ""))
        w1 = e1.get("wavelength_um")
        det1 = e1.get("detector")
        if d1 is None or det1 is None:
            continue

        for j in range(i + 1, n):
            e2 = exposures_export[j]
            d2 = parse_iso(e2.get("time_utc", ""))
            w2 = e2.get("wavelength_um")
            det2 = e2.get("detector")
            if d2 is None or det2 is None or det1 != det2:
                continue

            delta_days = abs((d2 - d1).total_seconds()) / 86400.0
            if delta_days < 14.0:
                continue

            if w1 and w2 and w1 > 0:
                diff_pct = abs(w1 - w2) / w1 * 100.0
                if diff_pct > 2.0:
                    continue
            else:
                diff_pct = 0.0

            first, second = (e1, e2) if d1 <= d2 else (e2, e1)
            pairs.append({
                "detector": det1,
                "epoch_1": {
                    "id": first.get("id"),
                    "file": first.get("file"),
                    "time_utc": first.get("time_utc"),
                    "wavelength_um": first.get("wavelength_um"),
                },
                "epoch_2": {
                    "id": second.get("id"),
                    "file": second.get("file"),
                    "time_utc": second.get("time_utc"),
                    "wavelength_um": second.get("wavelength_um"),
                },
                "separation_days": round(delta_days, 1),
                "wavelength_diff_pct": round(diff_pct, 2),
            })

    return pairs


def update_regions_index() -> None:
    """Scans web/public/real/regions/*/manifest.json and writes web/public/real/regions.json."""
    regions_dir = WEB_EXPORT_DIR / "regions"
    index_items: List[Dict[str, Any]] = []
    if regions_dir.exists():
        # Order according to pipeline/regions.yaml first, then any extra exported directories
        configured_order = [r.get("id") for r in load_regions_config() if r.get("id")]
        found_dirs = {d.name: d for d in regions_dir.iterdir() if d.is_dir() and (d / "manifest.json").exists()}
        ordered_ids = [rid for rid in configured_order if rid in found_dirs] + sorted(
            rid for rid in found_dirs if rid not in configured_order
        )
        for rid in ordered_ids:
            try:
                with open(found_dirs[rid] / "manifest.json", "r", encoding="utf-8") as mf:
                    m = json.load(mf)
                index_items.append({
                    "id": m.get("region", {}).get("id", rid),
                    "name": m.get("region", {}).get("name", rid),
                    "ra_deg": m.get("region", {}).get("ra_deg"),
                    "dec_deg": m.get("region", {}).get("dec_deg"),
                    "size_arcmin": m.get("region", {}).get("size_arcmin"),
                    "target_identifiers": m.get("region", {}).get("target_identifiers"),
                    "description": m.get("region", {}).get("description"),
                    "catalogue": m.get("catalogue", {}),
                    "counts": m.get("counts", {}),
                    "path": f"regions/{rid}",
                })
            except Exception:
                continue

    clean_index = sanitize_json({"regions": index_items, "generated_utc": datetime.now(timezone.utc).isoformat()})
    WEB_EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    with open(WEB_EXPORT_DIR / "regions.json", "w", encoding="utf-8") as f:
        json.dump(clean_index, f, indent=2, allow_nan=False)
    if ROOT_EXPORT_DIR.parent.exists():
        ROOT_EXPORT_DIR.mkdir(parents=True, exist_ok=True)
        with open(ROOT_EXPORT_DIR / "regions.json", "w", encoding="utf-8") as f:
            json.dump(clean_index, f, indent=2, allow_nan=False)


# ---------------------------------------------------------------------------
# Main Export Routine
# ---------------------------------------------------------------------------
def export_region_data(region_id: str = "north-ecliptic-pole", write_root: bool = True):
    """
    Loads all real exposures, detects sources, measures spectra, aligns images,
    and exports clean JSON files and PNGs to:
      - web/public/real/regions/<region_id>/ (always)
      - web/public/real/ (when write_root=True, for backwards compatibility)
    Also mirrors to public/real/.
    """
    region_export_web = WEB_EXPORT_DIR / "regions" / region_id
    region_export_root = ROOT_EXPORT_DIR / "regions" / region_id

    print("=================================================================")
    print(" SPHEREx Scientific Results Exporter")
    print(f" Target Region: {region_id}")
    print(f" Target Folder: {region_export_web.relative_to(REPO_ROOT)}")
    print("=================================================================\n")

    region_spherex_dir = CACHE_SPHEREX / region_id
    region_cat_dir = CACHE_CATALOGUE / region_id

    # Enforce strict real cache rule
    if not region_spherex_dir.exists() or not any(region_spherex_dir.glob("*.fits")):
        print(f"[FATAL ERROR] Cache directory does not exist or has no real FITS cutouts:")
        print(f"  {region_spherex_dir}")
        print("Per project rules: Nothing from demo_fixtures/ may be used.")
        print("Please run 'python pipeline/fetch_spherex.py' first.")
        sys.exit(1)

    target_dirs = [region_export_web]
    if ROOT_EXPORT_DIR.parent.exists():
        target_dirs.append(region_export_root)
    if write_root:
        target_dirs.append(WEB_EXPORT_DIR)
        if ROOT_EXPORT_DIR.parent.exists():
            target_dirs.append(ROOT_EXPORT_DIR)

    for d in target_dirs:
        d.mkdir(parents=True, exist_ok=True)
        (d / "images").mkdir(parents=True, exist_ok=True)
        with open(d / "README.txt", "w", encoding="utf-8") as f:
            f.write("Generated from real SPHEREx QR2 files by export_region.py. Do not edit by hand.\n")

    # 1. Load real cutouts into memory
    print(f"[1/6] Loading real SPHEREx cutouts from cache/spherex/{region_id}...")
    exposures = load_region_exposures(region_spherex_dir)
    print(f"      Loaded {len(exposures)} calibrated exposures.")

    # 2. Pick reference exposure and detect sources
    print(f"[2/6] Selecting reference exposure and detecting celestial sources...")
    ref_exp = pick_reference_exposure(exposures)
    ref_wave, _ = ref_exp.get_pixel_wavelength_and_bandwidth(ref_exp.shape[1] / 2.0, ref_exp.shape[0] / 2.0)
    ref_wave_val = round(ref_wave, 3) if ref_wave else 2.42

    sources, det_meta = detect_sources(ref_exp, threshold_sigma=5.0, region_id=region_id)
    print(f"      Detected {len(sources)} sources at 5-sigma threshold on reference exposure {ref_exp.file_name}.")

    # 3. Crossmatch with Gaia DR3 or AllWISE reference catalogue
    print(f"[3/6] Cross-matching against reference star catalogue...")
    cat_files = list(region_cat_dir.glob("*.csv")) if region_cat_dir.exists() else []
    cat_files = [f for f in cat_files if not f.name.startswith("fixture_")]

    region_info = get_region_metadata(region_id)
    default_cat_label = "AllWISE" if str(region_info.get("catalogue", "")).lower() == "allwise" else "Gaia DR3"
    crossmatch_map: Dict[str, CrossmatchResult] = {}
    cat_row_count = 0
    cat_name = default_cat_label

    if cat_files:
        cat_file = cat_files[0]
        if "allwise" in cat_file.name.lower():
            cat_name = "AllWISE"
        elif "gaia" in cat_file.name.lower():
            cat_name = "Gaia DR3"

        with open(cat_file, "r", encoding="utf-8") as cf:
            cat_row_count = sum(1 for line in cf if line.strip() and not line.startswith("#")) - 1

        xm_list = crossmatch_sources(sources, cat_file, obs_time_iso=ref_exp.time, max_radius_arcsec=6.15)
        for xm in xm_list:
            crossmatch_map[xm.source_id] = xm
            if xm.catalogue_name:
                cat_name = xm.catalogue_name
        print(f"      Crossmatched {len(sources)} sources against {cat_file.name} ({cat_row_count} {cat_name} rows).")
    else:
        print("      [Notice] No cached catalogue CSV found. Proceeding with null catalogue matches.")

    # 4. Create Common North-Up TAN WCS Grid (15.0' -> 146x146 px at 6.15"/px; larger cutouts scale cleanly)
    grid_ra = float(region_info.get("ra_deg", 270.3317))
    grid_dec = float(region_info.get("dec_deg", 66.5614))
    size_arcmin = float(region_info.get("size_arcmin", 15.0))
    grid_w = max(146, int(round((size_arcmin * 60.0) / 6.15)))
    grid_h = grid_w
    common_wcs = make_common_wcs(grid_ra, grid_dec, pixel_scale_arcsec=6.15, size_pix=grid_w)

    # 5. Measure central wavelength and sort exposures
    print(f"[4/6] Measuring wavelength bounds and reprojecting display images onto common North-Up grid...")
    temp_exp_meta = []
    for exp in exposures:
        h, w = exp.shape
        w_center, b_center = exp.get_pixel_wavelength_and_bandwidth(w / 2.0, h / 2.0)

        # Sample corners and edge midpoints to find minimum and maximum wavelength across the cutout
        sample_pts = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w / 2.0, h / 2.0)]
        waves = []
        for sx, sy in sample_pts:
            w_val, _ = exp.get_pixel_wavelength_and_bandwidth(sx, sy)
            if w_val is not None:
                waves.append(w_val)

        w_min = min(waves) if waves else w_center
        w_max = max(waves) if waves else w_center

        temp_exp_meta.append({
            "exposure": exp,
            "w_center": w_center if w_center is not None else 0.0,
            "w_min": w_min,
            "w_max": w_max,
            "bandwidth": b_center if b_center is not None else 0.0
        })

    # Sort exposures by central wavelength ascending
    temp_exp_meta.sort(key=lambda item: item["w_center"])

    # Build exposure list with E001, E002, ... IDs
    exposures_export: List[Dict[str, Any]] = []
    exp_id_by_filename: Dict[str, str] = {}
    ref_exp_id = "E001"

    for idx, item in enumerate(temp_exp_meta):
        exp_id = f"E{idx+1:03d}"
        exp = item["exposure"]
        exp_id_by_filename[exp.file_name] = exp_id
        if exp.file_name == ref_exp.file_name:
            ref_exp_id = exp_id

        # Render display image on common North-Up grid (write once, copy bytes to extra mirror folders)
        png_name = f"{exp_id}.png"
        primary_png = region_export_web / "images" / png_name
        vmin, vmax, pct_good = render_display_png(exp, common_wcs, primary_png, width=grid_w, height=grid_h)
        png_bytes = primary_png.read_bytes()
        for extra_dir in target_dirs[1:]:
            (extra_dir / "images" / png_name).write_bytes(png_bytes)

        exposures_export.append({
            "index": idx,
            "id": exp_id,
            "file": exp.file_name,
            "detector": exp.detector,
            "time_utc": exp.time,
            "wavelength_um": round(item["w_center"], 4),
            "wavelength_min_um": round(item["w_min"], 4) if item["w_min"] else None,
            "wavelength_max_um": round(item["w_max"], 4) if item["w_max"] else None,
            "bandwidth_um": round(item["bandwidth"], 4),
            "image": f"images/{png_name}",
            "vmin": vmin,
            "vmax": vmax,
            "pct_good_pixels": pct_good
        })

    print(f"      Rendered {len(exposures_export)} North-up aligned display PNGs.")

    # 6. Extract spectra for all sources
    print(f"[5/6] Extracting spectrophotometry and building sorted spectra for {len(sources)} sources...")
    spectra_export: Dict[str, List[Dict[str, Any]]] = {}
    sources_export: List[Dict[str, Any]] = []

    total_spectrum_pts = 0
    total_null_pts = 0
    total_unplaceable_pts = 0
    total_suspect_pts = 0
    null_counts_by_reason: Dict[str, int] = {}
    suspect_counts_by_reason: Dict[str, int] = {}
    solid_angle_kind_used = "nominal solid angle"

    # Pre-calculate solid angle kind from reference exposure
    _, sa_kind = get_pixel_solid_angle_sr(ref_exp, grid_w / 2.0, grid_h / 2.0)
    solid_angle_kind_used = sa_kind

    for src in sources:
        spectrum: Spectrum = build_spectrum(src, exposures)
        summ = spectrum.summary

        total_spectrum_pts += summ["total_exposures"]
        total_null_pts += summ["null_points"]
        total_unplaceable_pts += summ.get("unplaceable_points", 0)

        # Map spectral points to export schema using to_dict()
        pts_list: List[Dict[str, Any]] = []
        for pt in spectrum.points:
            e_id = exp_id_by_filename.get(pt.exposure_file, "E001")
            if pt.null_reason:
                null_counts_by_reason[pt.null_reason] = null_counts_by_reason.get(pt.null_reason, 0) + 1
            if pt.quality == "suspect":
                total_suspect_pts += 1
                for r in pt.quality_reasons:
                    suspect_counts_by_reason[r] = suspect_counts_by_reason.get(r, 0) + 1

            pts_list.append(pt.to_dict(exposure_id=e_id))

        # Guarantee sorting by wavelength ascending with nulls last
        pts_list = sort_spectrum_points(pts_list)
        spectra_export[src.id] = pts_list

        # Calculate pixel position on the common North-Up grid
        if common_wcs is not None and SkyCoord is not None:
            c = SkyCoord(ra=src.ra_deg, dec=src.dec_deg, unit="deg", frame="icrs")
            gx, gy = common_wcs.world_to_pixel(c)
            x_common = round(float(gx), 2)
            y_common = round(float(gy), 2)
        else:
            x_common = round(src.x_pix, 2)
            y_common = round(src.y_pix, 2)

        # Match block
        xm = crossmatch_map.get(src.id)
        if xm and xm.gaia_id:
            match_data = {
                "catalogue": xm.catalogue_name or cat_name,
                "identifier": xm.gaia_id,
                "separation_arcsec": round(xm.separation_arcsec, 2),
                "n_candidates_in_radius": xm.candidates_in_radius,
                "ads_url": xm.ads_url
            }
        else:
            match_data = None

        src_dict = src.to_dict()
        src_dict["x"] = x_common
        src_dict["y"] = y_common
        src_dict["valid_points"] = summ["valid_points"]
        src_dict["total_points"] = summ["total_exposures"]
        src_dict["wavelength_min_um"] = sanitize_scalar(summ["wavelength_min_um"], 4)
        src_dict["wavelength_max_um"] = sanitize_scalar(summ["wavelength_max_um"], 4)
        src_dict["match"] = match_data
        sources_export.append(src_dict)

    # Print summary of nulls and suspects at the end of step 5
    print("\n      --- Photometry Data Quality Summary ---")
    if null_counts_by_reason:
        for reason, count in sorted(null_counts_by_reason.items(), key=lambda item: -item[1]):
            pct = (count / total_spectrum_pts * 100.0) if total_spectrum_pts > 0 else 0.0
            print(f"      * Null: {reason:<22}: {count:>6,} ({pct:>5.2f}%)")
    else:
        print("      * No null points encountered.")
    print(f"      Total spectrum points     : {total_spectrum_pts:,}")
    print(f"      Total null points         : {total_null_pts:,} ({(total_null_pts / total_spectrum_pts * 100.0) if total_spectrum_pts > 0 else 0.0:.2f}%)")
    print(f"      Total suspect points      : {total_suspect_pts:,} ({(total_suspect_pts / total_spectrum_pts * 100.0) if total_spectrum_pts > 0 else 0.0:.2f}%)")
    if suspect_counts_by_reason:
        for reason, count in sorted(suspect_counts_by_reason.items(), key=lambda item: -item[1]):
            print(f"        - Reason: {reason:<20}: {count:>6,}")
    print(f"      Unplaceable points        : {total_unplaceable_pts:,} ({(total_unplaceable_pts / total_spectrum_pts * 100.0) if total_spectrum_pts > 0 else 0.0:.2f}%)\n")

    # Halt if measurement error rate exceeds 1% of all points
    meas_errors = null_counts_by_reason.get("measurement error", 0)
    meas_error_pct = (meas_errors / total_spectrum_pts * 100.0) if total_spectrum_pts > 0 else 0.0
    if total_spectrum_pts > 0 and (meas_errors / total_spectrum_pts) > 0.01:
        raise RuntimeError(
            f"Halting export: {meas_errors} 'measurement error' nulls ({meas_error_pct:.2f}%) "
            f"exceeds the 1% error tolerance limit across all {total_spectrum_pts:,} points!"
        )

    # Identify real epoch pairs (>= 14 days apart on same detector within 2% wavelength)
    epoch_pairs = compute_epoch_pairs_from_exposures(exposures_export)
    notes_list = ["One exposure gives one spectral point per source"]
    if epoch_pairs:
        notes_list.append(
            f"Found {len(epoch_pairs)} exposure pair(s) >= 14 days apart for multi-epoch inspection"
        )
    else:
        notes_list.append("No epoch pairs in this data: moving-object mode is not available")

    # 7. Build Manifest
    manifest_doc = {
        "kind": "real",
        "release": "QR2",
        "doi": "10.26131/IRSA652",
        "collection": "spherex_qr2",
        "region": {
            "id": region_id,
            "name": region_info.get("name", region_id.replace("-", " ").title()),
            "ra_deg": grid_ra,
            "dec_deg": grid_dec,
            "size_arcmin": size_arcmin,
            "target_identifiers": region_info.get("target_identifiers"),
            "description": region_info.get("description")
        },
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "counts": {
            "exposures": len(exposures_export),
            "sources": len(sources_export),
            "spectrum_points": total_spectrum_pts,
            "null_points": total_null_pts,
            "unplaceable_points": total_unplaceable_pts,
            "suspect_points": total_suspect_pts,
            "suspect_reasons": suspect_counts_by_reason,
            "epoch_pairs": len(epoch_pairs)
        },
        "units": {
            "flux": "uJy",
            "wavelength": "um"
        },
        "solid_angle_kind": solid_angle_kind_used,
        "bad_flag_bits": BAD_FLAG_BITS,
        "detection": {
            "reference_exposure_id": ref_exp_id,
            "wavelength_um": ref_wave_val,
            "threshold_sigma": 5.0
        },
        "catalogue": {
            "name": cat_name,
            "rows": cat_row_count
        },
        "common_grid": {
            "ra_deg": grid_ra,
            "dec_deg": grid_dec,
            "pixel_scale_arcsec": 6.15,
            "width": grid_w,
            "height": grid_h,
            "north_up": True
        },
        "epoch_pairs": epoch_pairs,
        "notes": notes_list
    }

    # 8. Write All JSON Files with allow_nan=False
    print(f"[6/6] Writing sanitized JSON exports...")
    json_targets = [
        ("manifest.json", manifest_doc),
        ("exposures.json", exposures_export),
        ("sources.json", sources_export),
        ("spectra.json", spectra_export)
    ]

    for filename, data in json_targets:
        clean_data = sanitize_json(data)
        serialized = json.dumps(clean_data, indent=2, allow_nan=False)
        for d in target_dirs:
            (d / filename).write_text(serialized, encoding="utf-8")

        dest_file = region_export_web / filename
        print(f"      -> {filename} ({dest_file.stat().st_size:,} bytes)")

    update_regions_index()

    print("\n-----------------------------------------------------------------")
    print(f"[SUCCESS] Export complete for region '{region_id}'!")
    print(f"  Exposures exported: {len(exposures_export)}")
    print(f"  Sources exported: {len(sources_export)}")
    print(f"  Total spectrum points: {total_spectrum_pts:,} ({total_null_pts:,} null points)")
    print(f"  Epoch pairs (>= 14 days): {len(epoch_pairs)}")
    print(f"  Location: {region_export_web.relative_to(REPO_ROOT)}/")
    print("-----------------------------------------------------------------")

    # Run Spectral Dip Diagnostics on the top brightest sources
    run_diagnostics(sources=sources_export, spectra=spectra_export, num_top_sources=5)


def export_all_cached_regions():
    """Exports every region present in cache/spherex/ that contains FITS cutouts."""
    if not CACHE_SPHEREX.exists():
        print(f"[FATAL ERROR] Cache directory does not exist: {CACHE_SPHEREX}")
        print("Please run 'python pipeline/fetch_spherex.py' first.")
        sys.exit(1)

    configured = [r.get("id") for r in load_regions_config() if r.get("id")]
    cached_dirs = {
        d.name: d
        for d in CACHE_SPHEREX.iterdir()
        if d.is_dir() and any(d.glob("*.fits"))
    }
    ordered_ids = [rid for rid in configured if rid in cached_dirs] + sorted(
        rid for rid in cached_dirs if rid not in configured
    )

    if not ordered_ids:
        print(f"[FATAL ERROR] No cached FITS cutouts found in {CACHE_SPHEREX}.")
        sys.exit(1)

    root_region = "north-ecliptic-pole" if "north-ecliptic-pole" in ordered_ids else ordered_ids[0]
    for rid in ordered_ids:
        export_region_data(rid, write_root=(rid == root_region))

    print(f"\n[ALL REGIONS COMPLETE] Exported {len(ordered_ids)} region(s): {', '.join(ordered_ids)}")


def main():
    parser = argparse.ArgumentParser(description="Export real SPHEREx results to web/public/real/.")
    parser.add_argument("region", nargs="?", default="north-ecliptic-pole", help="Region ID to export.")
    parser.add_argument("--all", action="store_true", help="Export all downloaded regions found in cache/spherex/.")
    args = parser.parse_args()

    if args.all or args.region.lower() == "all":
        export_all_cached_regions()
    else:
        export_region_data(args.region, write_root=True)


if __name__ == "__main__":
    main()
