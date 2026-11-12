#!/usr/bin/env python3
"""
backend/compute/spectrum.py
===========================
Constructs a calibrated multi-band spectrum (Spectral Energy Distribution)
for a celestial source from a series of SPHEREx exposure cutouts.

Core Principles:
1. Each SPHEREx exposure provides ONE spectral measurement at the wavelength
   where the source lands on the Linear Variable Filter (LVF).
2. The full spectrum is built by measuring the source across all overlapping
   exposures and sorting the resulting points by wavelength.
3. Missing or unusable data is represented as null (None), never zero, never interpolated.
4. Every null point carries an explicit reason ('outside image', 'too few good pixels', 'no variance').
5. Null points are preserved in the returned point list so coverage gaps are transparent.
"""

from dataclasses import dataclass, field
from typing import List, Dict, Optional, Any
import math

from backend.compute.common import sanitize_scalar
from backend.compute.exposure import Exposure
from backend.compute.photometry import measure_source, PhotometryResult
from backend.compute.detect import DetectedSource


def spectrum_point_sort_key(point: Any) -> float:
    """
    Sort key for spectral points: ascends by central wavelength (micrometers).
    Points with an unknown (None / NaN / Inf) wavelength go last (infinity).
    Never crashes on None, non-numeric types, or dictionaries.
    """
    if point is None:
        return float("inf")
    wave = getattr(point, "wavelength_um", None)
    if wave is None and isinstance(point, dict):
        wave = point.get("wavelength_um")
    if wave is None:
        return float("inf")
    try:
        w = float(wave)
        if math.isnan(w) or math.isinf(w):
            return float("inf")
        return w
    except (ValueError, TypeError):
        return float("inf")


def sort_spectrum_points(points: List[Any]) -> List[Any]:
    """
    Single canonical sorting function for spectrum points.
    Used by both build_spectrum and the exporter.
    Ascending wavelength, stable, points with None or NaN wavelength last, never crashes.
    """
    return sorted(points, key=spectrum_point_sort_key)


# Backward-compatible alias
sort_spectral_points = sort_spectrum_points


@dataclass
class SpectralPoint:
    """A single spectrophotometric measurement from one SPHEREx exposure."""
    exposure_file: str
    detector: int
    observation_time: str
    wavelength_um: Optional[float]
    bandwidth_um: Optional[float]
    flux_uJy: Optional[float]
    flux_err_uJy: Optional[float]
    null_reason: Optional[str]
    solid_angle_kind: str
    n_good_pixels: int
    n_background_pixels: int = 0
    n_aperture_pixels: int = 0
    n_flagged_in_aperture: int = 0
    n_flagged_extra_in_aperture: int = 0
    edge_distance_pix: Optional[float] = None
    peak_pixel_flagged: bool = False
    quality: str = "ok"
    quality_reasons: List[str] = field(default_factory=list)

    def to_dict(self, exposure_id: Optional[str] = None) -> Dict[str, Any]:
        """Returns a JSON-safe dictionary representation with NaNs/Infinities converted to None."""
        return {
            "exposure_id": exposure_id or self.exposure_file,
            "exposure_file": self.exposure_file,
            "detector": self.detector,
            "observation_time": self.observation_time,
            "time_utc": self.observation_time,
            "wavelength_um": sanitize_scalar(self.wavelength_um, 4),
            "bandwidth_um": sanitize_scalar(self.bandwidth_um, 4),
            "flux_uJy": sanitize_scalar(self.flux_uJy, 3),
            "flux_err_uJy": sanitize_scalar(self.flux_err_uJy, 3),
            "n_good_pixels": self.n_good_pixels,
            "n_background_pixels": self.n_background_pixels,
            "n_aperture_pixels": self.n_aperture_pixels,
            "n_flagged_in_aperture": self.n_flagged_in_aperture,
            "n_flagged_extra_in_aperture": self.n_flagged_extra_in_aperture,
            "edge_distance_pix": sanitize_scalar(self.edge_distance_pix, 2),
            "peak_pixel_flagged": self.peak_pixel_flagged,
            "quality": self.quality,
            "quality_reasons": list(self.quality_reasons),
            "null_reason": self.null_reason,
            "solid_angle_kind": self.solid_angle_kind
        }


