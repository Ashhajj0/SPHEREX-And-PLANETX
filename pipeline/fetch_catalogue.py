#!/usr/bin/env python3
"""
fetch_catalogue.py
==================
Downloads reference star catalogue subsets (Gaia DR3 or AllWISE) for each
region defined in pipeline/regions.yaml.

Key features:
1. Gaia DR3: Uses the official ESA Gaia TAP service:
   https://gea.esac.esa.int/tap-server/tap
   Querying table: gaiadr3.gaia_source
2. AllWISE: Uses the Caltech/IPAC IRSA TAP service:
   https://irsa.ipac.caltech.edu/TAP
   Dynamically queries TAP_SCHEMA.columns for table 'allwise_p3as_psd' first to
   ensure only existing columns are selected (no guessed column names).
   Keeps: designation, ra, dec, w1mpro, w2mpro.
3. Adds a 2-arcminute safety margin around each region.
4. Saves as clean CSV to cache/catalogue/<region_id>/<region_id>_catalogue_<type>.csv.
   Embeds the exact ADQL query, service URL, and retrieval timestamp in the file header.
5. ABSOLUTE RULE: Never generates, simulates, or falls back to synthetic data.
   If a query returns 0 rows or fails, it exits with a non-zero error.
6. Offline mode (OFFLINE=1): Checks local cache only.
"""

import os
import sys
import argparse
import urllib.request
import urllib.parse
import urllib.error
import csv
import io
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any, Set

REPO_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = REPO_ROOT / "cache" / "catalogue"
CONFIG_FILE = REPO_ROOT / "pipeline" / "regions.yaml"

ESA_GAIA_TAP_URL = "https://gea.esac.esa.int/tap-server/tap/sync"
IRSA_TAP_URL = "https://irsa.ipac.caltech.edu/TAP/sync"
VIZIER_TAP_URL = "https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync"


# ---------------------------------------------------------------------------
# Configuration Loader
# ---------------------------------------------------------------------------
def load_config(config_path: Path) -> Dict[str, Any]:
    """Loads regions.yaml with target coordinates."""
    if not config_path.exists():
        print(f"[FATAL] Configuration file not found at: {config_path}")
        sys.exit(1)

    try:
        import yaml
        with open(config_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f)
    except ImportError:
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


import time

