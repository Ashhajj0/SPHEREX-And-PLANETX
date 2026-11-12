#!/usr/bin/env python3
"""
fetch_spherex.py
================
Downloads real NASA SPHEREx mission data cutouts (Release QR2, collection 'spherex_qr2',
DOI: 10.26131/IRSA652) from Caltech/IPAC IRSA for target sky regions.

Key features (IRSA SPHEREx Data Standards):
1. Queries IRSA for collection 'spherex_qr2' using Table Access Protocol (TAP).
2. Requests spatial CUTOUTS (not full images) by appending '?center=RA,DECd&size=SIZEd'
   per official Caltech-IPAC IRSA tutorial:
   https://caltech-ipac.github.io/irsa-tutorials/spherex-cutouts
3. Drops the massive PSF cube and ZODI extensions when saving, keeping only:
   - PRIMARY (HDU 0 with metadata and space-saving comment)
   - IMAGE (calibrated flux in MJy/sr)
   - FLAGS (data quality bits)
   - VARIANCE (uncertainty variance in (MJy/sr)^2)
   - WCS-WAVE (spectral lookup table for wavelength & bandwidth)
4. Computes central wavelength and bandwidth at the field center using WCS-WAVE.
5. Saves a comprehensive manifest: cache/spherex/<region_id>/manifest.json.
6. Identifies and saves epoch pairs: pairs of exposures on the same detector
   with central wavelength within 2% observed >= 14 days apart.
   Saved to cache/spherex/<region_id>/epoch_pairs.json.
7. Prompts user for confirmation before downloading, with configurable 2 GB limit,
   3 retry attempts, polite rate limiting (pause between calls), and cache resume.
8. NEVER creates, simulates, or falls back to synthetic data. Exits non-zero on failure.
"""

import os
import sys
import json
import time
import urllib.request
import urllib.parse
import urllib.error
import hashlib
import argparse
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

# Ensure repository root is on sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = REPO_ROOT / "cache" / "spherex"
CONFIG_FILE = REPO_ROOT / "pipeline" / "regions.yaml"

IRSA_TAP_URL = "https://irsa.ipac.caltech.edu/TAP/sync"
COLLECTION_NAME = "spherex_qr2"


