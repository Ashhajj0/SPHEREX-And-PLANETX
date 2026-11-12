#!/usr/bin/env python3
"""
verify_data.py
==============
Integrity verification script for the SPHEREx offline data cache.

Strict verification rules:
1. FAILS LOUDLY if any file in cache/ has the FIXTURE flag.
2. FAILS LOUDLY if any catalogue in cache/ has fewer than 20 rows.
3. FAILS LOUDLY if data/provenance.json lists a missing file.
4. Prints a clear PASS or FAIL message and exits with code 0 on PASS, 1 on FAIL.
"""

import os
import sys
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = REPO_ROOT / "cache"
PROVENANCE_FILE = REPO_ROOT / "data" / "provenance.json"


def check_fits_fixture_flag(fits_path: Path) -> bool:
    """Checks if a FITS file contains the FIXTURE header card."""
    with open(fits_path, "rb") as f:
        # Read the first few 2880-byte header blocks
        header_bytes = f.read(2880 * 4)
    # Check if FIXTURE keyword exists
    return b"FIXTURE " in header_bytes or b"FIXTURE=" in header_bytes


def main():
    print("=================================================================")
    print(" SPHEREx Data Integrity Verification")
    print(" Enforcing Strict Scientific Cache Validation")
    print("=================================================================\n")

    failures = []

    # Check 1: Ensure cache exists
    if not CACHE_DIR.exists():
        print(f"[FAIL] Cache directory does not exist: {CACHE_DIR.relative_to(REPO_ROOT)}")
        print("Run fetch_spherex.py and fetch_catalogue.py to populate cache.")
        sys.exit(1)

    # Check 2: Verify NO fixture files or FIXTURE flags exist in cache/
    cached_fits = list(CACHE_DIR.glob("**/*.fits")) + list(CACHE_DIR.glob("**/*.fits.gz"))
    for f in cached_fits:
        if f.name.startswith("fixture_"):
            failures.append(f"Cache file has 'fixture_' prefix: {f.relative_to(REPO_ROOT)}")
        elif check_fits_fixture_flag(f):
            failures.append(f"Cache FITS file has FIXTURE header flag: {f.relative_to(REPO_ROOT)}")

    cached_csvs = list(CACHE_DIR.glob("**/*.csv"))
    for f in cached_csvs:
        if f.name.startswith("fixture_"):
            failures.append(f"Cache catalogue has 'fixture_' prefix: {f.relative_to(REPO_ROOT)}")
        else:
            with open(f, "r", encoding="utf-8", errors="ignore") as csv_f:
                head = "".join([csv_f.readline() for _ in range(10)])
                if "FIXTURE" in head.upper():
                    failures.append(f"Cache catalogue has FIXTURE comment in header: {f.relative_to(REPO_ROOT)}")

    # Check 3: Every catalogue must have at least 20 rows
    for f in cached_csvs:
        with open(f, "r", encoding="utf-8") as csv_f:
            data_rows = [l for l in csv_f if l.strip() and not l.startswith("#")]
        # Deduct header row
        count = max(0, len(data_rows) - 1)
        if count < 20:
            failures.append(f"Catalogue {f.relative_to(REPO_ROOT)} has only {count} rows (minimum required: 20)")
        else:
            print(f"  [OK] Catalogue {f.name}: {count} rows verified.")

    # Check 4: Check data/provenance.json lists all files accurately and none are missing
    if not PROVENANCE_FILE.exists():
        failures.append(f"Provenance file missing: {PROVENANCE_FILE.relative_to(REPO_ROOT)}")
    else:
        try:
            with open(PROVENANCE_FILE, "r", encoding="utf-8") as pf:
                pdata = json.load(pf)

            for item in pdata.get("real_files", []):
                rel = item.get("relative_path")
                if not rel or not (REPO_ROOT / rel).exists():
                    failures.append(f"Provenance lists missing real file: {rel}")

            for item in pdata.get("fixtures", []):
                rel = item.get("relative_path")
                if not rel or not (REPO_ROOT / rel).exists():
                    failures.append(f"Provenance lists missing fixture file: {rel}")

            print(f"  [OK] Provenance audit: {len(pdata.get('real_files', []))} real files, {len(pdata.get('fixtures', []))} fixtures.")
        except Exception as e:
            failures.append(f"Failed to read provenance.json: {e}")

    # Output verdict
    print("\n-----------------------------------------------------------------")
    if failures:
        print("[FAIL] Data verification failed with the following errors:")
        for err in failures:
            print(f"  - {err}")
        print("-----------------------------------------------------------------")
        sys.exit(1)
    else:
        print("[PASS] All data verification checks passed successfully.")
        print("-----------------------------------------------------------------")
        sys.exit(0)


if __name__ == "__main__":
    main()
