# SPHEREx Web Export Specification (Phase 3A)

This document describes the data format and export pipeline that bridges the real SPHEREx scientific backend (`backend/compute/`) with the web interface.

All files are exported by running:
```bash
python -m backend.compute.export_region north-ecliptic-pole
```
and verified by running:
```bash
python -m backend.compute.validate_export
```

---

## 1. Export Directory Layout

Results are written to `web/public/real/` (and mirrored to `public/real/`):

```text
web/public/real/
├── README.txt           # Notice stating files are auto-generated from real QR2 data
├── manifest.json        # Region metadata, dataset counts, common grid WCS, units
├── exposures.json       # 120-exposure array sorted by central wavelength
├── sources.json         # 72 detected celestial sources with Gaia DR3 matches
├── spectra.json         # Complete 120-band calibrated spectra for every source
└── images/
    ├── E001.png         # North-Up aligned display images (8-bit grayscale RGBA)
    ├── E002.png
    └── ... (E120.png)
```

---

## 2. Common North-Up TAN Grid & Display Reprojection

### Scientific Principle:
- **Display Only**: Reprojection is applied **strictly for visual presentation** in the web interface so all 120 exposures align seamlessly when the user steps across wavelengths.
- **Photometry Integrity**: All scientific aperture photometry and error propagation are calculated on the authentic, un-resampled science pixels in their native detector coordinates. No photometry is ever recomputed or interpolated during export.

### Grid Geometry:
- **Projection**: Gnomonic Tangent (`RA---TAN`, `DEC--TAN`)
- **Center**: Field center $(RA = 270.3317^\circ, Dec = +66.5614^\circ)$
- **Pixel Scale**: Nominal $6.15''/\text{pixel}$ ($CDELT_1 = -0.0017083^\circ, CDELT_2 = +0.0017083^\circ$)
- **Orientation**: North is Up ($+Y$), East is Left ($-X$)
- **Dimensions**: $146 \times 146$ pixels

---

## 3. Asinh Stretch & Display PNGs

Each image is saved as an 8-bit RGBA PNG:
1. **Masking & Transparency**:
   - Pixels outside the exposure footprint or flagged as corrupted (cosmic rays, saturation, bad pixels) are assigned **Alpha = 0 (fully transparent)**.
   - Valid science pixels are assigned **Alpha = 255 (fully opaque)**.
2. **Percentile Scaling**:
   - The display dynamic range is set by the 1st percentile ($p_1$) and 99.5th percentile ($p_{99.5}$) of valid pixels.
   - Linear normalization:
     $$y = \text{clip}\left(\frac{I - p_1}{p_{99.5} - p_1}, 0, 1\right)$$
3. **Asinh Non-Linear Stretch**:
   - Astronomical images exhibit a high dynamic range (bright stellar cores embedded in faint zodiacal background).
   - An asinh stretch factor ($Q = 8.0$) is applied:
     $$z = \frac{\text{arcsinh}(Q \cdot y)}{\text{arcsinh}(Q)}$$
   - Scaled to 8-bit grayscale: $\text{gray} = \text{round}(z \times 255)$.

---

## 4. Strict Data & JSON Rules

1. **Strict JSON Conformance (`allow_nan=False`)**:
   - All exported JSON files are processed through `sanitize_json()`, which replaces any `NaN`, `+Infinity`, or `-Infinity` with explicit `null`.
   - `json.dump(..., allow_nan=False)` guarantees that standard browser `fetch()` and `JSON.parse()` will never fail.
2. **Zero Synthetic Fallbacks**:
   - `export_region.py` halts immediately with an error if `cache/spherex/` is empty or missing. It never reads from `demo_fixtures/`.
3. **Preservation of Nulls**:
   - Missing or unusable spectral points remain in the spectrum array with `flux_uJy: null`, `flux_err_uJy: null`, and an explicit `null_reason` (`"outside image"`, `"too few good pixels"`, `"no variance"`).
   - This ensures the web viewer renders missing channels as gaps in the continuum rather than false zero-flux absorption lines.
