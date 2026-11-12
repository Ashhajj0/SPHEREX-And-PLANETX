#!/usr/bin/env python3
"""
backend/compute/run_region.py
=============================
Entry point to analyze a target region using real SPHEREx cached files.

Usage:
  python -m backend.compute.run_region north-ecliptic-pole
  python -m backend.compute.run_region south-ecliptic-pole
  python -m backend.compute.run_region cosmos

Behavior:
1. Loads all SPHEREx exposure cutouts from cache/spherex/<region_id>/.
2. Selects the optimal reference exposure for detection (lowest noise variance, fewest bad pixels).
3. Detects celestial point sources using Background2D and DAOStarFinder at a 5-sigma threshold.
4. Crossmatches detected sources against the local reference catalogue (e.g., Gaia DR3).
5. Computes multi-band aperture spectrophotometry across all exposures for each source.
6. Prints a concise, formatted summary for the 5 brightest detected sources.
7. Strictly writes NOTHING to disk.
"""

import sys
import argparse
from pathlib import Path

# Paths
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
CACHE_SPHEREX = REPO_ROOT / "cache" / "spherex"
CACHE_CATALOGUE = REPO_ROOT / "cache" / "catalogue"

from backend.compute.exposure import load_region_exposures
from backend.compute.detect import pick_reference_exposure, detect_sources
from backend.compute.spectrum import build_spectrum
from backend.compute.crossmatch import crossmatch_sources


def run_pipeline_for_region(region_id: str):
    """Executes the full in-memory scientific pipeline on a cached sky region."""
    region_spherex_dir = CACHE_SPHEREX / region_id
    region_cat_dir = CACHE_CATALOGUE / region_id

    print("=================================================================")
    print(" SPHEREx Science Pipeline - Region Processor")
    print(f" Target Region: {region_id}")
    print("=================================================================\n")

    # 1. Load exposures
    if not region_spherex_dir.exists():
        print(f"[ERROR] Directory does not exist: {region_spherex_dir}")
        print("Please run 'python pipeline/fetch_spherex.py' to download cutouts first.")
        sys.exit(1)

    print(f"Loading exposures from {region_spherex_dir.relative_to(REPO_ROOT)}...")
    try:
        exposures = load_region_exposures(region_spherex_dir)
    except Exception as e:
        print(f"[ERROR] Failed to load exposures: {e}")
        sys.exit(1)

    print(f"Loaded {len(exposures)} calibrated SPHEREx cutouts into memory.")

    # 2. Pick reference exposure
    ref_exp = pick_reference_exposure(exposures)
    ref_wave, _ = ref_exp.get_pixel_wavelength_and_bandwidth(ref_exp.shape[1] / 2.0, ref_exp.shape[0] / 2.0)
    ref_wave_str = f"{ref_wave:.2f} um" if ref_wave else "unknown"

    print(f"\n[Reference Exposure Picked]")
    print(f"  File: {ref_exp.file_name}")
    print(f"  Detector: Array {ref_exp.detector}")
    print(f"  Observation Time: {ref_exp.time}")
    print(f"  Wavelength at Field Center: {ref_wave_str}")

    # 3. Detect sources
    print(f"\nDetecting sources at 5-sigma threshold...")
    sources, det_meta = detect_sources(ref_exp, threshold_sigma=5.0, region_id=region_id)
    print(f"Detected {len(sources)} celestial point sources on reference exposure.")

    if not sources:
        print("[NOTICE] No sources detected above the 5-sigma threshold.")
        return

    # 4. Crossmatch against reference catalogue
    cat_files = list(region_cat_dir.glob("*.csv")) if region_cat_dir.exists() else []
    cat_files = [f for f in cat_files if not f.name.startswith("fixture_")]

    crossmatch_map = {}
    if cat_files:
        cat_file = cat_files[0]
        print(f"\nCrossmatching with catalogue: {cat_file.name}...")
        xm_results = crossmatch_sources(
            sources=sources,
            catalogue_path=cat_file,
            obs_time_iso=ref_exp.time,
            max_radius_arcsec=6.15
        )
        for res in xm_results:
            crossmatch_map[res.source_id] = res
    else:
        print("\n[Notice] No cached catalogue CSV found in cache/catalogue/. Proceeding without catalogue IDs.")

    # 5. Extract spectra and display top 5 brightest sources
    top_5 = sources[:5]
    print("\n-----------------------------------------------------------------")
    print(f" Results for the 5 Brightest Detected Sources:")
    print("-----------------------------------------------------------------")

    for i, src in enumerate(top_5, 1):
        spectrum = build_spectrum(src, exposures)
        summary = spectrum.summary

        valid_pts = summary["valid_points"]
        total_pts = summary["total_exposures"]
        w_min = summary["wavelength_min_um"]
        w_max = summary["wavelength_max_um"]

        w_range_str = f"{w_min:.2f} to {w_max:.2f} um" if (w_min and w_max) else "no valid points"

        xm = crossmatch_map.get(src.id)
        if xm and xm.gaia_id:
            gaia_str = f"Gaia DR3 {xm.gaia_id} (separation: {xm.separation_arcsec:.2f}\")"
        else:
            gaia_str = "No Gaia match within 6.15\""

        print(f"\n{i}. Source ID: {src.id}")
        print(f"   Coordinates: RA {src.ra_deg:.5f} deg, Dec {src.dec_deg:.5f} deg (Peak SNR: {src.peak_snr:.1f})")
        print(f"   Spectrum: {valid_pts} / {total_pts} valid points across {w_range_str}")
        print(f"   Catalogue: {gaia_str}")

    print("\n-----------------------------------------------------------------")
    print("[SUCCESS] Pipeline execution complete. Nothing was written to disk.")


def main():
    parser = argparse.ArgumentParser(
        description="Run SPHEREx scientific pipeline for a target sky region."
    )
    parser.add_argument(
        "region",
        type=str,
        nargs="?",
        default="north-ecliptic-pole",
        help="Region ID to process (default: north-ecliptic-pole)"
    )
    args = parser.parse_args()

    run_pipeline_for_region(args.region)


if __name__ == "__main__":
    main()
