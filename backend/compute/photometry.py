#!/usr/bin/env python3
"""
backend/compute/photometry.py
=============================
Computes calibrated aperture spectrophotometry for a target on a SPHEREx exposure.

Steps:
1. Converts celestial coordinates (RA, Dec) into sub-pixel detector coordinates (x, y).
2. Performs geometric boundary checks; returns null with 'outside image' if off the edge.
3. Masks corrupted pixels using SPHEREx Level 2 FLAGS (cosmic rays, saturation, hardware defects).
4. Enforces the data completeness rule: returns null with 'too few good pixels' if < 70%
   of aperture pixels are valid.
5. Measures local background in a surrounding circular annulus (r_in = 4.0 pix, r_out = 6.0 pix).
   Subtracts the median annulus value from each aperture pixel (removing zodiacal light).
6. Multiplies by the pixel solid angle in steradians and converts from MJy/sr to uJy
   (1 MJy = 1e12 uJy).
7. Propagates uncertainty from the VARIANCE extension plus background noise variance.
8. Evaluates central wavelength and bandwidth at the target position using the spectral WCS.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Tuple, Optional, Any, Dict, List
import math

try:
    import numpy as np
except ImportError:
    np = None

try:
    from astropy.coordinates import SkyCoord
    from astropy.wcs.utils import proj_plane_pixel_scales
    from astropy.io import fits
except ImportError:
    SkyCoord = None
    proj_plane_pixel_scales = None
    fits = None

from backend.compute.exposure import Exposure
from backend.compute.common import BAD_PIXEL_MASK, is_bad_pixel, sanitize_scalar

__all__ = [
    "PhotometryResult",
    "measure_source",
    "get_pixel_solid_angle_sr",
    "BAD_PIXEL_MASK",
    "is_bad_pixel",
    "sanitize_scalar",
]

# Base directory for pixel solid angle maps
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SOLID_ANGLE_CACHE_DIR = REPO_ROOT / "cache" / "solid_angle"

# Memory cache for detector solid angle maps to avoid re-opening FITS repeatedly
_SOLID_ANGLE_MAP_CACHE: Dict[int, Any] = {}


@dataclass
class PhotometryResult:
    """Stores the outcome of an aperture photometry measurement."""
    flux_uJy: Optional[float]           # Background-subtracted flux in microJanskys (uJy), or None
    flux_err_uJy: Optional[float]       # 1-sigma uncertainty in microJanskys (uJy), or None
    n_good_pixels: int                  # Number of unflagged, valid pixels inside the aperture
    wavelength_um: Optional[float]      # Central wavelength at source position in micrometers
    bandwidth_um: Optional[float]       # Channel bandwidth in micrometers
    null_reason: Optional[str]          # Reason if flux is null ('outside image', 'too few good pixels', etc.)
    solid_angle_kind: str               # 'pixel map' or 'nominal solid angle'
    x_pix: Optional[float]              # Detector X coordinate
    y_pix: Optional[float]              # Detector Y coordinate
    background_mjy_sr: Optional[float]  # Local zodiacal sky level subtracted (MJy/sr)
    n_background_pixels: int = 0        # Number of unflagged, valid pixels in background annulus
    n_aperture_pixels: int = 0          # Total number of pixels within aperture circle
    n_flagged_in_aperture: int = 0      # Number of flagged (bad) pixels inside aperture
    n_flagged_extra_in_aperture: int = 0 # Number of pixels in aperture with bits 6, 7, 11, or 19 set
    edge_distance_pix: Optional[float] = None  # Centre to nearest image edge
    peak_pixel_flagged: bool = False    # True if the brightest aperture pixel is flagged bad
    quality: str = "ok"                 # "ok" or "suspect"
    quality_reasons: List[str] = field(default_factory=list) # Plain-language list of reasons if suspect

    def to_dict(self) -> Dict[str, Any]:
        """Returns a JSON-safe dictionary representation with NaNs/Infinities converted to None."""
        return {
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
            "wavelength_um": sanitize_scalar(self.wavelength_um, 5),
            "bandwidth_um": sanitize_scalar(self.bandwidth_um, 5),
            "null_reason": self.null_reason,
            "solid_angle_kind": self.solid_angle_kind,
            "x_pix": sanitize_scalar(self.x_pix, 2),
            "y_pix": sanitize_scalar(self.y_pix, 2),
            "background_mjy_sr": sanitize_scalar(self.background_mjy_sr, 5)
        }


def evaluate_quality(
    n_flagged: int,
    edge_dist: Optional[float],
    peak_flagged: bool,
    extra_reasons: Optional[List[str]] = None
) -> Tuple[str, List[str]]:
    """
    Evaluates quality of a photometric point:
    Quality is 'suspect' if any of:
    - n_flagged_in_aperture > 0
    - edge_distance_pix < 7.0
    - peak_pixel_flagged is True
    - any extra flag bits in aperture (bits 6, 7, 11, 19)
    Otherwise 'ok'.
    """
    reasons: List[str] = []
    if n_flagged > 0:
        reasons.append("flagged pixel in aperture")
    if edge_dist is not None and edge_dist < 7.0:
        reasons.append("near image edge")
    if peak_flagged:
        reasons.append("peak pixel flagged bad")
    if extra_reasons:
        for r in extra_reasons:
            if r not in reasons:
                reasons.append(r)

    quality = "suspect" if len(reasons) > 0 else "ok"
    return quality, reasons


def get_pixel_solid_angle_sr(exposure: Exposure, x: float, y: float) -> Tuple[float, str]:
    """
    Returns the solid angle of a detector pixel in steradians.
    1. Checks if a calibrated solid angle pixel map exists in cache/solid_angle/.
    2. Otherwise computes the nominal pixel solid angle from the spatial WCS transformation.
    """
    det_id = exposure.detector
    map_path = SOLID_ANGLE_CACHE_DIR / f"solid_angle_d{det_id}.fits"

    if map_path.exists() and fits is not None:
        if det_id not in _SOLID_ANGLE_MAP_CACHE:
            try:
                with fits.open(map_path) as hdul:
                    _SOLID_ANGLE_MAP_CACHE[det_id] = np.array(hdul[0].data, dtype=np.float64)
            except Exception:
                _SOLID_ANGLE_MAP_CACHE[det_id] = None

        sa_data = _SOLID_ANGLE_MAP_CACHE.get(det_id)
        if sa_data is not None:
            ix, iy = int(round(x)), int(round(y))
            if 0 <= iy < sa_data.shape[0] and 0 <= ix < sa_data.shape[1]:
                val = float(sa_data[iy, ix])
                if val > 0 and not math.isnan(val):
                    return val, "pixel map"

    # Nominal solid angle from spatial WCS
    wcs = exposure.wcs
    if wcs is not None and proj_plane_pixel_scales is not None:
        try:
            scales = proj_plane_pixel_scales(wcs)
            # scales are in degrees per pixel
            scale_x_rad = math.radians(float(scales[0]))
            scale_y_rad = math.radians(float(scales[1]))
            nominal_sr = scale_x_rad * scale_y_rad
            return nominal_sr, "nominal solid angle"
        except Exception:
            pass

    # Fallback default: nominal 6.15 arcsec per pixel
    nominal_rad = (6.15 / 3600.0) * (math.pi / 180.0)
    nominal_sr = nominal_rad * nominal_rad
    return nominal_sr, "nominal solid angle"


def measure_source(
    exposure: Exposure,
    ra_deg: float,
    dec_deg: float,
    r_aperture_pix: float = 2.0,
    annulus_pix: Tuple[float, float] = (4.0, 6.0)
) -> PhotometryResult:
    """
    Measures calibrated background-subtracted aperture flux and propagated uncertainty.

    Edge Handling Rules:
    1. If any part of the circular aperture (radius r_aperture_pix) lies outside the image,
       returns null with null_reason 'outside image'.
    2. If the aperture is fully inside the image but the surrounding background annulus
       is partly outside, uses the inside part of the annulus. Returns null with
       null_reason 'too few background pixels' if fewer than 20 good annulus pixels remain.
    3. Builds the aperture and annulus masks on the exact same clipped index range as the
       cut-out sub-arrays, guaranteeing identical shapes and preventing broadcasting errors.
    4. Never crashes on ordinary or corrupted data: catches unexpected exceptions and
       returns null with null_reason 'measurement error'.
    """
    try:
        wcs = exposure.wcs
        image = exposure.image
        flags = exposure.flags
        variance = exposure.variance
        h, w = exposure.shape

        # 1. Convert celestial coordinates (RA, Dec) to detector pixel coordinates (x, y)
        if wcs is not None and SkyCoord is not None:
            try:
                c = SkyCoord(ra=ra_deg, dec=dec_deg, unit="deg", frame="icrs")
                px, py = wcs.world_to_pixel(c)
                x, y = float(px), float(py)
            except Exception:
                return PhotometryResult(
                    flux_uJy=None, flux_err_uJy=None, n_good_pixels=0,
                    wavelength_um=None, bandwidth_um=None,
                    null_reason="coordinate conversion failed",
                    solid_angle_kind="nominal solid angle",
                    x_pix=None, y_pix=None, background_mjy_sr=None,
                    n_aperture_pixels=0, n_flagged_in_aperture=0,
                    edge_distance_pix=None, peak_pixel_flagged=False,
                    quality="ok", quality_reasons=[]
                )
        else:
            # Synthetic / test coordinates directly provided in pixel coordinates
            x, y = float(ra_deg), float(dec_deg)

        if math.isnan(x) or math.isnan(y):
            return PhotometryResult(
                flux_uJy=None, flux_err_uJy=None, n_good_pixels=0,
                wavelength_um=None, bandwidth_um=None,
                null_reason="coordinate conversion failed",
                solid_angle_kind="nominal solid angle",
                x_pix=None, y_pix=None, background_mjy_sr=None,
                n_aperture_pixels=0, n_flagged_in_aperture=0,
                edge_distance_pix=None, peak_pixel_flagged=False,
                quality="ok", quality_reasons=[]
            )

        # Distance from centre to nearest image edge
        edge_dist = min(x, (w - 1.0) - x, y, (h - 1.0) - y)
        edge_dist_val = round(edge_dist, 2)

        # 2. Central wavelength, bandwidth, and solid angle at target position
        wave_um, band_um = exposure.get_pixel_wavelength_and_bandwidth(x, y)
        omega_pix_sr, solid_angle_kind = get_pixel_solid_angle_sr(exposure, x, y)

        # 3. Aperture Circle Boundary Check:
        # If any part of the aperture circle (radius r_aperture_pix) lies outside the image,
        # return null with null_reason 'outside image'. Do not shrink the aperture.
        if (x - r_aperture_pix < 0) or (x + r_aperture_pix >= w) or \
           (y - r_aperture_pix < 0) or (y + r_aperture_pix >= h):
            q, q_reasons = evaluate_quality(0, edge_dist, False)
            return PhotometryResult(
                flux_uJy=None, flux_err_uJy=None, n_good_pixels=0,
                wavelength_um=wave_um, bandwidth_um=band_um,
                null_reason="outside image",
                solid_angle_kind=solid_angle_kind,
                x_pix=round(x, 2), y_pix=round(y, 2), background_mjy_sr=None,
                n_aperture_pixels=0, n_flagged_in_aperture=0,
                edge_distance_pix=edge_dist_val, peak_pixel_flagged=False,
                quality=q, quality_reasons=q_reasons
            )

        # 4. Check VARIANCE extension
        if variance is None:
            q, q_reasons = evaluate_quality(0, edge_dist, False)
            return PhotometryResult(
                flux_uJy=None, flux_err_uJy=None, n_good_pixels=0,
                wavelength_um=wave_um, bandwidth_um=band_um,
                null_reason="no variance",
                solid_angle_kind="nominal solid angle",
                x_pix=round(x, 2), y_pix=round(y, 2), background_mjy_sr=None,
                n_aperture_pixels=0, n_flagged_in_aperture=0,
                edge_distance_pix=edge_dist_val, peak_pixel_flagged=False,
                quality=q, quality_reasons=q_reasons
            )

        # 5. Extract pixels in aperture and annulus using identical clipped index ranges
        r_in, r_out = annulus_pix[0], annulus_pix[1]

        slice_x_min = max(0, int(math.floor(x - r_out)))
        slice_x_max = min(w, int(math.ceil(x + r_out)) + 1)
        slice_y_min = max(0, int(math.floor(y - r_out)))
        slice_y_max = min(h, int(math.ceil(y + r_out)) + 1)

        if slice_x_min >= slice_x_max or slice_y_min >= slice_y_max:
            q, q_reasons = evaluate_quality(0, edge_dist, False)
            return PhotometryResult(
                flux_uJy=None, flux_err_uJy=None, n_good_pixels=0,
                wavelength_um=wave_um, bandwidth_um=band_um,
                null_reason="outside image",
                solid_angle_kind="nominal solid angle",
                x_pix=round(x, 2), y_pix=round(y, 2), background_mjy_sr=None,
                n_aperture_pixels=0, n_flagged_in_aperture=0,
                edge_distance_pix=edge_dist_val, peak_pixel_flagged=False,
                quality=q, quality_reasons=q_reasons
            )

        # Slice sub-arrays from image, flags, and variance
        sub_img = image[slice_y_min:slice_y_max, slice_x_min:slice_x_max]
        sub_flags = flags[slice_y_min:slice_y_max, slice_x_min:slice_x_max]
        sub_var = variance[slice_y_min:slice_y_max, slice_x_min:slice_x_max]

        # Compute masks over the exact same clipped slice coordinates
        sub_y, sub_x = np.ogrid[slice_y_min:slice_y_max, slice_x_min:slice_x_max]
        dist_sq = (sub_x - x)**2 + (sub_y - y)**2

        aperture_mask = dist_sq <= (r_aperture_pix**2)
        annulus_mask = (dist_sq >= (r_in**2)) & (dist_sq <= (r_out**2))
        sub_bad = is_bad_pixel(sub_flags)

        # Aperture completeness rule (>= 70% unflagged valid pixels)
        total_aperture_pixels = int(np.sum(aperture_mask))
        good_aperture_mask = aperture_mask & (~sub_bad)
        n_good_aperture = int(np.sum(good_aperture_mask))
        n_flagged_in_aperture = int(np.sum(aperture_mask & sub_bad))

        # Check for extra quality flags in aperture: bits 6, 7, 11, 19
        # These are NOT in BAD_PIXEL_MASK and do NOT change which pixels enter the flux sum.
        # They only mark the resulting point as suspect.
        aperture_flags = sub_flags[aperture_mask]
        extra_reasons: List[str] = []
        n_flagged_extra = 0

        # Bit 6: NONFUNC
        mask_bit6 = (aperture_flags & (1 << 6)) != 0
        if np.any(mask_bit6):
            extra_reasons.append("non-functional pixel in aperture")
        # Bit 7
        mask_bit7 = (aperture_flags & (1 << 7)) != 0
        if np.any(mask_bit7):
            extra_reasons.append("flag 7 in aperture")
        # Bit 11
        mask_bit11 = (aperture_flags & (1 << 11)) != 0
        if np.any(mask_bit11):
            extra_reasons.append("flag 11 in aperture")
        # Bit 19: OUTLIER
        mask_bit19 = (aperture_flags & (1 << 19)) != 0
        if np.any(mask_bit19):
            extra_reasons.append("outlier pixel in aperture")

        extra_any_mask = mask_bit6 | mask_bit7 | mask_bit11 | mask_bit19
        n_flagged_extra = int(np.sum(extra_any_mask))

        # Determine peak aperture pixel and whether it is flagged bad
        aperture_sub_pixels = sub_img[aperture_mask]
        aperture_sub_bad = sub_bad[aperture_mask]
        if len(aperture_sub_pixels) > 0:
            peak_idx = int(np.argmax(aperture_sub_pixels))
            peak_pixel_flagged = bool(aperture_sub_bad[peak_idx])
        else:
            peak_pixel_flagged = False

        quality, quality_reasons = evaluate_quality(
            n_flagged=n_flagged_in_aperture,
            edge_dist=edge_dist,
            peak_flagged=peak_pixel_flagged,
            extra_reasons=extra_reasons
        )

        if total_aperture_pixels == 0 or (n_good_aperture / total_aperture_pixels) < 0.70:
            return PhotometryResult(
                flux_uJy=None, flux_err_uJy=None, n_good_pixels=n_good_aperture,
                wavelength_um=wave_um, bandwidth_um=band_um,
                null_reason="too few good pixels",
                solid_angle_kind="nominal solid angle",
                x_pix=round(x, 2), y_pix=round(y, 2), background_mjy_sr=None,
                n_aperture_pixels=total_aperture_pixels,
                n_flagged_in_aperture=n_flagged_in_aperture,
                n_flagged_extra_in_aperture=n_flagged_extra,
                edge_distance_pix=edge_dist_val,
                peak_pixel_flagged=peak_pixel_flagged,
                quality=quality,
                quality_reasons=quality_reasons
            )

        # Annulus background estimation:
        # If annulus is partly outside, use the inside part, but require at least 20 good pixels
        good_annulus_mask = annulus_mask & (~sub_bad)
        n_good_annulus = int(np.sum(good_annulus_mask))
        if n_good_annulus < 20:
            return PhotometryResult(
                flux_uJy=None, flux_err_uJy=None, n_good_pixels=n_good_aperture,
                wavelength_um=wave_um, bandwidth_um=band_um,
                null_reason="too few background pixels",
                solid_angle_kind=solid_angle_kind,
                x_pix=round(x, 2), y_pix=round(y, 2), background_mjy_sr=None,
                n_background_pixels=n_good_annulus,
                n_aperture_pixels=total_aperture_pixels,
                n_flagged_in_aperture=n_flagged_in_aperture,
                n_flagged_extra_in_aperture=n_flagged_extra,
                edge_distance_pix=edge_dist_val,
                peak_pixel_flagged=peak_pixel_flagged,
                quality=quality,
                quality_reasons=quality_reasons
            )

        annulus_pixels = sub_img[good_annulus_mask]
        bg_median = float(np.nanmedian(annulus_pixels))
        bg_variance = float(np.nanvar(annulus_pixels))

        # Background-subtracted aperture sum in MJy/sr
        ap_pixels = sub_img[good_aperture_mask]
        ap_var_pixels = sub_var[good_aperture_mask]

        # Check for NaN / non-positive variance
        if np.any(np.isnan(ap_var_pixels)) or np.any(ap_var_pixels <= 0):
            return PhotometryResult(
                flux_uJy=None, flux_err_uJy=None, n_good_pixels=n_good_aperture,
                wavelength_um=wave_um, bandwidth_um=band_um,
                null_reason="no variance",
                solid_angle_kind=solid_angle_kind,
                x_pix=round(x, 2), y_pix=round(y, 2), background_mjy_sr=bg_median,
                n_background_pixels=n_good_annulus,
                n_aperture_pixels=total_aperture_pixels,
                n_flagged_in_aperture=n_flagged_in_aperture,
                n_flagged_extra_in_aperture=n_flagged_extra,
                edge_distance_pix=edge_dist_val,
                peak_pixel_flagged=peak_pixel_flagged,
                quality=quality,
                quality_reasons=quality_reasons
            )

        # Area correction factor if a few pixels were masked (<30%)
        area_scale = total_aperture_pixels / n_good_aperture
        net_flux_mjy_sr = float(np.sum(ap_pixels - bg_median)) * area_scale

        # 6. Error Propagation Formula:
        # variance_total = sum(variance_aperture) + (pi/2) * (N_ap^2 / N_annulus) * variance_bkg
        # The factor (pi / 2) accounts for the standard error of the median background
        variance_sum = float(np.sum(ap_var_pixels)) * (area_scale**2)
        bg_uncertainty_term = (math.pi / 2.0) * ((total_aperture_pixels**2) / n_good_annulus) * bg_variance
        total_variance_mjy_sr = variance_sum + bg_uncertainty_term
        flux_err_mjy_sr = math.sqrt(max(0.0, total_variance_mjy_sr))

        # 7. Convert surface brightness (MJy/sr) to total flux (uJy)
        # 1 MegaJansky = 1e6 Jansky = 1e12 microJanskys (uJy)
        omega_pix_sr, solid_angle_kind = get_pixel_solid_angle_sr(exposure, x, y)
        flux_uJy = net_flux_mjy_sr * omega_pix_sr * 1e12
        flux_err_uJy = flux_err_mjy_sr * omega_pix_sr * 1e12

        return PhotometryResult(
            flux_uJy=round(flux_uJy, 3),
            flux_err_uJy=round(flux_err_uJy, 3),
            n_good_pixels=n_good_aperture,
            wavelength_um=wave_um,
            bandwidth_um=band_um,
            null_reason=None,
            solid_angle_kind=solid_angle_kind,
            x_pix=round(x, 2),
            y_pix=round(y, 2),
            background_mjy_sr=round(bg_median, 5),
            n_background_pixels=n_good_annulus,
            n_aperture_pixels=total_aperture_pixels,
            n_flagged_in_aperture=n_flagged_in_aperture,
            n_flagged_extra_in_aperture=n_flagged_extra,
            edge_distance_pix=edge_dist_val,
            peak_pixel_flagged=peak_pixel_flagged,
            quality=quality,
            quality_reasons=quality_reasons
        )

    except Exception as exc:
        # Rule 1: Never let one bad source crash the run. Return null with 'measurement error'.
        edge_dist_fallback = None
        if "edge_dist" in locals() and edge_dist is not None:
            edge_dist_fallback = round(edge_dist, 2)
        return PhotometryResult(
            flux_uJy=None,
            flux_err_uJy=None,
            n_good_pixels=0,
            wavelength_um=wave_um if "wave_um" in locals() else None,
            bandwidth_um=band_um if "band_um" in locals() else None,
            null_reason="measurement error",
            solid_angle_kind="nominal solid angle",
            x_pix=round(x, 2) if ("x" in locals() and x is not None) else None,
            y_pix=round(y, 2) if ("y" in locals() and y is not None) else None,
            background_mjy_sr=None,
            n_aperture_pixels=0,
            n_flagged_in_aperture=0,
            edge_distance_pix=edge_dist_fallback,
            peak_pixel_flagged=False,
            quality="suspect",
            quality_reasons=["measurement error"]
        )