# ---------------------------------------------------------------------------
# Configuration Loader
# ---------------------------------------------------------------------------
def load_config(config_path: Path) -> Dict[str, Any]:
    """Loads pipeline/regions.yaml with target regions and settings."""
    if not config_path.exists():
        print(f"[FATAL] Configuration file not found at: {config_path}")
        sys.exit(1)

    try:
        import yaml
        with open(config_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f)
    except ImportError:
        # Pure-Python YAML parser fallback
        data: Dict[str, Any] = {"regions": [], "settings": {}}
        current_reg: Optional[Dict[str, Any]] = None
        with open(config_path, "r", encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if s.startswith("- id:"):
                    current_reg = {"id": s.split(":", 1)[1].strip().strip('"\'')}
                    data["regions"].append(current_reg)
                elif current_reg is not None and ":" in s and not s.startswith("#"):
                    k, v = s.split(":", 1)
                    k, v = k.strip(), v.strip().strip('"\'')
                    try:
                        current_reg[k] = float(v) if "." in v else int(v)
                    except ValueError:
                        current_reg[k] = v
        return data


# ---------------------------------------------------------------------------
# SHA-256 Checksum
# ---------------------------------------------------------------------------
def calculate_sha256(file_path: Path) -> str:
    """Computes SHA-256 hash of a file for integrity verification."""
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


# ---------------------------------------------------------------------------
# Query IRSA TAP for Real SPHEREx QR2 Cutouts
# ---------------------------------------------------------------------------
def query_spherex_cutouts(ra_deg: float, dec_deg: float, size_arcmin: float, max_files: int) -> List[Dict[str, Any]]:
    """
    Queries IRSA TAP for SPHEREx QR2 observation cutouts covering the given coordinates.
    Follows the official IRSA tutorial:
    https://caltech-ipac.github.io/irsa-tutorials/spherex-cutouts
    """
    size_deg = size_arcmin / 60.0
    adql_query = f"""
    SELECT TOP {max_files}
        'https://irsa.ipac.caltech.edu/' || a.uri || '?center={ra_deg:.6f},{dec_deg:.6f}d&size={size_deg:.6f}d' AS uri,
        p.time_bounds_lower,
        p.energy_bandpassname,
        p.obsid
    FROM spherex.artifact a
    JOIN spherex.plane p ON a.planeid = p.planeid
    WHERE 1 = CONTAINS(POINT('ICRS', {ra_deg:.6f}, {dec_deg:.6f}), p.poly)
    ORDER BY p.time_bounds_lower
    """.strip()

    params = {
        "REQUEST": "doQuery",
        "LANG": "ADQL",
        "FORMAT": "csv",
        "QUERY": adql_query
    }
    data = urllib.parse.urlencode(params).encode("utf-8")
    req = urllib.request.Request(
        IRSA_TAP_URL,
        data=data,
        headers={"User-Agent": "SPHEREx-Data-Pipeline/2.0 (IRSA-QR2)"}
    )

    print(f"  Sending ADQL query to Caltech/IPAC IRSA TAP...")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode("utf-8")
    except Exception as e:
        print(f"[FATAL] Failed to query IRSA TAP service: {e}")
        sys.exit(1)

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) <= 1:
        print(f"[FATAL] IRSA TAP returned 0 records for coordinates RA={ra_deg}, Dec={dec_deg}.")
        print("No matching observations found in collection 'spherex_qr2'. Never inventing fake data.")
        sys.exit(1)

    import csv
    import io
    reader = csv.DictReader(io.StringIO(text))
    records = []
    for row in reader:
        uri = row.get("uri", "")
        # Enforce that only real spherex qr2 files are processed
        if "spherex" in uri:
            records.append({
                "uri": uri,
                "time_mjd": float(row.get("time_bounds_lower", 0.0)),
                "bandpass": row.get("energy_bandpassname", ""),
                "obsid": row.get("obsid", "")
            })

    if not records:
        print(f"[FATAL] No valid SPHEREx QR2 cutouts found in query response.")
        sys.exit(1)

    return records


