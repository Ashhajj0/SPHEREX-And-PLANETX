#!/usr/bin/env python3
"""
backend/tests/test_export.py
============================
Unit test verifying that the export serializer produces strictly valid JSON
without any NaN or Infinity values, using small in-memory synthetic arrays.
"""

import json
from pathlib import Path
import pytest
import numpy as np

from backend.compute.export_region import sanitize_json
from backend.compute.exposure import Exposure
from backend.compute.photometry import PhotometryResult
from backend.compute.detect import DetectedSource
from backend.compute.spectrum import build_spectrum, Spectrum, SpectralPoint, sort_spectral_points


def test_sanitize_json_eliminates_nans():
    """Verifies that sanitize_json replaces NaN and Infinity with None, allowing strict JSON dumping."""
    dirty_data = {
        "regular_float": 12.34,
        "nan_value": float("nan"),
        "inf_value": float("inf"),
        "neg_inf_value": float("-inf"),
        "nested_dict": {
            "inner_nan": float("nan"),
            "inner_valid": 99.0
        },
        "nested_list": [1.0, float("nan"), 3.0, float("inf")],
        "numpy_nan": np.float32(np.nan),
        "numpy_val": np.float32(42.5)
    }

    cleaned = sanitize_json(dirty_data)

    # Must serialize cleanly with allow_nan=False
    serialized_str = json.dumps(cleaned, allow_nan=False)
    deserialized = json.loads(serialized_str)

    assert deserialized["nan_value"] is None
    assert deserialized["inf_value"] is None
    assert deserialized["neg_inf_value"] is None
    assert deserialized["nested_dict"]["inner_nan"] is None
    assert deserialized["nested_dict"]["inner_valid"] == 99.0
    assert deserialized["nested_list"] == [1.0, None, 3.0, None]
    assert deserialized["numpy_nan"] is None
    assert deserialized["numpy_val"] == 42.5


def test_export_spectrum_schema_and_sorting():
    """
    Verifies that synthetic spectrum points are sorted ascending by wavelength
    using the shared canonical sort function, that points with null wavelength
    go last without crashing, and that to_dict produces valid JSON fields.
    """
    points = [
        SpectralPoint(
            exposure_file="exp2.fits",
            detector=2,
            observation_time="2025-04-25T14:00:00",
            wavelength_um=3.10,
            bandwidth_um=0.05,
            flux_uJy=85.2,
            flux_err_uJy=2.1,
            null_reason=None,
            solid_angle_kind="nominal solid angle",
            n_good_pixels=13,
            n_background_pixels=45
        ),
        SpectralPoint(
            exposure_file="exp_null_wave.fits",
            detector=4,
            observation_time="2025-04-25T18:00:00",
            wavelength_um=None,  # Unplaceable point with null wavelength
            bandwidth_um=None,
            flux_uJy=None,
            flux_err_uJy=None,
            null_reason="coordinate conversion failed",
            solid_angle_kind="nominal solid angle",
            n_good_pixels=0,
            n_background_pixels=0
        ),
        SpectralPoint(
            exposure_file="exp1.fits",
            detector=1,
            observation_time="2025-04-25T12:00:00",
            wavelength_um=1.25,
            bandwidth_um=0.03,
            flux_uJy=float("nan"),  # Unusable point with NaN
            flux_err_uJy=None,
            null_reason="too few good pixels",
            solid_angle_kind="nominal solid angle",
            n_good_pixels=2,
            n_background_pixels=50
        ),
        SpectralPoint(
            exposure_file="exp3.fits",
            detector=3,
            observation_time="2025-04-25T16:00:00",
            wavelength_um=4.50,
            bandwidth_um=0.08,
            flux_uJy=120.4,
            flux_err_uJy=3.5,
            null_reason=None,
            solid_angle_kind="nominal solid angle",
            n_good_pixels=13,
            n_background_pixels=48
        )
    ]

    spectrum = Spectrum(
        source_id="SPX-TEST-001",
        ra_deg=270.33,
        dec_deg=66.56,
        points=points,
        summary={
            "total_exposures": 4,
            "valid_points": 2,
            "null_points": 2,
            "unplaceable_points": 1,
            "wavelength_min_um": 1.25,
            "wavelength_max_um": 4.50
        }
    )

    # Both sort_spectral_points and Spectrum must sort ascending with None last
    directly_sorted = sort_spectral_points(points)
    assert [p.wavelength_um for p in directly_sorted] == [1.25, 3.10, 4.50, None]
    assert [p.wavelength_um for p in spectrum.points] == [1.25, 3.10, 4.50, None]

    clean_dict = sanitize_json(spectrum.to_dict())

    # Verify JSON serializability with allow_nan=False
    json_str = json.dumps(clean_dict, allow_nan=False)
    loaded = json.loads(json_str)

    pts = loaded["points"]
    assert len(pts) == 4
    # Check that exported points are sorted by wavelength with null last
    waves = [p["wavelength_um"] for p in pts]
    assert waves == [1.25, 3.10, 4.50, None]

    # Check null reasons preserved
    null_pts = [p for p in pts if p["null_reason"] is not None]
    assert len(null_pts) == 2
    assert any(p["null_reason"] == "too few good pixels" for p in null_pts)
    assert any(p["null_reason"] == "coordinate conversion failed" for p in null_pts)


