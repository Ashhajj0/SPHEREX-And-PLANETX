#!/usr/bin/env python3
"""
backend/tests/test_science.py
=============================
Unit tests for the SPHEREx scientific processing engine.

Tests use ONLY small synthetic arrays generated in memory (never real files).
Covers:
1. Known star flux recovered within 5 percent.
2. Source off the edge gives null with reason 'outside image'.
3. Heavily flagged aperture gives null with reason 'too few good pixels'.
4. No catalogue match gives null identifier and null separation.
5. Catalogue match at a known separation of 3.0 arcsec is reported correctly.
6. Forbidden terminology check: fails if disallowed speculative candidate words
   appear in backend/ or src/.
"""

import sys
import subprocess
import math
import re
import tempfile
from pathlib import Path
import pytest

# Ensure numpy and local backend imports work
import numpy as np

from backend.compute.exposure import Exposure
from backend.compute.photometry import measure_source, get_pixel_solid_angle_sr
from backend.compute.detect import DetectedSource, BAD_PIXEL_MASK
from backend.compute.crossmatch import crossmatch_sources

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def create_synthetic_exposure(
    shape=(31, 31),
    background=2.5,
    variance_val=0.04,
    star_flux_uJy=150.0,
    star_x=15.0,
    star_y=15.0,
    flag_box=None
) -> Exposure:
    """
    Creates a synthetic in-memory Exposure object without reading any files.
    Injects a point source with a known integrated flux in microJanskys (uJy).
    """
    h, w = shape
    img = np.full((h, w), background, dtype=np.float32)
    var = np.full((h, w), variance_val, dtype=np.float32)
    flags = np.zeros((h, w), dtype=np.int32)

    # Pixel scale: nominal 6.15 arcsec/pixel
    nominal_rad = (6.15 / 3600.0) * (math.pi / 180.0)
    omega_sr = nominal_rad * nominal_rad

    if star_flux_uJy > 0:
        # Convert uJy to total net MJy/sr: F_mjy_sr = F_uJy / (omega_sr * 1e12)
        total_net_mjy_sr = star_flux_uJy / (omega_sr * 1e12)

        # Inject point source profile inside radius r <= 2.0 pixels
        y_grid, x_grid = np.ogrid[:h, :w]
        dist_sq = (x_grid - star_x)**2 + (y_grid - star_y)**2
        aperture_mask = dist_sq <= (2.0**2)
        n_ap_pix = np.sum(aperture_mask)

        # Distribute net flux across aperture pixels
        img[aperture_mask] += (total_net_mjy_sr / n_ap_pix)

    if flag_box is not None:
        y1, y2, x1, x2 = flag_box
        # Set bad pixel bit (e.g. OVERFLOW = bit 1)
        flags[y1:y2, x1:x2] = (1 << 1)

    exp = Exposure(
        path=Path("synthetic_test_exposure.fits"),
        file_name="synthetic_test_exposure.fits",
        image=img,
        flags=flags,
        variance=var,
        wcs=None,
        spectral_wcs=None,
        time="2025-04-25T12:00:00",
        detector=1,
        shape=(h, w),
        primary_header={},
        image_header={}
    )
    return exp


# ==============================================================================
# 1. Known Star Flux Recovered Within 5 Percent
# ==============================================================================
def test_known_star_flux_recovered():
    """Verifies that aperture photometry and background subtraction recover known flux within 5%."""
    known_flux_uJy = 150.0
    exp = create_synthetic_exposure(
        shape=(31, 31),
        background=4.2,
        variance_val=0.01,
        star_flux_uJy=known_flux_uJy,
        star_x=15.0,
        star_y=15.0
    )

    res = measure_source(exp, ra_deg=15.0, dec_deg=15.0, r_aperture_pix=2.0, annulus_pix=(4.0, 6.0))

    assert res.flux_uJy is not None, f"Flux measurement returned null: {res.null_reason}"
    assert res.flux_err_uJy is not None
    assert res.null_reason is None

    # Verify recovery within 5%
    rel_error = abs(res.flux_uJy - known_flux_uJy) / known_flux_uJy
    assert rel_error <= 0.05, f"Expected {known_flux_uJy} uJy, recovered {res.flux_uJy} uJy (error: {rel_error*100:.2f}%)"

    # Verify solid angle calculation
    omega, sa_kind = get_pixel_solid_angle_sr(exp, 15.0, 15.0)
    assert omega > 0.0
    assert sa_kind in ("pixel scale", "nominal solid angle")


