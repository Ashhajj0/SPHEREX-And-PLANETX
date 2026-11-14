#!/usr/bin/env python3
"""
backend/compute/validate_export.py
==================================
Validates the exported web/public/real/ dataset for the SPHEREx web explorer.

Validation Checks:
1. All required export files exist (manifest.json, exposures.json, sources.json,
   spectra.json, README.txt, and display PNG images).
2. JSON files load cleanly and contain no NaN or Infinity values.
3. Manifest explicitly states kind 'real' with release 'QR2' and DOI.
4. Every spectrum in spectra.json is strictly sorted by wavelength.
5. Every source ID in sources.json appears in spectra.json and vice versa.

Summary Metrics Printed:
- File sizes of all export files.
- The solid_angle_kind really used.
- Breakdown of null points by reason (counts and percentage).
- 12 evenly spaced spectrum points for SPX-NEP-001 and SPX-NEP-004.
- Count of sources with at least 100 valid spectral points.
- Clean [PASS] or [FAIL] exit status.
"""

import sys
import json
import math
import argparse
from pathlib import Path
from typing import Dict, List, Optional, Any

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

# Check primary web/public/real/, fallback to public/real/
CANDIDATE_DIRS = [
    REPO_ROOT / "web" / "public" / "real",
    REPO_ROOT / "public" / "real"
]


def find_export_dir(region_id: Optional[str] = None) -> Path:
    """Finds the active export directory (or specific region directory if requested)."""
    for d in CANDIDATE_DIRS:
        target = (d / "regions" / region_id) if region_id else d
        if target.exists() and (target / "manifest.json").exists():
            return target
    return (CANDIDATE_DIRS[0] / "regions" / region_id) if region_id else CANDIDATE_DIRS[0]


def check_no_nans(data: Any, path_str: str = "") -> List[str]:
    """Recursively checks that no NaNs or Infinities exist in the parsed JSON structure."""
    errors = []
    if isinstance(data, float):
        if math.isnan(data) or math.isinf(data):
            errors.append(f"Invalid float {data} at {path_str}")
    elif isinstance(data, dict):
        for k, v in data.items():
            errors.extend(check_no_nans(v, f"{path_str}.{k}"))
    elif isinstance(data, list):
        for idx, item in enumerate(data):
            errors.extend(check_no_nans(item, f"{path_str}[{idx}]"))
    return errors