def test_export_tiny_synthetic_region_produces_valid_json():
    """
    Verifies that exporting a tiny synthetic region (with both valid and null points)
    produces strictly valid JSON without NaNs, Infinities, or schema errors.
    """
    # 1. Create two small synthetic exposures
    h, w = 31, 31
    exp1 = Exposure(
        path="exp1.fits",
        file_name="exp1.fits",
        image=np.full((h, w), 2.5, dtype=np.float32),
        flags=np.zeros((h, w), dtype=np.int32),
        variance=np.full((h, w), 0.04, dtype=np.float32),
        wcs=None,
        spectral_wcs=None,
        time="2025-04-25T12:00:00",
        detector=1,
        shape=(h, w),
        primary_header={},
        image_header={}
    )

    exp2 = Exposure(
        path="exp2.fits",
        file_name="exp2.fits",
        image=np.full((h, w), 3.1, dtype=np.float32),
        flags=np.zeros((h, w), dtype=np.int32),
        variance=np.full((h, w), 0.05, dtype=np.float32),
        wcs=None,
        spectral_wcs=None,
        time="2025-04-25T14:00:00",
        detector=2,
        shape=(h, w),
        primary_header={},
        image_header={}
    )

    # 2. Create two detected sources: one in the center, one on the edge
    src_center = DetectedSource(
        id="SPX-TEST-001",
        x_pix=15.0,
        y_pix=15.0,
        ra_deg=15.0,
        dec_deg=15.0,
        peak_snr=18.5,
        reference_file="exp1.fits",
        reference_wavelength_um=1.2
    )

    src_edge = DetectedSource(
        id="SPX-TEST-002",
        x_pix=1.0,
        y_pix=15.0,
        ra_deg=1.0,
        dec_deg=15.0,
        peak_snr=6.2,
        reference_file="exp1.fits",
        reference_wavelength_um=1.2
    )

    # 3. Build spectra
    spec_center = build_spectrum(src_center, [exp1, exp2])
    spec_edge = build_spectrum(src_edge, [exp1, exp2])

    assert spec_center.summary["valid_points"] == 2
    assert spec_edge.summary["null_points"] == 2  # 1 pixel from edge -> 'outside image'

    # 4. Assemble export dictionaries
    manifest = {
        "kind": "real",
        "release": "QR2",
        "counts": {
            "exposures": 2,
            "sources": 2,
            "spectrum_points": 4,
            "null_points": 2,
            "unplaceable_points": 0
        },
        "units": {"flux": "uJy", "wavelength": "um"}
    }

    exposures_export = [
        {"id": "E001", "file": "exp1.fits", "wavelength_um": 1.25, "vmin": 0.0, "vmax": 1.0},
        {"id": "E002", "file": "exp2.fits", "wavelength_um": 2.40, "vmin": 0.0, "vmax": 1.0}
    ]

    sources_export = [
        {**src_center.to_dict(), "valid_points": 2, "match": None},
        {**src_edge.to_dict(), "valid_points": 0, "match": None}
    ]

    spectra_export = {
        src_center.id: [pt.to_dict() for pt in spec_center.points],
        src_edge.id: [pt.to_dict() for pt in spec_edge.points]
    }

    # Verify to_dict on PhotometryResult directly
    phot_res = PhotometryResult(
        flux_uJy=45.2, flux_err_uJy=1.5, n_good_pixels=13, n_background_pixels=40,
        wavelength_um=2.45, bandwidth_um=0.04, null_reason=None,
        solid_angle_kind="nominal solid angle", x_pix=15.0, y_pix=15.0, background_mjy_sr=3.2
    )
    assert phot_res.to_dict()["n_background_pixels"] == 40

    # 5. Sanitize and dump with strict allow_nan=False
    for name, data in [("manifest", manifest), ("exposures", exposures_export),
                       ("sources", sources_export), ("spectra", spectra_export)]:
        clean = sanitize_json(data)
        serialized = json.dumps(clean, allow_nan=False)
        reloaded = json.loads(serialized)
        assert reloaded is not None, f"Failed to reload {name}"

    # Verify edge source points are preserved as null in serialized JSON
    loaded_spectra = json.loads(json.dumps(sanitize_json(spectra_export), allow_nan=False))
    edge_pts = loaded_spectra[src_edge.id]
    assert len(edge_pts) == 2
    for p in edge_pts:
        assert p["flux_uJy"] is None
        assert p["null_reason"] == "outside image"