# ==============================================================================
# 2. Source Off Edges and Corners Return 'outside image' Without Exceptions
# ==============================================================================
def test_edges_and_corners_return_outside_image_without_exception():
    """
    Verifies that sources 1 pixel from each of the 4 edges and 4 corners return
    null with null_reason 'outside image' without raising any exceptions.
    """
    w, h = 50, 50
    exp = create_synthetic_exposure(shape=(h, w), star_flux_uJy=50.0, star_x=25.0, star_y=25.0)

    # 1 pixel from each of the 4 edges (indices: 1 on min side, w-2 on max side)
    edge_coords = [
        (1.0, 25.0, "left edge"),
        (float(w - 2), 25.0, "right edge"),
        (25.0, 1.0, "bottom edge"),
        (25.0, float(h - 2), "top edge"),
    ]

    # 1 pixel from each of the 4 corners
    corner_coords = [
        (1.0, 1.0, "bottom-left corner"),
        (1.0, float(h - 2), "top-left corner"),
        (float(w - 2), 1.0, "bottom-right corner"),
        (float(w - 2), float(h - 2), "top-right corner"),
    ]

    for x_pos, y_pos, label in edge_coords + corner_coords:
        try:
            res = measure_source(exp, ra_deg=x_pos, dec_deg=y_pos, r_aperture_pix=2.0, annulus_pix=(4.0, 6.0))
        except Exception as exc:
            pytest.fail(f"measure_source raised an exception at {label} ({x_pos}, {y_pos}): {exc}")

        assert res.flux_uJy is None, f"Expected null flux at {label} ({x_pos}, {y_pos}), got {res.flux_uJy}"
        assert res.null_reason == "outside image", f"Expected 'outside image' at {label}, got '{res.null_reason}'"

    # Completely outside coordinate
    res_far = measure_source(exp, ra_deg=-10.0, dec_deg=25.0)
    assert res_far.flux_uJy is None
    assert res_far.null_reason == "outside image"