@dataclass
class Spectrum:
    """Complete multi-wavelength spectrum for a celestial target."""
    source_id: str
    ra_deg: float
    dec_deg: float
    points: List[SpectralPoint]
    summary: Dict[str, Any]

    def __post_init__(self):
        # Guarantee points are always sorted ascending by wavelength upon instantiation
        self.points = sort_spectrum_points(self.points)

    def to_dict(self) -> Dict[str, Any]:
        """Converts spectrum to a JSON-safe dictionary, ensuring points are sorted ascending by wavelength."""
        sorted_pts = sort_spectrum_points(self.points)
        return {
            "source_id": self.source_id,
            "ra_deg": sanitize_scalar(self.ra_deg, 6),
            "dec_deg": sanitize_scalar(self.dec_deg, 6),
            "summary": {k: (sanitize_scalar(v, 4) if isinstance(v, float) else v) for k, v in self.summary.items()},
            "points": [p.to_dict() if hasattr(p, "to_dict") else p for p in sorted_pts]
        }


def build_spectrum(
    source: DetectedSource,
    exposures: List[Exposure],
    r_aperture_pix: float = 2.0,
    annulus_pix: tuple = (4.0, 6.0)
) -> Spectrum:
    """
    Measures the source across all provided exposures and builds a sorted spectrum.
    
    Parameters:
      source: DetectedSource with coordinates (ra_deg, dec_deg)
      exposures: List of Exposure objects covering the field
      r_aperture_pix: Radius of circular aperture in pixels (default 2.0)
      annulus_pix: (inner, outer) radius of background annulus (default 4.0, 6.0)
    """
    raw_points: List[SpectralPoint] = []

    for exp in exposures:
        res: PhotometryResult = measure_source(
            exposure=exp,
            ra_deg=source.ra_deg,
            dec_deg=source.dec_deg,
            r_aperture_pix=r_aperture_pix,
            annulus_pix=annulus_pix
        )

        pt = SpectralPoint(
            exposure_file=exp.file_name,
            detector=exp.detector,
            observation_time=exp.time,
            wavelength_um=res.wavelength_um,
            bandwidth_um=res.bandwidth_um,
            flux_uJy=res.flux_uJy,
            flux_err_uJy=res.flux_err_uJy,
            null_reason=res.null_reason,
            solid_angle_kind=res.solid_angle_kind,
            n_good_pixels=res.n_good_pixels,
            n_background_pixels=res.n_background_pixels,
            n_aperture_pixels=res.n_aperture_pixels,
            n_flagged_in_aperture=res.n_flagged_in_aperture,
            n_flagged_extra_in_aperture=res.n_flagged_extra_in_aperture,
            edge_distance_pix=res.edge_distance_pix,
            peak_pixel_flagged=res.peak_pixel_flagged,
            quality=res.quality,
            quality_reasons=res.quality_reasons
        )
        raw_points.append(pt)

    # Sort points by central wavelength ascending using the canonical sort function
    sorted_points = sort_spectrum_points(raw_points)

    # Calculate spectrum summary statistics
    total_count = len(sorted_points)
    valid_points = [p for p in sorted_points if p.flux_uJy is not None]
    valid_count = len(valid_points)
    null_count = total_count - valid_count
    unplaceable_count = sum(1 for p in sorted_points if p.wavelength_um is None)
    suspect_count = sum(1 for p in sorted_points if p.quality == "suspect")

    valid_waves = [p.wavelength_um for p in valid_points if p.wavelength_um is not None]
    wave_min = min(valid_waves) if valid_waves else None
    wave_max = max(valid_waves) if valid_waves else None

    # Count breakdown of null reasons
    null_breakdown: Dict[str, int] = {}
    for p in sorted_points:
        if p.null_reason:
            null_breakdown[p.null_reason] = null_breakdown.get(p.null_reason, 0) + 1

    # Count breakdown of suspect reasons
    suspect_reasons_breakdown: Dict[str, int] = {}
    for p in sorted_points:
        for r in p.quality_reasons:
            suspect_reasons_breakdown[r] = suspect_reasons_breakdown.get(r, 0) + 1

    summary = {
        "total_exposures": total_count,
        "valid_points": valid_count,
        "null_points": null_count,
        "unplaceable_points": unplaceable_count,
        "suspect_points": suspect_count,
        "wavelength_min_um": wave_min,
        "wavelength_max_um": wave_max,
        "null_reasons_breakdown": null_breakdown,
        "suspect_reasons_breakdown": suspect_reasons_breakdown
    }

    return Spectrum(
        source_id=source.id,
        ra_deg=source.ra_deg,
        dec_deg=source.dec_deg,
        points=sorted_points,
        summary=summary
    )