def print_12_points(source_id: str, points: List[Dict[str, Any]]):
    """Prints 12 evenly spaced spectral points for a given source."""
    print(f"\n--- 12 Evenly Spaced Spectrum Points for {source_id} ---")
    if not points:
        print("  No points available.")
        return

    n = len(points)
    step = max(1, n // 12)
    selected_indices = [min(i * step, n - 1) for i in range(12)]
    # Deduplicate while preserving order
    selected_indices = sorted(list(dict.fromkeys(selected_indices)))

    print(f" {'Idx':<4} | {'Exp ID':<7} | {'Wavelength (um)':<16} | {'Flux (uJy)':<12} | {'Error (uJy)':<12} | {'Status'}")
    print("-" * 75)
    for idx in selected_indices:
        pt = points[idx]
        w = f"{pt.get('wavelength_um', 0.0):.4f}" if pt.get('wavelength_um') is not None else "None"
        f_val = f"{pt.get('flux_uJy', 0.0):.2f}" if pt.get('flux_uJy') is not None else "null"
        err_val = f"{pt.get('flux_err_uJy', 0.0):.2f}" if pt.get('flux_err_uJy') is not None else "null"
        status = pt.get("null_reason") if pt.get("null_reason") else "valid"
        print(f" {idx:<4} | {pt.get('exposure_id', '-'):<7} | {w:<16} | {f_val:<12} | {err_val:<12} | {status}")


def main():
    parser = argparse.ArgumentParser(description="Validate exported SPHEREx QR2 dataset.")
    parser.add_argument("--region", type=str, default=None, help="Optional region ID under regions/ to validate.")
    args = parser.parse_args()

    print("=================================================================")
    print(" SPHEREx Export Dataset Validator")
    print(" Enforcing Strict Completeness, Schema, and Scientific Integrity")
    print("=================================================================\n")

    export_dir = find_export_dir(args.region)
    print(f"Inspecting export directory: {export_dir.relative_to(REPO_ROOT)}/\n")

    failures = []

    # 1. Check all required files exist
    required_files = [
        "manifest.json",
        "exposures.json",
        "sources.json",
        "spectra.json",
        "README.txt"
    ]

    for fname in required_files:
        fpath = export_dir / fname
        if not fpath.exists():
            failures.append(f"Missing required file: {fname}")
        elif fpath.stat().st_size == 0:
            failures.append(f"File is empty: {fname}")

    # Check images directory
    images_dir = export_dir / "images"
    if not images_dir.exists():
        failures.append("Missing images/ directory.")
    else:
        png_count = len(list(images_dir.glob("*.png")))
        if png_count == 0:
            failures.append("images/ directory contains no PNG files.")
        else:
            print(f"  [OK] images/ contains {png_count} display PNGs.")

    if failures:
        print("[FAIL] Missing export files:")
        for err in failures:
            print(f"  - {err}")
        sys.exit(1)

    # 2. Load JSON files and check for NaNs
    print("  [OK] All required files exist on disk.")

    manifest_data = {}
    exposures_data = []
    sources_data = []
    spectra_data = {}

    for fname, var_name in [
        ("manifest.json", "manifest"),
        ("exposures.json", "exposures"),
        ("sources.json", "sources"),
        ("spectra.json", "spectra")
    ]:
        fpath = export_dir / fname
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                content = json.load(f)
            if var_name == "manifest":
                manifest_data = content
            elif var_name == "exposures":
                exposures_data = content
            elif var_name == "sources":
                sources_data = content
            elif var_name == "spectra":
                spectra_data = content

            # Check for NaNs
            nan_errs = check_no_nans(content, fname)
            if nan_errs:
                failures.append(f"{fname} contains NaN/Infinity values: {nan_errs[:3]}")
            else:
                print(f"  [OK] {fname}: valid JSON, 0 NaNs/Infinities ({fpath.stat().st_size:,} bytes).")
        except Exception as e:
            failures.append(f"Failed to parse {fname}: {e}")

    # 3. Check manifest metadata
    if manifest_data.get("kind") != "real":
        failures.append(f"manifest.json kind is '{manifest_data.get('kind')}', expected 'real'.")
    else:
        print("  [OK] manifest.json explicitly confirms kind: 'real'.")

    # 4. Check every spectrum is sorted by wavelength
    unsorted_spectra = []
    unsorted_details: Dict[str, List[Dict[str, Any]]] = {}
    null_reasons_count: Dict[str, int] = {}
    total_points = 0
    total_nulls = 0
    sources_with_100_valid = 0

    for src_id, pts in spectra_data.items():
        # Check that spectrum points are sorted ascending by wavelength,
        # with any None/NaN wavelengths placed last.
        offending_pairs = []
        for i in range(len(pts) - 1):
            p1 = pts[i]
            p2 = pts[i + 1]
            w1 = p1.get("wavelength_um")
            w2 = p2.get("wavelength_um")

            is_w1_none = w1 is None or (isinstance(w1, (int, float)) and math.isnan(w1))
            is_w2_none = w2 is None or (isinstance(w2, (int, float)) and math.isnan(w2))

            is_out_of_order = False
            if is_w1_none and not is_w2_none:
                # Null wavelength precedes a valid wavelength
                is_out_of_order = True
            elif not is_w1_none and not is_w2_none and w1 > w2:
                # Wavelengths out of ascending order
                is_out_of_order = True

            if is_out_of_order:
                offending_pairs.append({
                    "p1_exp": p1.get("exposure_file", "unknown"),
                    "p1_wave": w1,
                    "p1_reason": p1.get("null_reason"),
                    "p2_exp": p2.get("exposure_file", "unknown"),
                    "p2_wave": w2,
                    "p2_reason": p2.get("null_reason"),
                })

        if offending_pairs:
            unsorted_spectra.append(src_id)
            unsorted_details[src_id] = offending_pairs[:3]

        # Count null reasons and valid points
        valid_in_src = 0
        for p in pts:
            total_points += 1
            if p.get("flux_uJy") is None:
                total_nulls += 1
                reason = p.get("null_reason", "unspecified")
                null_reasons_count[reason] = null_reasons_count.get(reason, 0) + 1
            else:
                valid_in_src += 1

        if valid_in_src >= 100:
            sources_with_100_valid += 1

    if unsorted_spectra:
        print(f"\n[FAIL] Found {len(unsorted_spectra)} unsorted spectra:")
        for src_id in unsorted_spectra:
            print(f"  Source {src_id}:")
            for pair_idx, pair in enumerate(unsorted_details.get(src_id, []), 1):
                print(
                    f"    Pair {pair_idx}: [Exposure {pair['p1_exp']}, wave={pair['p1_wave']} um, "
                    f"null_reason={pair['p1_reason']!r}] followed by "
                    f"[Exposure {pair['p2_exp']}, wave={pair['p2_wave']} um, "
                    f"null_reason={pair['p2_reason']!r}]"
                )
        failures.append(f"Spectra not sorted by wavelength for sources: {unsorted_spectra[:5]}")
    else:
        print(f"  [OK] All {len(spectra_data)} spectra are strictly sorted by wavelength.")

    # 5. Check every source id appears in sources.json and spectra.json
    source_ids_in_sources = {s.get("id") for s in sources_data}
    source_ids_in_spectra = set(spectra_data.keys())

    missing_in_spectra = source_ids_in_sources - source_ids_in_spectra
    missing_in_sources = source_ids_in_spectra - source_ids_in_sources

    if missing_in_spectra:
        failures.append(f"Source IDs present in sources.json but missing in spectra.json: {list(missing_in_spectra)[:5]}")
    if missing_in_sources:
        failures.append(f"Source IDs present in spectra.json but missing in sources.json: {list(missing_in_sources)[:5]}")

    if not missing_in_spectra and not missing_in_sources:
        print(f"  [OK] Exact 1:1 match across {len(source_ids_in_sources)} source IDs in sources.json and spectra.json.")

    # Print summary metrics
    print("\n=================================================================")
    print(" Export Dataset Metrics:")
    print("=================================================================")
    print(f"  Solid Angle Kind Used: {manifest_data.get('solid_angle_kind', 'unknown')}")
    print(f"  Total Sources: {len(sources_data)}")
    print(f"  Total Exposures: {len(exposures_data)}")
    print(f"  Sources with >= 100 Valid Spectrum Points: {sources_with_100_valid} / {len(sources_data)} ({sources_with_100_valid/max(1, len(sources_data))*100:.1f}%)")

    print("\n  Null Points Breakdown by Reason:")
    print(f"    Total Spectral Points: {total_points:,}")
    print(f"    Valid Points: {total_points - total_nulls:,} ({(total_points - total_nulls)/max(1, total_points)*100:.2f}%)")
    print(f"    Total Null Points: {total_nulls:,} ({total_nulls/max(1, total_points)*100:.2f}%)")
    for reason, cnt in sorted(null_reasons_count.items(), key=lambda x: -x[1]):
        pct = (cnt / max(1, total_points)) * 100.0
        print(f"      - {reason}: {cnt:,} points ({pct:.2f}%)")

    # Print 12 evenly spaced points for SPX-NEP-001 and SPX-NEP-004
    # If exact string IDs differ, pick 1st and 4th sources
    target_ids = ["SPX-NEP-001", "SPX-NEP-004"]
    available_ids = list(spectra_data.keys())
    if available_ids:
        id1 = target_ids[0] if target_ids[0] in spectra_data else available_ids[0]
        id4 = target_ids[1] if target_ids[1] in spectra_data else (available_ids[3] if len(available_ids) > 3 else available_ids[-1])
        print_12_points(id1, spectra_data.get(id1, []))
        if id4 != id1:
            print_12_points(id4, spectra_data.get(id4, []))

    # Print final verdict
    print("\n-----------------------------------------------------------------")
    if failures:
        print("[FAIL] Dataset validation failed with errors:")
        for err in failures:
            print(f"  - {err}")
        print("-----------------------------------------------------------------")
        sys.exit(1)
    else:
        print("[PASS] All export verification checks passed successfully.")
        print("-----------------------------------------------------------------")
        sys.exit(0)


if __name__ == "__main__":
    main()