# ==============================================================================
# 2b. Source With Aperture Inside But Annulus Clipped
# ==============================================================================
def test_source_aperture_inside_annulus_clipped_no_exception():
    """
    Verifies that when the aperture circle is fully inside the image but the
    background annulus is partly outside:
    1. It never raises an exception.
    2. Uses the inside portion of the annulus if >= 20 good pixels remain, returning valid flux.
    3. Returns null with 'too few background pixels' if < 20 good pixels remain.
    """
    w, h = 60, 60
    known_flux = 120.0
    exp = create_synthetic_exposure(
        shape=(h, w),
        background=3.0,
        variance_val=0.01,
        star_flux_uJy=known_flux,
        star_x=3.5,
        star_y=30.0
    )

    # Position (3.5, 30.0):
    # Aperture (r=2.0): x in [1.5, 5.5], fully inside [0, 59].
    # Annulus (r_in=4.0, r_out=6.0): x - r_out = 3.5 - 6.0 = -2.5 < 0 (partly clipped on the left).
    # Inside portion has > 40 pixels (well above the 20 pixel threshold).
    try:
        res = measure_source(exp, ra_deg=3.5, dec_deg=30.0, r_aperture_pix=2.0, annulus_pix=(4.0, 6.0))
    except Exception as exc:
        pytest.fail(f"measure_source raised an exception for clipped annulus: {exc}")

    print(f"Good background pixels at (3.5, 30.0): {res.n_background_pixels}")
    assert res.n_background_pixels >= 20, f"Expected >= 20 background pixels, got {res.n_background_pixels}"
    assert res.flux_uJy is not None, f"Expected valid flux, got null with reason '{res.null_reason}'"
    assert res.flux_err_uJy is not None
    assert res.null_reason is None
    rel_err = abs(res.flux_uJy - known_flux) / known_flux
    assert rel_err < 0.10, f"Recovered flux {res.flux_uJy} deviates by {rel_err*100:.2f}%"

    # Position at corner (2.1, 2.1): aperture inside ([0.1, 4.1]), 28 annulus pixels remain (>= 20).
    try:
        res_corner = measure_source(exp, ra_deg=2.1, dec_deg=2.1, r_aperture_pix=2.0, annulus_pix=(4.0, 6.0))
    except Exception as exc:
        pytest.fail(f"measure_source raised an exception at corner (2.1, 2.1): {exc}")

    print(f"Good background pixels at corner (2.1, 2.1): {res_corner.n_background_pixels}")
    assert res_corner.n_background_pixels >= 20, f"Expected >= 20 background pixels at (2.1, 2.1), got {res_corner.n_background_pixels}"
    assert res_corner.flux_uJy is not None, f"Expected valid flux at (2.1, 2.1), got null with reason '{res_corner.null_reason}'"
    assert res_corner.null_reason is None

    # Case that truly leaves fewer than 20 good annulus pixels:
    # We flag most annulus pixels as bad, leaving only 10 good annulus pixels.
    exp_flagged = create_synthetic_exposure(
        shape=(h, w),
        background=3.0,
        variance_val=0.01,
        star_flux_uJy=known_flux,
        star_x=3.5,
        star_y=30.0
    )
    y_g, x_g = np.ogrid[:h, :w]
    d2 = (x_g - 3.5)**2 + (y_g - 30.0)**2
    ann_mask = (d2 >= 16.0) & (d2 <= 36.0)
    ann_indices = np.argwhere(ann_mask)
    # Flag all annulus pixels except the first 10 with the BAD_PIXEL_MASK bit
    for idx_pair in ann_indices[10:]:
        exp_flagged.flags[idx_pair[0], idx_pair[1]] = BAD_PIXEL_MASK

    try:
        res_few = measure_source(exp_flagged, ra_deg=3.5, dec_deg=30.0, r_aperture_pix=2.0, annulus_pix=(4.0, 6.0))
    except Exception as exc:
        pytest.fail(f"measure_source raised an exception for severely flagged annulus: {exc}")

    print(f"Good background pixels when flagged: {res_few.n_background_pixels}")
    assert res_few.n_background_pixels < 20, f"Expected < 20 background pixels, got {res_few.n_background_pixels}"
    assert res_few.flux_uJy is None
    assert res_few.null_reason == "too few background pixels"


# ==============================================================================
# 3. Heavily Flagged Aperture Gives Null
# ==============================================================================
def test_heavily_flagged_aperture_gives_null():
    """Verifies that an aperture with > 30% corrupted pixels yields null with 'too few good pixels'."""
    # Corrupt the central 5x5 region containing the aperture
    exp = create_synthetic_exposure(
        shape=(31, 31),
        star_flux_uJy=100.0,
        star_x=15.0,
        star_y=15.0,
        flag_box=(13, 18, 13, 18)
    )

    res = measure_source(exp, ra_deg=15.0, dec_deg=15.0, r_aperture_pix=2.0, annulus_pix=(4.0, 6.0))
    assert res.flux_uJy is None
    assert res.null_reason == "too few good pixels"


# ==============================================================================
# 4. No Catalogue Match Gives Null
# ==============================================================================
def test_no_catalogue_match_gives_null():
    """Verifies that sources without catalogue counterparts within search radius return null match."""
    with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False) as f:
        f.write("source_id,ra,dec,phot_g_mean_mag\n")
        # Star placed far away at separation > 60 arcseconds
        f.write("123456789,100.0,20.02,15.5\n")
        temp_csv = Path(f.name)

    try:
        source = DetectedSource(
            id="SPX-TEST-001",
            x_pix=10.0,
            y_pix=10.0,
            ra_deg=100.0,
            dec_deg=20.0,
            peak_snr=12.5,
            reference_file="test.fits",
            reference_wavelength_um=2.4
        )

        results = crossmatch_sources([source], catalogue_path=temp_csv, max_radius_arcsec=6.15)
        assert len(results) == 1
        res = results[0]
        assert res.gaia_id is None
        assert res.separation_arcsec is None
        assert res.ads_url is None
        assert res.candidates_in_radius == 0
    finally:
        if temp_csv.exists():
            temp_csv.unlink()


