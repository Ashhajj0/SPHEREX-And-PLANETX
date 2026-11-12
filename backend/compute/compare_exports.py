#!/usr/bin/env python3
"""
backend/compute/compare_exports.py
==================================
Compares two exported SPHEREx spectra JSON files (old vs new).

Usage:
  python -m backend.compute.compare_exports <old_spectra.json> <new_spectra.json>

Verification Rules:
1. Compares every point's flux_uJy, flux_err_uJy, and null_reason between the two files.
2. Prints how many differ; exits with a non-zero error if ANY differ.
3. Prints how many points became newly suspect and the counts per new reason.
"""

import sys
import json
import argparse
from pathlib import Path
from typing import Dict, Any, List, Tuple


def load_spectra_dict(file_path: Path) -> Dict[str, Dict[str, Dict[str, Any]]]:
    """
    Loads spectra JSON file and indexes points by (source_id, exposure_id).
    Accepts both {source_id: [points]} and {"spectra": {source_id: [points]}}.
    """
    if not file_path.exists():
        print(f"[FATAL] File not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, dict) and "spectra" in data:
        data = data["spectra"]

    if not isinstance(data, dict):
        print(f"[FATAL] Invalid spectra JSON root format in {file_path}", file=sys.stderr)
        sys.exit(1)

    indexed: Dict[str, Dict[str, Dict[str, Any]]] = {}
    for source_id, pts in data.items():
        indexed[source_id] = {}
        for pt in pts:
            # Match on exposure_id or exposure_file
            exp_key = pt.get("exposure_id") or pt.get("exposure_file")
            if exp_key:
                indexed[source_id][exp_key] = pt

    return indexed


def compare_exports(old_file: Path, new_file: Path) -> int:
    """
    Compares old vs new spectra exports.
    Returns 0 on success (no flux/err/null diffs), or 1 if any difference is found.
    """
    print("=================================================================")
    print(" SPHEREx Scientific Export Regression Comparator")
    print(f" Old: {old_file}")
    print(f" New: {new_file}")
    print("=================================================================\n")

    old_data = load_spectra_dict(old_file)
    new_data = load_spectra_dict(new_file)

    diff_count = 0
    newly_suspect_count = 0
    new_reasons_counts: Dict[str, int] = {}
    total_points_compared = 0

    all_source_ids = sorted(set(old_data.keys()) | set(new_data.keys()))

    for src_id in all_source_ids:
        if src_id not in old_data:
            print(f"[DIFF] Source '{src_id}' exists in new export but not in old export.")
            diff_count += 1
            continue
        if src_id not in new_data:
            print(f"[DIFF] Source '{src_id}' exists in old export but not in new export.")
            diff_count += 1
            continue

        old_src = old_data[src_id]
        new_src = new_data[src_id]

        all_exp_keys = sorted(set(old_src.keys()) | set(new_src.keys()))

        for exp_key in all_exp_keys:
            if exp_key not in old_src or exp_key not in new_src:
                print(f"[DIFF] Point {src_id} @ {exp_key} missing in one file.")
                diff_count += 1
                continue

            total_points_compared += 1
            p_old = old_src[exp_key]
            p_new = new_src[exp_key]

            # 1. Compare flux_uJy
            f_old = p_old.get("flux_uJy")
            f_new = p_new.get("flux_uJy")
            flux_diff = False
            if f_old is None and f_new is not None:
                flux_diff = True
            elif f_old is not None and f_new is None:
                flux_diff = True
            elif f_old is not None and f_new is not None:
                if abs(f_old - f_new) > 1e-4:
                    flux_diff = True

            # 2. Compare flux_err_uJy
            err_old = p_old.get("flux_err_uJy")
            err_new = p_new.get("flux_err_uJy")
            err_diff = False
            if err_old is None and err_new is not None:
                err_diff = True
            elif err_old is not None and err_new is None:
                err_diff = True
            elif err_old is not None and err_new is not None:
                if abs(err_old - err_new) > 1e-4:
                    err_diff = True

            # 3. Compare null_reason
            null_old = p_old.get("null_reason")
            null_new = p_new.get("null_reason")
            null_diff = (null_old != null_new)

            if flux_diff or err_diff or null_diff:
                diff_count += 1
                print(f"[DIFF] {src_id} @ {exp_key}:")
                if flux_diff:
                    print(f"       flux_uJy: old={f_old} -> new={f_new}")
                if err_diff:
                    print(f"       flux_err_uJy: old={err_old} -> new={err_new}")
                if null_diff:
                    print(f"       null_reason: old='{null_old}' -> new='{null_new}'")

            # 4. Check for newly suspect points and new reasons
            q_old = p_old.get("quality", "ok")
            q_new = p_new.get("quality", "ok")
            reasons_old = set(p_old.get("quality_reasons", []))
            reasons_new = set(p_new.get("quality_reasons", []))

            if q_old != "suspect" and q_new == "suspect":
                newly_suspect_count += 1

            # Tally newly added reasons
            for r in reasons_new - reasons_old:
                new_reasons_counts[r] = new_reasons_counts.get(r, 0) + 1

    print(f"Total points compared         : {total_points_compared:,}")
    print(f"Differences in flux/err/null  : {diff_count}")
    print(f"Newly suspect points          : {newly_suspect_count:,}")

    if new_reasons_counts:
        print("\nCounts per new suspect reason:")
        for reason, count in sorted(new_reasons_counts.items(), key=lambda x: -x[1]):
            print(f"  - {reason:<32}: {count:>5,}")
    else:
        print("\nNo newly added suspect reasons.")

    if diff_count > 0:
        print(f"\n[FATAL] Comparison failed: {diff_count} points differ in flux, error, or null_reason!", file=sys.stderr)
        return 1

    print("\n[SUCCESS] All fluxes, flux errors, and null reasons are perfectly identical (0 differences).")
    return 0


def main():
    parser = argparse.ArgumentParser(
        description="Compare two SPHEREx spectra.json files for regression testing."
    )
    parser.add_argument("old_spectra", type=Path, help="Path to reference old spectra.json")
    parser.add_argument("new_spectra", type=Path, help="Path to newly exported spectra.json")
    args = parser.parse_args()

    exit_code = compare_exports(args.old_spectra, args.new_spectra)
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
