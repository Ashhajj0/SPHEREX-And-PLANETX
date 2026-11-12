#!/usr/bin/env python3
"""
build_provenance.py
===================
Generates the authoritative data/provenance.json file detailing scientific provenance,
archive collection parameters, and file integrity checksums.

Strict rules:
1. Strictly separates 'real_files' from 'fixtures'.
2. NEVER lists a fixture under 'real_files'.
3. For each real file records: URL, SHA-256 checksum, size_bytes, collection 'spherex_qr2'.
4. For catalogues records the exact service URLs and ADQL queries.
"""

import os
import sys
import json
import hashlib
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, List, Any

REPO_ROOT = Path(__file__).resolve().parent.parent
CACHE_SPHEREX = REPO_ROOT / "cache" / "spherex"
CACHE_CATALOGUE = REPO_ROOT / "cache" / "catalogue"
FIXTURES_DIR = REPO_ROOT / "demo_fixtures"
CONFIG_FILE = REPO_ROOT / "pipeline" / "regions.yaml"
OUTPUT_PROVENANCE = REPO_ROOT / "data" / "provenance.json"


def calculate_sha256(file_path: Path) -> str:
    """Computes SHA-256 hash of a file."""
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def extract_catalogue_metadata(csv_path: Path) -> Dict[str, str]:
    """Reads metadata comments from the top of a catalogue CSV."""
    meta = {
        "service_url": "unknown",
        "adql_query": "unknown",
        "table_name": "unknown"
    }
    with open(csv_path, "r", encoding="utf-8") as f:
        for line in f:
            if not line.startswith("#"):
                break
            line_str = line.strip("# \r\n")
            if line_str.startswith("TAP Endpoint:"):
                meta["service_url"] = line_str.split(":", 1)[1].strip()
            elif line_str.startswith("ADQL Query:"):
                meta["adql_query"] = line_str.split(":", 1)[1].strip()
            elif line_str.startswith("Catalogue Table:"):
                meta["table_name"] = line_str.split(":", 1)[1].strip()
    return meta


def main():
    print("=================================================================")
    print(" SPHEREx Provenance Builder")
    print(" Writing scientific pedigree to data/provenance.json")
    print("=================================================================\n")

    real_files: List[Dict[str, Any]] = []
    fixtures: List[Dict[str, Any]] = []

    # 1. Process real SPHEREx cutouts in cache/spherex
    if CACHE_SPHEREX.exists():
        for region_dir in sorted(CACHE_SPHEREX.iterdir()):
            if not region_dir.is_dir():
                continue
            manifest_path = region_dir / "manifest.json"
            manifest_map = {}
            if manifest_path.exists():
                try:
                    with open(manifest_path, "r", encoding="utf-8") as mf:
                        for entry in json.load(mf):
                            manifest_map[entry.get("file_name")] = entry
                except Exception:
                    pass

            for f in sorted(region_dir.glob("*.fits")):
                if f.name.startswith("fixture_"):
                    continue
                m_info = manifest_map.get(f.name, {})
                source_url = m_info.get("source_url", f"https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/{f.name}")
                real_files.append({
                    "file_type": "SPHEREx_FITS_cutout",
                    "file_name": f.name,
                    "region": region_dir.name,
                    "collection": "spherex_qr2",
                    "release": "QR2",
                    "doi": "10.26131/IRSA652",
                    "relative_path": str(f.relative_to(REPO_ROOT)),
                    "size_bytes": f.stat().st_size,
                    "sha256": calculate_sha256(f),
                    "source_url": source_url,
                    "observation_time": m_info.get("observation_time"),
                    "detector": m_info.get("detector"),
                    "central_wavelength_um": m_info.get("central_wavelength_um")
                })

    # 2. Process real catalogue CSVs in cache/catalogue
    if CACHE_CATALOGUE.exists():
        for region_dir in sorted(CACHE_CATALOGUE.iterdir()):
            if not region_dir.is_dir():
                continue
            for f in sorted(region_dir.glob("*.csv")):
                if f.name.startswith("fixture_"):
                    continue
                meta = extract_catalogue_metadata(f)
                real_files.append({
                    "file_type": "reference_catalogue_csv",
                    "file_name": f.name,
                    "region": region_dir.name,
                    "relative_path": str(f.relative_to(REPO_ROOT)),
                    "size_bytes": f.stat().st_size,
                    "sha256": calculate_sha256(f),
                    "service_url": meta["service_url"],
                    "catalogue_table": meta["table_name"],
                    "adql_query": meta["adql_query"]
                })

    # 3. Process fixtures in demo_fixtures
    if FIXTURES_DIR.exists():
        for f in sorted(FIXTURES_DIR.glob("**/*")):
            if f.is_file() and not f.name.startswith("."):
                fixtures.append({
                    "file_name": f.name,
                    "relative_path": str(f.relative_to(REPO_ROOT)),
                    "size_bytes": f.stat().st_size,
                    "sha256": calculate_sha256(f),
                    "is_fixture": True
                })

    provenance_doc = {
        "mission": "NASA SPHEREx (Spectro-Photometer for the History of the Universe, Epoch of Reionization, and Ices Explorer)",
        "release": "QR2",
        "doi": "10.26131/IRSA652",
        "archive_host": "Caltech / IPAC Infrared Science Archive (IRSA)",
        "catalogue_services": {
            "gaia_dr3": "https://gea.esac.esa.int/tap-server/tap",
            "allwise": "https://irsa.ipac.caltech.edu/TAP"
        },
        "generated_timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "total_real_files": len(real_files),
            "total_fixtures": len(fixtures)
        },
        "real_files": real_files,
        "fixtures": fixtures
    }

    OUTPUT_PROVENANCE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PROVENANCE, "w", encoding="utf-8") as f:
        json.dump(provenance_doc, f, indent=2)

    print(f"[SUCCESS] Wrote provenance record to: {OUTPUT_PROVENANCE.relative_to(REPO_ROOT)}")
    print(f"  Real files indexed: {len(real_files)}")
    print(f"  Fixtures indexed: {len(fixtures)}")


if __name__ == "__main__":
    main()
