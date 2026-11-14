#!/usr/bin/env python3
"""
backend/compute/detect.py
=========================
Detects celestial point sources on real SPHEREx exposure cutouts.

Detection Strategy:
1. Picks the optimal reference exposure by scoring candidate exposures:
   lowest median variance and smallest fraction of corrupted/flagged pixels.
2. Masks corrupted pixels (cosmic rays, saturation, hardware defects) using the FLAGS bitmask.
3. Estimates 2D spatial background and local noise with photutils Background2D.
4. Detects stars at a 5-sigma threshold above the local background using photutils DAOStarFinder.
5. Assigns unique catalog IDs (e.g., SPX-NEP-001, sorted by signal-to-noise ratio).
6. Converts detector pixel coordinates (x, y) into astronomical coordinates (RA, Dec).

Important Astronomical Note:
Detection is performed on a single chosen reference exposure. Because SPHEREx uses Linear
Variable Filters (LVF), an astronomical object's brightness depends on the central wavelength
of the exposure. A cold star or an object with strong ice absorption features may appear faint
at some wavelengths and bright at others.
"""

from dataclasses import dataclass
from typing import List, Tuple, Dict, Any

try:
    import numpy as np
except ImportError:
    np = None

try:
    from photutils.background import Background2D, MedianBackground
    from photutils.detection import DAOStarFinder
except ImportError:
    Background2D = None
    DAOStarFinder = None

from backend.compute.exposure import Exposure
from backend.compute.common import BAD_PIXEL_MASK, is_bad_pixel, sanitize_scalar

__all__ = [
    "DetectedSource",
    "detect_sources",
    "pick_reference_exposure",
    "BAD_PIXEL_MASK",
    "is_bad_pixel",
    "sanitize_scalar",
]


@dataclass
class DetectedSource:
    """Represents a celestial point source detected on a reference SPHEREx exposure."""
    id: str                    # e.g. "SPX-NEP-001"
    x_pix: float               # Sub-pixel X coordinate on the detector array
    y_pix: float               # Sub-pixel Y coordinate on the detector array
    ra_deg: float              # Right Ascension in degrees (J2000 / ICRS)
    dec_deg: float             # Declination in degrees (J2000 / ICRS)
    peak_snr: float            # Signal-to-noise ratio at detection peak
    reference_file: str        # File name of exposure where source was detected
    reference_wavelength_um: float # Central wavelength of detection exposure

    def to_dict(self) -> Dict[str, Any]:
        """Returns a JSON-safe dictionary representation with NaNs/Infinities converted to None."""
        return {
            "id": self.id,
            "x_pix": sanitize_scalar(self.x_pix, 2),
            "y_pix": sanitize_scalar(self.y_pix, 2),
            "ra_deg": sanitize_scalar(self.ra_deg, 6),
            "dec_deg": sanitize_scalar(self.dec_deg, 6),
            "peak_snr": sanitize_scalar(self.peak_snr, 2),
            "reference_file": self.reference_file,
            "reference_wavelength_um": sanitize_scalar(self.reference_wavelength_um, 4)
        }


def pick_reference_exposure(exposures: List[Exposure]) -> Exposure:
    """
    Automatically selects the highest-quality reference exposure for source detection.
    Evaluates:
      1. Median background noise variance (lower is cleaner).
      2. Percentage of corrupted/flagged pixels (lower is more complete).
    """
    if not exposures:
        raise ValueError("Cannot select reference exposure from an empty list.")

    best_score = float("inf")
    best_exposure = exposures[0]

    for exp in exposures:
        var = exp.variance
        flags = exp.flags

        # Compute median variance across the exposure
        med_var = float(np.nanmedian(var)) if np is not None else 1.0

        # Compute fraction of bad pixels
        bad_mask = is_bad_pixel(flags) if np is not None else False
        bad_frac = float(np.mean(bad_mask)) if np is not None else 0.0

        # Penalize exposures with noisy variance and high bad pixel counts
        quality_score = med_var * (1.0 + 3.0 * bad_frac)

        if quality_score < best_score:
            best_score = quality_score
            best_exposure = exp

    return best_exposure