# ==============================================================================
# 5. Catalogue Match at Known Separation (3.0 arcsec)
# ==============================================================================
def test_catalogue_match_known_separation():
    """Verifies accurate angular separation calculation for a known offset of 3.0 arcseconds."""
    # Target at RA=100.0, Dec=20.0
    # Catalogue star placed exactly 3.0 arcseconds north: delta_dec = 3.0 / 3600 deg
    offset_deg = 3.0 / 3600.0
    cat_dec = 20.0 + offset_deg

    with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False) as f:
        f.write("source_id,ra,dec,phot_g_mean_mag\n")
        f.write(f"Gaia-DR3-KnownStar,100.0,{cat_dec:.8f},14.2\n")
        temp_csv = Path(f.name)

    try:
        source = DetectedSource(
            id="SPX-TEST-002",
            x_pix=15.0,
            y_pix=15.0,
            ra_deg=100.0,
            dec_deg=20.0,
            peak_snr=25.0,
            reference_file="test.fits",
            reference_wavelength_um=2.4
        )

        results = crossmatch_sources([source], catalogue_path=temp_csv, max_radius_arcsec=6.15)
        assert len(results) == 1
        res = results[0]

        assert res.gaia_id == "Gaia-DR3-KnownStar"
        assert res.separation_arcsec is not None
        assert abs(res.separation_arcsec - 3.0) < 0.1, f"Expected ~3.0\", got {res.separation_arcsec}\""
        assert res.candidates_in_radius == 1
        assert "Gaia-DR3-KnownStar" in str(res.ads_url)
    finally:
        if temp_csv.exists():
            temp_csv.unlink()


# ==============================================================================
# 6. Forbidden Words Check
# ==============================================================================
def test_no_forbidden_words():
    """
    Enforces the scientific integrity rule:
    Fails if the forbidden candidate words appear in backend/ or src/.
    """
    w1 = "disco" + "very"
    w2 = "disco" + "vered"
    w3 = "new" + " " + "object"
    forbidden_pattern = re.compile(rf"\b({w1}|{w2}|{w3})\b", re.IGNORECASE)

    target_dirs = [REPO_ROOT / "backend", REPO_ROOT / "src"]
    web_src = REPO_ROOT / "web" / "src"
    if web_src.exists():
        target_dirs.append(web_src)

    violations = []

    for directory in target_dirs:
        if not directory.exists():
            continue
        for file_path in directory.glob("**/*"):
            if not file_path.is_file():
                continue
            # Skip this test file itself
            if file_path.name == "test_science.py":
                continue
            # Scan text source files only
            if file_path.suffix.lower() in (".py", ".ts", ".tsx", ".js", ".jsx", ".html", ".md", ".json"):
                try:
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                        for line_num, line in enumerate(f, 1):
                            match = forbidden_pattern.search(line)
                            if match:
                                violations.append(
                                    f"{file_path.relative_to(REPO_ROOT)}:{line_num} "
                                    f"contains forbidden word '{match.group(0)}'"
                                )
                except Exception:
                    pass

    assert len(violations) == 0, "Forbidden words detected:\n" + "\n".join(violations)


