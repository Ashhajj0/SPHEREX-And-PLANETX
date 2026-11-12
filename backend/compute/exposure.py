#!/usr/bin/env python3
"""
backend/compute/exposure.py
===========================
Loads and represents a single SPHEREx Multi-Extension FITS (MEF) exposure cutout.

Each real SPHEREx cutout contains:
- PRIMARY: Header metadata including pipeline version
- IMAGE: Science flux in MJy/sr (MegaJanskys per steradian)
- FLAGS: 32-bit data quality bitmask
- VARIANCE: Error variance in (MJy/sr)^2
- WCS-WAVE: Lookup table mapping each pixel (x, y) to central wavelength & bandwidth

This module keeps loaded exposures in memory to avoid repetitive disk I/O.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

try:
    import numpy as np
except ImportError:
    np = None

try:
    from astropy.io import fits
    from astropy.wcs import WCS
    from astropy import log
    # Silence the benign astropy SIP distortion polynomial notices per instructions
    log.setLevel("ERROR")
except ImportError:
    fits = None
    WCS = None


@dataclass
class Exposure:
    """Represents a single calibrated SPHEREx exposure cutout loaded in memory."""
    path: Path
    file_name: str
    image: Any                 # 2D numpy array of calibrated surface brightness (MJy/sr)
    flags: Any                 # 2D numpy array of bitmask flags (int32)
    variance: Any              # 2D numpy array of uncertainty variance (MJy/sr)^2
    wcs: Any                   # Celestial WCS (RA---TAN-SIP, DEC--TAN-SIP)
    spectral_wcs: Any          # Spectral WCS key 'W' pointing to WCS-WAVE lookup table
    time: str                  # Observation time from DATE-AVG (fallback DATE-OBS)
    detector: int              # Detector array (1..6)
    shape: Tuple[int, int]     # (height, width) in pixels
    primary_header: Dict[str, Any]
    image_header: Dict[str, Any]

    def get_pixel_wavelength_and_bandwidth(self, x: float, y: float) -> Tuple[Optional[float], Optional[float]]:
        """
        Evaluates the central wavelength and bandwidth at pixel coordinate (x, y)
        using the real SPHEREx WCS-WAVE lookup table (spectral WCS key 'W').
        """
        if self.spectral_wcs is None:
            return None, None
        try:
            wave, band = self.spectral_wcs.pixel_to_world(x, y)
            # Convert astropy quantities to micrometers
            wave_um = float(wave.to_value("um")) if hasattr(wave, "to_value") else float(wave)
            band_um = float(band.to_value("um")) if hasattr(band, "to_value") else float(band)
            return round(wave_um, 5), round(band_um, 5)
        except Exception:
            return None, None


# In-memory exposure cache to prevent re-reading from disk
_EXPOSURE_CACHE: Dict[str, Exposure] = {}


def load_exposure(file_path: Path, use_cache: bool = True) -> Exposure:
    """
    Loads a SPHEREx MEF cutout file from disk into an Exposure object.
    Caches loaded exposures in memory for fast repeated access.
    """
    path_key = str(file_path.resolve())
    if use_cache and path_key in _EXPOSURE_CACHE:
        return _EXPOSURE_CACHE[path_key]

    if not file_path.exists():
        raise FileNotFoundError(f"Exposure file does not exist: {file_path}")

    if fits is None:
        raise ImportError("astropy is required to load SPHEREx FITS exposures. Please install requirements.txt.")

    with fits.open(file_path) as hdul:
        primary_hdr = dict(hdul[0].header)
        img_hdr = dict(hdul["IMAGE"].header)

        image_data = np.array(hdul["IMAGE"].data, dtype=np.float32)
        flags_data = np.array(hdul["FLAGS"].data, dtype=np.int32)
        variance_data = np.array(hdul["VARIANCE"].data, dtype=np.float32)

        # Build celestial spatial WCS
        spatial_wcs = WCS(hdul["IMAGE"].header)

        # Build spectral WCS from WCS-WAVE lookup table (key 'W')
        try:
            spectral_wcs = WCS(hdul["IMAGE"].header, fobj=hdul, key="W")
            # Strip SIP distortions from spectral WCS per official tutorial
            spectral_wcs.sip = None
        except Exception:
            spectral_wcs = None

        # Extract observation time: prefer DATE-AVG, fallback to DATE-OBS or DATE-BEG
        obs_time = img_hdr.get("DATE-AVG", img_hdr.get("DATE-OBS", img_hdr.get("DATE-BEG", "unknown")))

        # Extract detector array number (1..6)
        raw_det = img_hdr.get("DETECTOR", primary_hdr.get("DETECTOR", 1))
        try:
            detector_num = int(raw_det)
        except (ValueError, TypeError):
            detector_num = 1

        exp = Exposure(
            path=file_path,
            file_name=file_path.name,
            image=image_data,
            flags=flags_data,
            variance=variance_data,
            wcs=spatial_wcs,
            spectral_wcs=spectral_wcs,
            time=str(obs_time),
            detector=detector_num,
            shape=image_data.shape,
            primary_header=primary_hdr,
            image_header=img_hdr
        )

        if use_cache:
            _EXPOSURE_CACHE[path_key] = exp

        return exp


def load_region_exposures(region_dir: Path) -> List[Exposure]:
    """
    Loads all real SPHEREx FITS cutouts from a region directory (e.g. cache/spherex/<region>/).
    Skips any synthetic fixture files.
    """
    if not region_dir.exists():
        raise FileNotFoundError(f"Region cache directory does not exist: {region_dir}")

    fits_files = sorted(list(region_dir.glob("*.fits")) + list(region_dir.glob("*.fits.gz")))
    # Exclude files with fixture_ prefix
    fits_files = [f for f in fits_files if not f.name.startswith("fixture_")]

    if not fits_files:
        raise ValueError(f"No SPHEREx FITS cutouts found in {region_dir}")

    exposures = []
    for f in fits_files:
        exposures.append(load_exposure(f))

    return exposures


def clear_exposure_cache():
    """Clears the in-memory exposure cache to free RAM if needed."""
    _EXPOSURE_CACHE.clear()