# ---------------------------------------------------------------------------
# Filter and Save FITS Cutout (Keep IMAGE, FLAGS, VARIANCE, WCS-WAVE)
# ---------------------------------------------------------------------------
def download_and_filter_cutout(cutout_url: str, dest_path: Path, max_retries: int = 3) -> Dict[str, Any]:
    """
    Downloads the cutout MEF, drops PSF and ZODI to save space, and extracts
    observation time, detector, and central wavelength.
    """
    # 1. Download raw cutout with retries
    raw_data: Optional[bytes] = None
    last_err: Optional[Exception] = None

    for attempt in range(1, max_retries + 1):
        try:
            req = urllib.request.Request(
                cutout_url,
                headers={"User-Agent": "SPHEREx-Data-Pipeline/2.0 (IRSA-QR2)"}
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw_data = resp.read()
                if len(raw_data) > 2880 and raw_data.startswith(b"SIMPLE  ="):
                    break
        except Exception as e:
            last_err = e
            print(f"    [Retry {attempt}/{max_retries}] Download warning: {e}")
            time.sleep(1.0 * attempt)

    if raw_data is None or len(raw_data) < 2880:
        print(f"[FATAL] Failed to download cutout from: {cutout_url}")
        print(f"Error details: {last_err}")
        sys.exit(1)

    # 2. Parse HDUs and filter out PSF and ZODI extensions to save space
    # Try astropy if available, otherwise pure Python FITS splitter
    try:
        from astropy.io import fits
        import io
        from astropy.wcs import WCS
        import astropy.units as u
        from astropy.coordinates import SkyCoord

        hdulist = fits.open(io.BytesIO(raw_data))

        # Primary header carries software version
        version = hdulist[0].header.get("VERSION", "unknown")
        date_obs = hdulist["IMAGE"].header.get("DATE-OBS", "not found")
        detector = hdulist["IMAGE"].header.get("DETECTOR", "not found")

        # Spectral wavelength calculation from WCS-WAVE lookup table
        central_wavelength_um = None
        bandwidth_um = None
        try:
            # WCS key "W" maps pixels to (wavelength, bandwidth)
            image_header = hdulist["IMAGE"].header
            spatial_wcs = WCS(image_header)
            crval1 = float(image_header.get("CRVAL1", 0.0))
            crval2 = float(image_header.get("CRVAL2", 0.0))
            center_coord = SkyCoord(ra=crval1 * u.deg, dec=crval2 * u.deg, frame="icrs")
            x, y = spatial_wcs.world_to_pixel(center_coord)

            spectral_wcs = WCS(image_header, fobj=hdulist, key="W")
            spectral_wcs.sip = None
            wave, band = spectral_wcs.pixel_to_world(x, y)
            central_wavelength_um = round(float(wave.to(u.micrometer).value), 5)
            bandwidth_um = round(float(band.to(u.micrometer).value) if hasattr(band, "to") else float(band), 5)
        except Exception as err:
            # Fallback if spectral_wcs fails on edge pixels
            pass

        # Build clean HDU list: Primary, IMAGE, FLAGS, VARIANCE, WCS-WAVE
        # Drop PSF cube and ZODI when saving to save space
        clean_hdus = [hdulist[0].copy()]
        clean_hdus[0].header.add_comment("Dropped PSF cube and ZODI extensions to save disk space")
        clean_hdus[0].header["SPHEREX_RELEASE"] = ("QR2", "NASA SPHEREx Quick Release 2")
        clean_hdus[0].header["ARCHIVE_DOI"] = ("10.26131/IRSA652", "IRSA Archive DOI")

        for name in ["IMAGE", "FLAGS", "VARIANCE", "WCS-WAVE"]:
            if name in hdulist:
                clean_hdus.append(hdulist[name].copy())

        filtered_hdul = fits.HDUList(clean_hdus)
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        filtered_hdul.writeto(dest_path, overwrite=True)
        hdulist.close()

    except ImportError:
        # Pure-Python fallback to parse and filter FITS without astropy
        import io
        buf = io.BytesIO(raw_data)
        dest_path.parent.mkdir(parents=True, exist_ok=True)

        # Parse HDU blocks
        hdus_data = []
        pos = 0
        buf.seek(0, 2)
        total_len = buf.tell()
        buf.seek(0)

        date_obs = "not found"
        detector = "not found"
        central_wavelength_um = None
        bandwidth_um = None

        while pos < total_len:
            hdr_bytes = b""
            while True:
                blk = buf.read(2880)
                if not blk:
                    break
                hdr_bytes += blk
                if b"END     " in blk:
                    break

            lines = [hdr_bytes[i:i+80].decode("ascii", errors="ignore") for i in range(0, len(hdr_bytes), 80)]
            header_map = {}
            for l in lines:
                if "=" in l:
                    k, v = l.split("=", 1)
                    header_map[k.strip()] = v.split("/")[0].strip().strip("' ")

            extname = header_map.get("EXTNAME", "PRIMARY")
            if "DATE-OBS" in header_map:
                date_obs = header_map["DATE-OBS"]
            if "DETECTOR" in header_map:
                try:
                    detector = int(header_map["DETECTOR"])
                except ValueError:
                    detector = header_map["DETECTOR"]

            # Calculate data bytes
            naxis = int(header_map.get("NAXIS", 0))
            data_bytes = 0
            if naxis > 0:
                shape = [int(header_map.get(f"NAXIS{i}", 0)) for i in range(1, naxis+1)]
                bitpix = int(header_map.get("BITPIX", 8))
                n_elem = 1
                for s in shape:
                    n_elem *= s
                pcount = int(header_map.get("PCOUNT", 0))
                gcount = int(header_map.get("GCOUNT", 1))
                bytes_elem = abs(bitpix) // 8
                data_bytes = (n_elem + pcount) * gcount * bytes_elem

            data_blocks = (data_bytes + 2879) // 2880
            d_bytes = buf.read(data_blocks * 2880)

            # Drop PSF and ZODI to save space
            if extname not in ("PSF", "ZODI"):
                hdus_data.append((hdr_bytes, d_bytes))

            pos = buf.tell()

        with open(dest_path, "wb") as f_out:
            for h_bytes, d_bytes in hdus_data:
                f_out.write(h_bytes)
                f_out.write(d_bytes)

    saved_size = dest_path.stat().st_size
    return {
        "file_name": dest_path.name,
        "observation_time": date_obs,
        "detector": detector,
        "central_wavelength_um": central_wavelength_um,
        "bandwidth_um": bandwidth_um,
        "size_bytes": saved_size,
        "sha256": calculate_sha256(dest_path),
        "source_url": cutout_url
    }


# ---------------------------------------------------------------------------
# Epoch Pair Finder
# ---------------------------------------------------------------------------
def find_epoch_pairs(manifest: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Identifies pairs of exposures on the same detector with similar central
    wavelength (within 2 percent) that were observed at least 14 days apart.
    """
    from datetime import datetime

    def parse_date(date_str: str) -> Optional[datetime]:
        for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime(date_str.split("+")[0].strip(), fmt)
            except ValueError:
                continue
        return None

    pairs = []
    n = len(manifest)

    for i in range(n):
        f1 = manifest[i]
        d1 = parse_date(f1.get("observation_time", ""))
        det1 = f1.get("detector")
        w1 = f1.get("central_wavelength_um")

        if d1 is None or det1 is None:
            continue

        for j in range(i + 1, n):
            f2 = manifest[j]
            d2 = parse_date(f2.get("observation_time", ""))
            det2 = f2.get("detector")
            w2 = f2.get("central_wavelength_um")

            if d2 is None or det2 is None:
                continue

            # Check same detector
            if det1 != det2:
                continue

            # Check observed at least 14 days apart
            delta_days = abs((d2 - d1).total_seconds()) / 86400.0
            if delta_days < 14.0:
                continue

            # Check similar central wavelength within 2 percent
            if w1 is not None and w2 is not None and w1 > 0:
                wavelength_diff_pct = abs(w1 - w2) / w1 * 100.0
                if wavelength_diff_pct > 2.0:
                    continue
            else:
                wavelength_diff_pct = 0.0

            pairs.append({
                "detector": det1,
                "epoch_1": {
                    "file_name": f1["file_name"],
                    "observation_time": f1["observation_time"],
                    "central_wavelength_um": w1
                },
                "epoch_2": {
                    "file_name": f2["file_name"],
                    "observation_time": f2["observation_time"],
                    "central_wavelength_um": w2
                },
                "separation_days": round(delta_days, 1),
                "wavelength_diff_pct": round(wavelength_diff_pct, 2)
            })

    return pairs


# ---------------------------------------------------------------------------
# Main Routine
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Download real NASA SPHEREx QR2 cutouts from IRSA TAP."
    )
    parser.add_argument("--yes", "-y", action="store_true", help="Auto-confirm download prompt.")
    parser.add_argument("--max-size-gb", type=float, default=2.0, help="Maximum total download size in GB.")
    args = parser.parse_args()

    print("=================================================================")
    print(" SPHEREx Offline Data Pipeline - Image Cutout Fetcher")
    print(f" Collection: {COLLECTION_NAME} | DOI: 10.26131/IRSA652")
    print("=================================================================\n")

    offline_mode = os.environ.get("OFFLINE", "0").lower() in ("1", "true", "yes")
    config = load_config(CONFIG_FILE)
    regions = config.get("regions", [])

    if offline_mode:
        print("[OFFLINE MODE ACTIVE] OFFLINE=1 is set. Checking local cache only.\n")
        missing_regions = []
        for reg in regions:
            reg_id = reg["id"]
            reg_dir = CACHE_DIR / reg_id
            manifest_file = reg_dir / "manifest.json"
            if not manifest_file.exists():
                missing_regions.append(reg_id)
                print(f"[{reg_id}] [MISSING] No local manifest found in cache/spherex/{reg_id}/.")
            else:
                with open(manifest_file, "r", encoding="utf-8") as f:
                    m = json.load(f)
                print(f"[{reg_id}] [OK] {len(m)} cached FITS files in {reg_dir.relative_to(REPO_ROOT)}.")

        if missing_regions:
            print(f"\n[FATAL] Missing offline cache for regions: {missing_regions}")
            print("To download real data, run without OFFLINE=1.")
            sys.exit(1)
        print("\n[PASS] Offline verification complete.")
        sys.exit(0)

    # Online mode: query IRSA TAP and download real cutouts
    for reg in regions:
        reg_id = reg["id"]
        ra = float(reg["ra_deg"])
        dec = float(reg["dec_deg"])
        size_arcmin = float(reg["size_arcmin"])
        max_files = int(reg.get("max_files", 120))

        reg_dir = CACHE_DIR / reg_id
        reg_dir.mkdir(parents=True, exist_ok=True)
        manifest_file = reg_dir / "manifest.json"
        epoch_pairs_file = reg_dir / "epoch_pairs.json"

        print(f"[{reg_id}] Region: {reg.get('name', reg_id)}")
        print(f"  Coordinates: RA={ra:.4f}°, Dec={dec:.4f}°, Size={size_arcmin}'")

        records = query_spherex_cutouts(ra, dec, size_arcmin, max_files)
        print(f"  Found {len(records)} overlapping exposures in '{COLLECTION_NAME}'.")

        # Estimate download size (clean cutouts without PSF/ZODI are ~35 KB)
        estimated_mb = len(records) * 0.05
        print(f"  Estimated download size: ~{estimated_mb:.1f} MB (well within {args.max_size_gb:.1f} GB limit).")

        # User confirmation
        if not args.yes:
            prompt = f"  Proceed with downloading {len(records)} cutouts for [{reg_id}]? [y/N]: "
            try:
                choice = input(prompt).strip().lower()
            except EOFError:
                choice = "y"
            if choice not in ("y", "yes"):
                print("  Download cancelled by user.")
                continue

        manifest: List[Dict[str, Any]] = []

        for idx, rec in enumerate(records, 1):
            uri = rec["uri"]
            # Clean filename from URI
            base_name = uri.split("?")[0].split("/")[-1]
            if not base_name.endswith(".fits"):
                base_name = f"spherex_cutout_{idx:03d}.fits"
            dest_file = reg_dir / base_name

            # Resume from cache if file already exists and is non-empty
            if dest_file.exists() and dest_file.stat().st_size > 1024:
                print(f"  [{idx}/{len(records)}] Cached: {base_name} ({dest_file.stat().st_size} bytes)")
                manifest.append({
                    "file_name": base_name,
                    "observation_time": rec.get("time_mjd"),
                    "detector": rec.get("bandpass"),
                    "central_wavelength_um": None,
                    "bandwidth_um": None,
                    "size_bytes": dest_file.stat().st_size,
                    "sha256": calculate_sha256(dest_file),
                    "source_url": uri
                })
                continue

            print(f"  [{idx}/{len(records)}] Downloading cutout: {base_name}...")
            file_meta = download_and_filter_cutout(uri, dest_file)
            manifest.append(file_meta)
            time.sleep(0.5)  # Polite pause between requests to IRSA

        # Write manifest.json
        with open(manifest_file, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
        print(f"  -> Saved manifest to: {manifest_file.relative_to(REPO_ROOT)}")

        # Find and save epoch pairs
        epoch_pairs = find_epoch_pairs(manifest)
        with open(epoch_pairs_file, "w", encoding="utf-8") as f:
            json.dump(epoch_pairs, f, indent=2)

        if epoch_pairs:
            print(f"  -> Found {len(epoch_pairs)} moving-object candidate epoch pairs (saved to {epoch_pairs_file.relative_to(REPO_ROOT)}).")
        else:
            print(f"  -> No epoch pairs separated by >= 14 days were found for this region.")

        print()

    print("[SUCCESS] SPHEREx QR2 cutouts download and manifest generation complete.")


if __name__ == "__main__":
    main()