# ==============================================================================
# 7. Circular Import Prevention Subprocess Test
# ==============================================================================
def test_no_circular_imports_in_subprocess():
    """
    Imports every module in backend/compute in an isolated fresh Python subprocess.
    Ensures that no module has circular dependencies or imports another module
    that imports it back.
    """
    compute_dir = REPO_ROOT / "backend" / "compute"
    py_files = sorted(compute_dir.glob("*.py"))
    assert len(py_files) > 0, "No Python modules found in backend/compute"

    for py_file in py_files:
        module_name = f"backend.compute.{py_file.stem}" if py_file.name != "__init__.py" else "backend.compute"
        res = subprocess.run(
            [sys.executable, "-c", f"import {module_name}"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True
        )
        assert res.returncode == 0, (
            f"Circular import or failure when importing '{module_name}' in fresh subprocess:\n"
            f"STDOUT: {res.stdout}\n"
            f"STDERR: {res.stderr}"
        )


# ==============================================================================
# 8. Flag Policy Tests with Synthetic Arrays (Bits 19 and 21)
# ==============================================================================
def test_aperture_pixel_with_bit19_gives_suspect_point_with_unchanged_flux():
    """
    Verifies that a pixel with bit 19 (OUTLIER) in the aperture:
    1. Keeps the point valid with completely unchanged flux (not removed from sum).
    2. Marks the point as 'suspect' with reason 'outlier pixel in aperture'.
    """
    known_flux_uJy = 200.0
    # Clean exposure
    exp_clean = create_synthetic_exposure(
        shape=(31, 31),
        background=3.0,
        variance_val=0.01,
        star_flux_uJy=known_flux_uJy,
        star_x=15.0,
        star_y=15.0
    )
    res_clean = measure_source(exp_clean, ra_deg=15.0, dec_deg=15.0, r_aperture_pix=2.0, annulus_pix=(4.0, 6.0))

    # Exposure with bit 19 injected into an aperture pixel (15, 15)
    exp_bit19 = create_synthetic_exposure(
        shape=(31, 31),
        background=3.0,
        variance_val=0.01,
        star_flux_uJy=known_flux_uJy,
        star_x=15.0,
        star_y=15.0
    )
    exp_bit19.flags[15, 15] |= (1 << 19)

    res_bit19 = measure_source(exp_bit19, ra_deg=15.0, dec_deg=15.0, r_aperture_pix=2.0, annulus_pix=(4.0, 6.0))

    # Flux and error must be completely identical (within floating point precision)
    assert res_bit19.flux_uJy is not None
    assert res_bit19.null_reason is None
    assert abs(res_bit19.flux_uJy - res_clean.flux_uJy) < 1e-4, (
        f"Flux changed with bit 19: clean={res_clean.flux_uJy}, bit19={res_bit19.flux_uJy}"
    )
    assert abs(res_bit19.flux_err_uJy - res_clean.flux_err_uJy) < 1e-4

    # Point must be marked suspect with reason 'outlier pixel in aperture'
    assert res_bit19.quality == "suspect"
    assert "outlier pixel in aperture" in res_bit19.quality_reasons
    assert res_bit19.n_flagged_extra_in_aperture >= 1


def test_aperture_pixel_with_only_bit21_source_is_not_suspect():
    """
    Verifies that a pixel with only bit 21 (SOURCE, marks real celestial light):
    1. Does NOT make the point suspect.
    2. Keeps quality as 'ok' (assuming no other suspect criteria are met).
    3. Leaves flux completely unchanged.
    """
    known_flux_uJy = 200.0
    exp_source_flag = create_synthetic_exposure(
        shape=(31, 31),
        background=3.0,
        variance_val=0.01,
        star_flux_uJy=known_flux_uJy,
        star_x=15.0,
        star_y=15.0
    )
    # Set bit 21 (SOURCE) on central star pixels
    exp_source_flag.flags[14:17, 14:17] |= (1 << 21)

    res = measure_source(exp_source_flag, ra_deg=15.0, dec_deg=15.0, r_aperture_pix=2.0, annulus_pix=(4.0, 6.0))

    assert res.flux_uJy is not None
    assert res.null_reason is None
    # Quality must be 'ok', NOT 'suspect'
    assert res.quality == "ok"
    assert len(res.quality_reasons) == 0
    assert res.n_flagged_extra_in_aperture == 0


if __name__ == "__main__":
    pytest.main(["-v", __file__])

