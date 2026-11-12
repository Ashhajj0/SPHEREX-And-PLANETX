#!/usr/bin/env python3
"""
backend/compute/diagnose_dips.py
================================
Diagnostic script to inspect spectral dips in the brightest sources.

Finds points whose flux is below 0.6 times the median of the 4 nearest points
in wavelength. Prints exposure id, wavelength, flux, aperture pixel diagnostics,
and whether the dip was flagged as 'suspect'.

Usage:
  python -m backend.compute.diagnose_dips
"""

import sys
import json
from pathlib import Path
from typing import Dict, List, Any, Optional

try:
    import numpy as np
except ImportError:
    np = None


REPO_ROOT = Path(__file__).resolve().parent.parent.parent
REAL_DIR_CANDIDATES = [
    REPO_ROOT / "web" / "public" / "real",
    REPO_ROOT / "public" / "real",
]


def find_dips_for_source(
    source_id: str,
    points: List[Dict[str, Any]],
    threshold_ratio: float = 0.6,
    num_neighbors: int = 4
) -> List[Dict[str, Any]]:
    """
    Identifies photometric points whose flux is < threshold_ratio * median(num_neighbors nearest points).
    """
    valid_points = [p for p in points if p.get("flux_uJy") is not None and p.get("wavelength_um") is not None]
    if len(valid_points) < num_neighbors + 1:
        return []

    # Sort ascending by wavelength
    valid_points.sort(key=lambda p: float(p["wavelength_um"]))

    dips = []
    for i, pt in enumerate(valid_points):
        w_i = float(pt["wavelength_um"])
        f_i = float(pt["flux_uJy"])

        # Compute distances in wavelength to all other points
        neighbors_with_dist = []
        for j, other in enumerate(valid_points):
            if i == j:
                continue
            w_j = float(other["wavelength_um"])
            dist = abs(w_j - w_i)
            neighbors_with_dist.append((dist, float(other["flux_uJy"])))

        neighbors_with_dist.sort(key=lambda item: item[0])
        nearest_fluxes = [item[1] for item in neighbors_with_dist[:num_neighbors]]

        if np is not None:
            med_flux = float(np.median(nearest_fluxes))
        else:
            sorted_f = sorted(nearest_fluxes)
            n_mid = len(sorted_f) // 2
            med_flux = sorted_f[n_mid] if len(sorted_f) % 2 == 1 else (sorted_f[n_mid - 1] + sorted_f[n_mid]) / 2.0

        if med_flux > 0 and (f_i < threshold_ratio * med_flux):
            dips.append({
                "source_id": source_id,
                "exposure_id": pt.get("exposure_id", "Unknown"),
                "wavelength_um": pt.get("wavelength_um"),
                "flux_uJy": pt.get("flux_uJy"),
                "median_neighbor_flux": round(med_flux, 2),
                "ratio_to_median": round(f_i / med_flux, 3),
                "n_aperture_pixels": pt.get("n_aperture_pixels", 0),
                "n_flagged_in_aperture": pt.get("n_flagged_in_aperture", 0),
                "edge_distance_pix": pt.get("edge_distance_pix"),
                "peak_pixel_flagged": pt.get("peak_pixel_flagged", False),
                "quality": pt.get("quality", "ok"),
                "quality_reasons": pt.get("quality_reasons", [])
            })

    return dips


def run_diagnostics(
    sources: Optional[List[Dict[str, Any]]] = None,
    spectra: Optional[Dict[str, List[Dict[str, Any]]]] = None,
    num_top_sources: int = 5
) -> Dict[str, Any]:
    """
    Runs spectral dip diagnostics on the top N brightest sources.
    Can be called directly from Python code or from the command line.
    """
    print("\n=================================================================")
    print(" SPECTRAL DIP DIAGNOSTICS (Top 5 Brightest Sources)")
    print("=================================================================")

    # Load from disk if not provided
    if sources is None or spectra is None:
        real_dir = None
        for cand in REAL_DIR_CANDIDATES:
            if (cand / "sources.json").exists() and (cand / "spectra.json").exists():
                real_dir = cand
                break

        if real_dir is None:
            print("[INFO] No real exported dataset found on disk to diagnose dips.")
            return {"total_dips": 0, "suspect_dips": 0}

        with open(real_dir / "sources.json", "r", encoding="utf-8") as f:
            src_data = json.load(f)
            sources = src_data if isinstance(src_data, list) else src_data.get("sources", [])

        with open(real_dir / "spectra.json", "r", encoding="utf-8") as f:
            spectra = json.load(f)

    # Pick top N brightest sources by peak_snr or ID
    def source_sort_key(s: Any) -> float:
        if isinstance(s, dict):
            return float(s.get("peak_snr", 0.0) or 0.0)
        return getattr(s, "peak_snr", 0.0) or 0.0

    sorted_sources = sorted(sources, key=source_sort_key, reverse=True)
    top_sources = sorted_sources[:num_top_sources]

    total_dips = 0
    suspect_dips = 0

    for s in top_sources:
        s_id = s.get("id") if isinstance(s, dict) else s.id
        pts = spectra.get(s_id, [])
        dips = find_dips_for_source(s_id, pts)

        print(f"\n--- Source {s_id} (Peak SNR: {s.get('peak_snr') if isinstance(s, dict) else s.peak_snr}) ---")
        if not dips:
            print("  No dips detected below 0.6x local wavelength median.")
            continue

        for d in dips:
            total_dips += 1
            is_suspect = (d["quality"] == "suspect")
            if is_suspect:
                suspect_dips += 1

            flag_status = "FLAGGED" if d["peak_pixel_flagged"] else "clean"
            reasons_str = ", ".join(d["quality_reasons"]) if d["quality_reasons"] else "none"

            print(
                f"  * {d['exposure_id']} | {d['wavelength_um']} um | Flux: {d['flux_uJy']} uJy "
                f"(local med: {d['median_neighbor_flux']}, ratio: {d['ratio_to_median']}) | "
                f"N_ap: {d['n_aperture_pixels']} | N_bad: {d['n_flagged_in_aperture']} | "
                f"Edge: {d['edge_distance_pix']} pix | Peak: {flag_status} | "
                f"Quality: [{d['quality'].upper()}] ({reasons_str})"
            )

    print("\n-----------------------------------------------------------------")
    pct_suspect = (suspect_dips / total_dips * 100.0) if total_dips > 0 else 0.0
    print(f"Total dips below 0.6x median : {total_dips}")
    print(f"Marked as suspect           : {suspect_dips} / {total_dips} ({pct_suspect:.1f}%)")
    print("-----------------------------------------------------------------\n")

    return {
        "total_dips": total_dips,
        "suspect_dips": suspect_dips,
        "pct_suspect": pct_suspect
    }


def main():
    run_diagnostics()


if __name__ == "__main__":
    main()