def test_real_export_regression_guard():
    """
    Regression guard: checks real exported science numbers on disk if web/public/real exists.
    Verifies that:
      - SPX-NEP-001 at E021: flux 243422.27 uJy, error 557.00 uJy
      - SPX-NEP-004 at E061: flux 7402.03 uJy, error 196.77 uJy
    both match within 0.1%.
    If the export folder does not exist on disk, the test is skipped cleanly.
    """
    repo_root = Path(__file__).resolve().parent.parent.parent
    candidate_paths = [
        repo_root / "web" / "public" / "real" / "spectra.json",
        repo_root / "public" / "real" / "spectra.json",
    ]
    spectra_path = None
    for cp in candidate_paths:
        if cp.exists():
            spectra_path = cp
            break

    if spectra_path is None:
        pytest.skip("web/public/real/spectra.json not found on disk; skipping regression guard.")

    with open(spectra_path, "r", encoding="utf-8") as f:
        spectra_data = json.load(f)

    # 1. SPX-NEP-001 at E021
    assert "SPX-NEP-001" in spectra_data, "SPX-NEP-001 not found in spectra.json"
    pts_001 = {p.get("exposure_id"): p for p in spectra_data["SPX-NEP-001"]}
    assert "E021" in pts_001, "E021 not found in SPX-NEP-001 spectrum"
    pt_001_e021 = pts_001["E021"]
    flux_001 = pt_001_e021.get("flux_uJy")
    err_001 = pt_001_e021.get("flux_err_uJy")
    assert flux_001 is not None, "Flux for SPX-NEP-001 at E021 is null"
    assert err_001 is not None, "Error for SPX-NEP-001 at E021 is null"
    assert abs(flux_001 - 243422.27) / 243422.27 <= 0.001, f"Flux {flux_001} deviates from 243422.27 by > 0.1%"
    assert abs(err_001 - 557.00) / 557.00 <= 0.001, f"Error {err_001} deviates from 557.00 by > 0.1%"

    # 2. SPX-NEP-004 at E061
    assert "SPX-NEP-004" in spectra_data, "SPX-NEP-004 not found in spectra.json"
    pts_004 = {p.get("exposure_id"): p for p in spectra_data["SPX-NEP-004"]}
    assert "E061" in pts_004, "E061 not found in SPX-NEP-004 spectrum"
    pt_004_e061 = pts_004["E061"]
    flux_004 = pt_004_e061.get("flux_uJy")
    err_004 = pt_004_e061.get("flux_err_uJy")
    assert flux_004 is not None, "Flux for SPX-NEP-004 at E061 is null"
    assert err_004 is not None, "Error for SPX-NEP-004 at E061 is null"
    assert abs(flux_004 - 7402.03) / 7402.03 <= 0.001, f"Flux {flux_004} deviates from 7402.03 by > 0.1%"
    assert abs(err_004 - 196.77) / 196.77 <= 0.001, f"Error {err_004} deviates from 196.77 by > 0.1%"


if __name__ == "__main__":
    pytest.main(["-v", __file__])
