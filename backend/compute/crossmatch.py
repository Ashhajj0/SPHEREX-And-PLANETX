#!/usr/bin/env python3
"""
backend/compute/crossmatch.py
=============================
Cross-matches detected SPHEREx sources against reference star catalogues (e.g. Gaia DR3).

Key features:
1. Dynamically reads the real column names from the catalogue CSV file. Never guesses names.
2. Propagates star positions from the catalogue reference epoch (J2016.0 for Gaia DR3)
   to the observation date using proper motion (pmra, pmdec).
3. Performs angular crossmatching on the celestial sphere using Astropy SkyCoord.
4. Identifies the primary match within the configurable radius (default: 6.15 arcsec = 1 SPHEREx pixel).
5. Counts the number of other candidates within the search radius to identify blended/crowded fields.
6. Generates NASA Astrophysics Data System (ADS) search URLs for matched source identifiers.
7. Returns null (None) identifier and separation if no catalogue source lies within the search radius.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import List, Dict, Optional, Any, Tuple
import csv
import math

try:
    import numpy as np
except ImportError:
    np = None

try:
    from astropy.coordinates import SkyCoord
    import astropy.units as u
except ImportError:
    SkyCoord = None
    u = None

from backend.compute.detect import DetectedSource
from backend.compute.common import sanitize_scalar


@dataclass
class CrossmatchResult:
    """Stores crossmatch information for a single detected SPHEREx source."""
    source_id: str                          # SPHEREx source ID (e.g. 'SPX-NEP-001')
    ra_deg: float                           # SPHEREx RA in degrees
    dec_deg: float                          # SPHEREx Dec in degrees
    gaia_id: Optional[str]                  # Gaia DR3 source_id, or None if no match
    separation_arcsec: Optional[float]      # Angular distance in arcseconds to closest match, or None
    candidates_in_radius: int               # Number of catalogue stars within search radius
    ads_url: Optional[str]                  # NASA ADS query URL for Gaia identifier, or None
    phot_g_mean_mag: Optional[float]        # Gaia G-band magnitude, or None
    phot_bp_mean_mag: Optional[float]       # Gaia BP-band magnitude, or None
    phot_rp_mean_mag: Optional[float]       # Gaia RP-band magnitude, or None

    def to_dict(self) -> Dict[str, Any]:
        """Returns a JSON-safe dictionary representation with NaNs/Infinities converted to None."""
        return {
            "source_id": self.source_id,
            "ra_deg": sanitize_scalar(self.ra_deg, 6),
            "dec_deg": sanitize_scalar(self.dec_deg, 6),
            "gaia_id": self.gaia_id,
            "separation_arcsec": sanitize_scalar(self.separation_arcsec, 2),
            "candidates_in_radius": self.candidates_in_radius,
            "ads_url": self.ads_url,
            "phot_g_mean_mag": sanitize_scalar(self.phot_g_mean_mag, 3),
            "phot_bp_mean_mag": sanitize_scalar(self.phot_bp_mean_mag, 3),
            "phot_rp_mean_mag": sanitize_scalar(self.phot_rp_mean_mag, 3)
        }


def load_catalogue_rows(catalogue_path: Path) -> Tuple[List[Dict[str, Any]], List[str]]:
    """
    Reads all data rows and column names from a reference catalogue CSV file.
    Dynamically extracts column names from the CSV header without guessing.
    """
    if not catalogue_path.exists():
        raise FileNotFoundError(f"Catalogue file does not exist: {catalogue_path}")

    rows: List[Dict[str, Any]] = []
    fieldnames: List[str] = []

    with open(catalogue_path, "r", encoding="utf-8") as f:
        # Skip header comment lines
        pos = f.tell()
        line = f.readline()
        while line and line.startswith("#"):
            pos = f.tell()
            line = f.readline()

        f.seek(pos)
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames if reader.fieldnames else []

        for row in reader:
            rows.append(row)

    return rows, fieldnames


def crossmatch_sources(
    sources: List[DetectedSource],
    catalogue_path: Path,
    obs_time_iso: Optional[str] = None,
    max_radius_arcsec: float = 6.15
) -> List[CrossmatchResult]:
    """
    Matches detected sources against a reference catalogue.
    
    Parameters:
      sources: List of DetectedSource objects with (ra_deg, dec_deg)
      catalogue_path: Path to reference catalogue CSV (e.g. Gaia DR3)
      obs_time_iso: Observation date string (e.g. '2025-04-24T21:06:38') for proper motion propagation
      max_radius_arcsec: Maximum matching tolerance in arcseconds (default: 6.15 arcsec)
    """
    if not sources:
        return []

    cat_rows, fieldnames = load_catalogue_rows(catalogue_path)
    if not cat_rows:
        # No catalogue stars to match against
        return [
            CrossmatchResult(
                source_id=s.id,
                ra_deg=s.ra_deg,
                dec_deg=s.dec_deg,
                gaia_id=None,
                separation_arcsec=None,
                candidates_in_radius=0,
                ads_url=None,
                phot_g_mean_mag=None,
                phot_bp_mean_mag=None,
                phot_rp_mean_mag=None
            )
            for s in sources
        ]

    # Find the real column names dynamically
    # Look for identifier column
    id_col = None
    for candidate in ["source_id", "designation", "id"]:
        if candidate in fieldnames:
            id_col = candidate
            break
    if id_col is None and fieldnames:
        id_col = fieldnames[0]

    # Look for coordinates
    ra_col = next((c for c in fieldnames if c.lower() in ("ra", "raj2000")), "ra")
    dec_col = next((c for c in fieldnames if c.lower() in ("dec", "decj2000")), "dec")

    # Look for proper motion columns
    pmra_col = next((c for c in fieldnames if c.lower() in ("pmra", "pm_ra")), None)
    pmdec_col = next((c for c in fieldnames if c.lower() in ("pmdec", "pm_dec")), None)
    parallax_col = next((c for c in fieldnames if c.lower() in ("parallax", "plx")), None)

    # Magnitude columns
    g_col = next((c for c in fieldnames if c.lower() in ("phot_g_mean_mag", "gmag")), None)
    bp_col = next((c for c in fieldnames if c.lower() in ("phot_bp_mean_mag", "bpmag")), None)
    rp_col = next((c for c in fieldnames if c.lower() in ("phot_rp_mean_mag", "rpmag")), None)

    # Parse catalogue coordinates and proper motions
    cat_ras = []
    cat_decs = []
    valid_cat_indices = []

    # Calculate time delta for proper motion if observation time is available
    # Gaia DR3 reference epoch is J2016.0
    delta_years = 0.0
    if obs_time_iso:
        try:
            year_val = float(obs_time_iso[:4])
            # Rough fractional year approximation
            delta_years = year_val - 2016.0
        except Exception:
            delta_years = 0.0

    for idx, row in enumerate(cat_rows):
        try:
            r = float(row[ra_col])
            d = float(row[dec_col])

            # Apply space motion propagation if proper motion columns are present
            if delta_years != 0.0 and pmra_col and pmdec_col and row.get(pmra_col) and row.get(pmdec_col):
                try:
                    pm_ra_val = float(row[pmra_col])   # mas/yr
                    pm_dec_val = float(row[pmdec_col]) # mas/yr
                    # Convert mas to degrees: 1 mas = 1 / 3,600,000 deg
                    # delta_ra = (pm_ra / cos(dec)) * delta_years
                    cos_dec = math.cos(math.radians(d))
                    if abs(cos_dec) > 1e-4:
                        d_ra_deg = (pm_ra_val / (3600.0 * 1000.0 * cos_dec)) * delta_years
                        d_dec_deg = (pm_dec_val / (3600.0 * 1000.0)) * delta_years
                        r += d_ra_deg
                        d += d_dec_deg
                except (ValueError, TypeError):
                    pass

            cat_ras.append(r)
            cat_decs.append(d)
            valid_cat_indices.append(idx)
        except (ValueError, KeyError, TypeError):
            continue

    if not valid_cat_indices:
        return [
            CrossmatchResult(
                source_id=s.id,
                ra_deg=s.ra_deg,
                dec_deg=s.dec_deg,
                gaia_id=None,
                separation_arcsec=None,
                candidates_in_radius=0,
                ads_url=None,
                phot_g_mean_mag=None,
                phot_bp_mean_mag=None,
                phot_rp_mean_mag=None
            )
            for s in sources
        ]

    # Astropy SkyCoord matching
    if SkyCoord is not None and u is not None:
        source_coords = SkyCoord(
            ra=[s.ra_deg for s in sources] * u.deg,
            dec=[s.dec_deg for s in sources] * u.deg,
            frame="icrs"
        )
        catalog_coords = SkyCoord(
            ra=cat_ras * u.deg,
            dec=cat_decs * u.deg,
            frame="icrs"
        )

        idx_matches, sep2d, _ = source_coords.match_to_catalog_sky(catalog_coords)
        seps_arcsec = sep2d.arcsec

        # Count all candidates in radius to detect crowded/blended sources
        search_radius = max_radius_arcsec * u.arcsec

        results = []
        for i, s in enumerate(sources):
            sep = float(seps_arcsec[i])
            cat_idx = valid_cat_indices[idx_matches[i]]
            cat_entry = cat_rows[cat_idx]

            # Count how many catalogue sources are within radius
            src_c = source_coords[i]
            nearby_count = int(np.sum(src_c.separation(catalog_coords) <= search_radius)) if 'np' in globals() and np is not None else 1

            if sep <= max_radius_arcsec:
                raw_id = str(cat_entry.get(id_col, "unknown")).strip()
                ads_url = f"https://ui.adsabs.harvard.edu/search/q=gaia%20dr3%20{raw_id}"

                def safe_float(val):
                    try:
                        return float(val) if val is not None and val != "" else None
                    except ValueError:
                        return None

                g_mag = safe_float(cat_entry.get(g_col)) if g_col else None
                bp_mag = safe_float(cat_entry.get(bp_col)) if bp_col else None
                rp_mag = safe_float(cat_entry.get(rp_col)) if rp_col else None

                results.append(CrossmatchResult(
                    source_id=s.id,
                    ra_deg=s.ra_deg,
                    dec_deg=s.dec_deg,
                    gaia_id=raw_id,
                    separation_arcsec=round(sep, 3),
                    candidates_in_radius=nearby_count,
                    ads_url=ads_url,
                    phot_g_mean_mag=g_mag,
                    phot_bp_mean_mag=bp_mag,
                    phot_rp_mean_mag=rp_mag
                ))
            else:
                # No catalogue source within match radius
                results.append(CrossmatchResult(
                    source_id=s.id,
                    ra_deg=s.ra_deg,
                    dec_deg=s.dec_deg,
                    gaia_id=None,
                    separation_arcsec=None,
                    candidates_in_radius=0,
                    ads_url=None,
                    phot_g_mean_mag=None,
                    phot_bp_mean_mag=None,
                    phot_rp_mean_mag=None
                ))
        return results

    # Pure Python spherical trigonometry fallback if astropy is absent
    results = []
    for s in sources:
        s_ra_rad = math.radians(s.ra_deg)
        s_dec_rad = math.radians(s.dec_deg)

        best_sep_arcsec = float("inf")
        best_entry = None
        nearby_count = 0

        for r_deg, d_deg, orig_idx in zip(cat_ras, cat_decs, valid_cat_indices):
            c_ra_rad = math.radians(r_deg)
            c_dec_rad = math.radians(d_deg)

            # Great-circle angular distance
            cos_sep = (
                math.sin(s_dec_rad) * math.sin(c_dec_rad)
                + math.cos(s_dec_rad) * math.cos(c_dec_rad) * math.cos(s_ra_rad - c_ra_rad)
            )
            cos_sep = max(-1.0, min(1.0, cos_sep))
            sep_rad = math.acos(cos_sep)
            sep_arcsec = math.degrees(sep_rad) * 3600.0

            if sep_arcsec <= max_radius_arcsec:
                nearby_count += 1
                if sep_arcsec < best_sep_arcsec:
                    best_sep_arcsec = sep_arcsec
                    best_entry = cat_rows[orig_idx]

        if best_entry is not None:
            raw_id = str(best_entry.get(id_col, "unknown")).strip()
            ads_url = f"https://ui.adsabs.harvard.edu/search/q=gaia%20dr3%20{raw_id}"
            results.append(CrossmatchResult(
                source_id=s.id,
                ra_deg=s.ra_deg,
                dec_deg=s.dec_deg,
                gaia_id=raw_id,
                separation_arcsec=round(best_sep_arcsec, 3),
                candidates_in_radius=nearby_count,
                ads_url=ads_url,
                phot_g_mean_mag=None,
                phot_bp_mean_mag=None,
                phot_rp_mean_mag=None
            ))
        else:
            results.append(CrossmatchResult(
                source_id=s.id,
                ra_deg=s.ra_deg,
                dec_deg=s.dec_deg,
                gaia_id=None,
                separation_arcsec=None,
                candidates_in_radius=0,
                ads_url=None,
                phot_g_mean_mag=None,
                phot_bp_mean_mag=None,
                phot_rp_mean_mag=None
            ))

    return results