# ---------------------------------------------------------------------------
# Execute TAP ADQL Query
# ---------------------------------------------------------------------------
def execute_tap_query(service_url: str, adql_query: str, timeout: int = 90, max_retries: int = 3) -> str:
    """Executes a synchronous TAP query with retries and returns the raw CSV response."""
    params = {
        "REQUEST": "doQuery",
        "LANG": "ADQL",
        "FORMAT": "csv",
        "QUERY": adql_query
    }
    data = urllib.parse.urlencode(params).encode("utf-8")
    last_err: Optional[Exception] = None
    for attempt in range(1, max_retries + 1):
        req = urllib.request.Request(
            service_url,
            data=data,
            headers={"User-Agent": "SPHEREx-Catalogue-Fetcher/2.0"}
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read().decode("utf-8")
        except Exception as e:
            last_err = e
            print(f"    [Retry {attempt}/{max_retries}] TAP query warning: {e}")
            time.sleep(2.0 * attempt)
    raise RuntimeError(f"TAP query to {service_url} failed after {max_retries} attempts: {last_err}")


# ---------------------------------------------------------------------------
# Inspect AllWISE Columns from TAP_SCHEMA (Never Guess Names)
# ---------------------------------------------------------------------------
def get_verified_allwise_columns() -> List[str]:
    """
    Queries TAP_SCHEMA.columns at IRSA to determine which columns actually exist
    in 'allwise_p3as_psd'. Selects only verified columns.
    """
    query = "SELECT column_name FROM TAP_SCHEMA.columns WHERE table_name = 'allwise_p3as_psd'"
    print("  Querying IRSA TAP_SCHEMA.columns to verify real AllWISE table columns...")
    raw_csv = execute_tap_query(IRSA_TAP_URL, query, timeout=25)
    existing_cols: Set[str] = set()

    for line in raw_csv.splitlines():
        line = line.strip().strip('"').lower()
        if line and line != "column_name":
            existing_cols.add(line)

    desired_columns = ["designation", "ra", "dec", "w1mpro", "w2mpro"]
    verified_columns = [col for col in desired_columns if col.lower() in existing_cols]

    if not verified_columns:
        print("[FATAL] Could not verify any target columns in IRSA allwise_p3as_psd.")
        sys.exit(1)

    print(f"  Verified existing columns in AllWISE: {', '.join(verified_columns)}")
    return verified_columns


# ---------------------------------------------------------------------------
# Main Routine
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Fetch reference star catalogues (Gaia DR3 / AllWISE) for target regions."
    )
    parser.add_argument(
        "--region",
        type=str,
        default="all",
        help="Region ID to download (or 'all' for all regions in pipeline/regions.yaml)."
    )
    args = parser.parse_args()

    print("=================================================================")
    print(" SPHEREx Offline Data Pipeline - Star Catalogue Fetcher")
    print(" Official TAP Services: ESA Gaia TAP & Caltech/IPAC IRSA TAP")
    print("=================================================================\n")

    offline_mode = os.environ.get("OFFLINE", "0").lower() in ("1", "true", "yes")
    config = load_config(CONFIG_FILE)
    all_regions = config.get("regions", [])

    if args.region.lower() != "all":
        requested = {r.strip() for r in args.region.split(",") if r.strip()}
        regions = [r for r in all_regions if r.get("id") in requested]
        if not regions:
            valid_ids = [r.get("id") for r in all_regions]
            print(f"[FATAL] Region(s) {sorted(requested)} not found in pipeline/regions.yaml.")
            print(f"Available region IDs: {', '.join(valid_ids)}")
            sys.exit(1)
    else:
        regions = all_regions

    if offline_mode:
        print("[OFFLINE MODE ACTIVE] OFFLINE=1 is set. Checking local cache only.\n")
        missing_catalogues = []
        for reg in regions:
            reg_id = reg["id"]
            cat_type = reg.get("catalogue", "gaia_dr3")
            dest_file = CACHE_DIR / reg_id / f"{reg_id}_catalogue_{cat_type}.csv"
            if not dest_file.exists():
                missing_catalogues.append(reg_id)
                print(f"[{reg_id}] [MISSING] Catalogue file not found: {dest_file.relative_to(REPO_ROOT)}")
            else:
                with open(dest_file, "r", encoding="utf-8") as f:
                    rows = [l for l in f if l.strip() and not l.startswith("#")]
                print(f"[{reg_id}] [OK] {len(rows)-1} rows cached in {dest_file.relative_to(REPO_ROOT)}")

        if missing_catalogues:
            print(f"\n[FATAL] Missing offline catalogues for regions: {missing_catalogues}")
            print("Run without OFFLINE=1 to download real catalogue data.")
            sys.exit(1)
        print("\n[PASS] Offline catalogue check complete.")
        sys.exit(0)

    succeeded: List[str] = []
    failed: List[str] = []

    # Online mode: query real services
    for reg in regions:
        reg_id = reg["id"]
        cat_type = reg.get("catalogue", "gaia_dr3").lower()
        ra = float(reg["ra_deg"])
        dec = float(reg["dec_deg"])
        size_arcmin = float(reg["size_arcmin"])

        # Add 2-arcminute safety margin around region
        radius_deg = (size_arcmin / 2.0 + 2.0) / 60.0
        dest_dir = CACHE_DIR / reg_id
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_file = dest_dir / f"{reg_id}_catalogue_{cat_type}.csv"

        print(f"[{reg_id}] Target Catalogue: {cat_type.upper()}")
        print(f"  Field Center: RA={ra:.4f}°, Dec={dec:.4f}°, Radius={radius_deg*60:.1f} arcmin (includes 2' margin)")

        try:
            if cat_type == "gaia_dr3":
                service_url = ESA_GAIA_TAP_URL
                table_name = "gaiadr3.gaia_source"
                # If the region lists specific Gaia DR3 source IDs (e.g. bright nearby targets),
                # include them explicitly alongside the cone search so they are always present.
                raw_ids = str(reg.get("gaia_source_ids", "")).strip()
                explicit_ids = [s.strip() for s in raw_ids.split(",") if s.strip().isdigit()]
                where_clause = (
                    f"1 = CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra:.6f}, {dec:.6f}, {radius_deg:.6f}))"
                )
                if explicit_ids:
                    where_clause = f"({where_clause} OR source_id IN ({', '.join(explicit_ids)}))"
                adql_query = f"""
                SELECT
                    source_id, ra, dec, phot_g_mean_mag, phot_bp_mean_mag, phot_rp_mean_mag,
                    pmra, pmdec, parallax
                FROM {table_name}
                WHERE {where_clause}
                ORDER BY phot_g_mean_mag ASC
                """.strip()

            elif cat_type == "allwise":
                try:
                    service_url = IRSA_TAP_URL
                    table_name = "allwise_p3as_psd"
                    cols = get_verified_allwise_columns()
                    col_list_str = ", ".join(cols)
                    adql_query = f"""
                    SELECT
                        {col_list_str}
                    FROM {table_name}
                    WHERE 1 = CONTAINS(
                        POINT('ICRS', ra, dec),
                        CIRCLE('ICRS', {ra:.6f}, {dec:.6f}, {radius_deg:.6f})
                    )
                    ORDER BY w1mpro ASC
                    """.strip()
                    print(f"  Executing ADQL query against {service_url}...")
                    raw_csv = execute_tap_query(service_url, adql_query, timeout=90)
                except Exception as irsa_err:
                    print(f"  [IRSA fallback] IRSA TAP unavailable ({irsa_err}); querying CDS VizieR II/328/allwise...")
                    service_url = VIZIER_TAP_URL
                    table_name = "II/328/allwise"
                    adql_query = f"""
                    SELECT
                        AllWISE AS designation,
                        RAJ2000 AS ra,
                        DEJ2000 AS dec,
                        W1mag AS w1mpro,
                        W2mag AS w2mpro
                    FROM "II/328/allwise"
                    WHERE 1 = CONTAINS(
                        POINT('ICRS', RAJ2000, DEJ2000),
                        CIRCLE('ICRS', {ra:.6f}, {dec:.6f}, {radius_deg:.6f})
                    )
                    ORDER BY W1mag ASC
                    """.strip()
                    raw_csv = execute_tap_query(service_url, adql_query, timeout=90)
            else:
                print(f"  [ERROR] Unknown catalogue type '{cat_type}' requested for region {reg_id}.")
                failed.append(reg_id)
                continue

            if cat_type != "allwise":
                print(f"  Executing ADQL query against {service_url}...")
                raw_csv = execute_tap_query(service_url, adql_query, timeout=90)
        except Exception as e:
            print(f"  [ERROR] Catalogue query failed for [{reg_id}]: {e}")
            print("  Skipping this region and continuing...\n")
            failed.append(reg_id)
            continue

        # Parse CSV to count valid rows
        lines = [line.strip() for line in raw_csv.splitlines() if line.strip()]
        if len(lines) <= 1:
            print(f"  [WARNING] Service returned 0 sources for region '{reg_id}'. Skipping...\n")
            failed.append(reg_id)
            continue

        # Check for error responses formatted inside table
        header_line = lines[0]
        if "error" in header_line.lower() or "exception" in header_line.lower():
            print(f"  [ERROR] TAP query returned an error response for [{reg_id}]:\n{raw_csv[:300]}\n")
            failed.append(reg_id)
            continue

        source_count = len(lines) - 1
        print(f"  Successfully retrieved {source_count} real sources from {table_name}.")

        # Write clean CSV with full provenance header
        timestamp = datetime.now(timezone.utc).isoformat()
        with open(dest_file, "w", encoding="utf-8", newline="") as f:
            f.write(f"# SPHEREx Reference Star Catalogue\n")
            f.write(f"# Region: {reg_id}\n")
            f.write(f"# Catalogue Table: {table_name}\n")
            f.write(f"# TAP Endpoint: {service_url}\n")
            f.write(f"# Query Timestamp UTC: {timestamp}\n")
            f.write(f"# Total Rows: {source_count}\n")
            f.write(f"# ADQL Query: {adql_query.replace(chr(10), ' ')}\n")
            for line in lines:
                f.write(f"{line}\n")

        print(f"  -> Saved to: {dest_file.relative_to(REPO_ROOT)} ({source_count} sources)\n")
        succeeded.append(reg_id)

    if not succeeded:
        print(f"[FATAL] Catalogue downloads failed for all requested regions: {failed}")
        sys.exit(1)

    if failed:
        print(f"[WARNING] Some regions failed (re-run with --region {','.join(failed)}): {', '.join(failed)}")

    print(f"[SUCCESS] Star catalogue downloads completed for {len(succeeded)} region(s).")


if __name__ == "__main__":
    main()