def detect_sources(
    exposure: Exposure,
    threshold_sigma: float = 5.0,
    region_id: str = "NEP",
    fwhm_pix: float = 2.0
) -> Tuple[List[DetectedSource], Dict[str, Any]]:
    """
    Detects celestial point sources using Background2D and DAOStarFinder.
    
    Returns:
      (detected_sources_list, detection_metadata)
    """
    image = exposure.image
    flags = exposure.flags
    wcs = exposure.wcs
    h, w = exposure.shape

    # 1. Mask corrupted pixels
    bad_mask = is_bad_pixel(flags)

    # 2. Estimate 2D spatial background and local noise
    # SPHEREx cutouts are typically 146x146 pixels; box size ~24-32 pixels models local gradients
    box_size = min(32, max(8, h // 4))
    bkg_estimator = MedianBackground()
    try:
        bkg = Background2D(
            image,
            box_size=(box_size, box_size),
            filter_size=(3, 3),
            mask=bad_mask,
            bkg_estimator=bkg_estimator
        )
        bkg_subtracted = image - bkg.background
        bkg_rms = bkg.background_rms
        global_rms = float(np.nanmedian(bkg_rms))
    except Exception:
        # Fallback if image has high mask fraction
        med = float(np.nanmedian(image[~bad_mask])) if np is not None else 0.0
        std = float(np.nanstd(image[~bad_mask])) if np is not None else 1.0
        bkg_subtracted = image - med
        global_rms = std

    # 3. Detect point sources with DAOStarFinder (5-sigma threshold)
    detection_threshold = threshold_sigma * global_rms
    daofind = DAOStarFinder(fwhm=fwhm_pix, threshold=detection_threshold)
    sources_table = daofind(bkg_subtracted, mask=bad_mask)

    # Central wavelength of the reference exposure for documentation
    ref_wave, _ = exposure.get_pixel_wavelength_and_bandwidth(w / 2.0, h / 2.0)
    ref_wave_um = ref_wave if ref_wave is not None else 0.0

    detected_sources: List[DetectedSource] = []

    if sources_table is not None and len(sources_table) > 0:
        # Sort by detection peak or SNR descending
        flux_peaks = sources_table["peak"]
        snrs = flux_peaks / global_rms

        # Convert coordinates to celestial RA, Dec
        x_coords = np.array(sources_table["xcentroid"])
        y_coords = np.array(sources_table["ycentroid"])

        if wcs is not None:
            sky_coords = wcs.pixel_to_world(x_coords, y_coords)
            ras = sky_coords.ra.deg
            decs = sky_coords.dec.deg
        else:
            ras = x_coords
            decs = y_coords

        # Sort indices by SNR descending
        sort_order = np.argsort(-snrs)

        # Region short prefix (e.g. NEP, SEP, COSMOS, BARNARD, EPSIND, WISE0855, RWAUR, RDRA)
        region_prefixes = {
            "north-ecliptic-pole": "NEP",
            "south-ecliptic-pole": "SEP",
            "cosmos": "COSMOS",
            "barnards-star": "BARNARD",
            "epsilon-indi": "EPSIND",
            "wise-0855-0714": "WISE0855",
            "rw-aurigae": "RWAUR",
            "r-draconis": "RDRA",
        }
        prefix = region_prefixes.get(region_id.lower(), region_id.upper())
        if not prefix.startswith("SPX"):
            prefix = f"SPX-{prefix}"

        count = 1
        for idx in sort_order:
            x_val = float(x_coords[idx])
            y_val = float(y_coords[idx])
            snr_val = float(snrs[idx])
            ra_val = float(ras[idx])
            dec_val = float(decs[idx])

            # Keep sources at least 3 pixels away from detector border
            if 3.0 <= x_val <= (w - 4.0) and 3.0 <= y_val <= (h - 4.0):
                source_id = f"{prefix}-{count:03d}"
                detected_sources.append(DetectedSource(
                    id=source_id,
                    x_pix=round(x_val, 2),
                    y_pix=round(y_val, 2),
                    ra_deg=round(ra_val, 6),
                    dec_deg=round(dec_val, 6),
                    peak_snr=round(snr_val, 2),
                    reference_file=exposure.file_name,
                    reference_wavelength_um=ref_wave_um
                ))
                count += 1

    metadata = {
        "reference_file": exposure.file_name,
        "detector": exposure.detector,
        "reference_wavelength_um": ref_wave_um,
        "threshold_sigma": threshold_sigma,
        "background_rms_mjy_sr": round(global_rms, 6),
        "total_detected": len(detected_sources)
    }

    return detected_sources, metadata
