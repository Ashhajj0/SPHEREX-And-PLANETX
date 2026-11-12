# SPHEREx Technical Data Inspection Report

**Mission Release**: QR2 (Quick Release 2)  
**Permanent Archive DOI**: [10.26131/IRSA652](https://doi.org/10.26131/IRSA652)  
**Archive Collection**: `spherex_qr2`  
**Host**: Caltech / IPAC Infrared Science Archive (IRSA)  

---

## 1. Verified Multi-Extension FITS (MEF) Structure

Measurements obtained directly from real Level 2 SPHEREx Spectral Image Cutouts (`spherex_qr2`):

| Extension | Name | Measured Shape | Data Type | Units | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **HDU 0** | `PRIMARY` | Header only (`NAXIS = 0`) | None | - | measured from files |
| **HDU 1** | `IMAGE` | `(29, 29)` (spatial cutout) | `float32` | `MJy/sr` (MegaJanskys per steradian) | measured from files |
| **HDU 2** | `FLAGS` | `(29, 29)` (spatial cutout) | `int32` | Bitmask | measured from files |
| **HDU 3** | `VARIANCE` | `(29, 29)` (spatial cutout) | `float32` | `(MJy/sr)^2` | measured from files |
| **HDU 4** | `ZODI` | `(29, 29)` (zodiacal model) | `float32` | `MJy/sr` | measured from files |
| **HDU 5** | `PSF` | `(101, 101, 121)` (3D data cube) | `float32` | - | measured from files |
| **HDU 6** | `WCS-WAVE` | `(2212, 1)` (binary table) | Table | - | measured from files |

*Space-Saving Filter Policy*: Raw cutouts from IRSA contain the 3D Point Spread Function cube (`PSF`, ~5 MB per cutout) and `ZODI`. In our local cache pipeline, `fetch_spherex.py` drops `PSF` and `ZODI` upon saving, retaining `PRIMARY`, `IMAGE`, `FLAGS`, `VARIANCE`, and `WCS-WAVE`. This preserves all science flux, error, flags, and spectral lookup data while reducing local file size by >99% (~35 KB per cutout).

---

## 2. Astrometric, Temporal, and Optical Properties

| Property / Keyword | Measured Value | Verification Status |
| :--- | :--- | :--- |
| **Coordinate System (`CTYPE1 / CTYPE2`)** | `RA---TAN-SIP / DEC--TAN-SIP` (Gnomonic TAN projection with SIP polynomial distortion terms) | measured from files |
| **Pixel Scale** | `6.20 arcsec/pixel` (derived from transformation matrix $\sqrt{\lvert PC_{1,1} \cdot PC_{2,2} - PC_{1,2} \cdot PC_{2,1} \rvert} \times 3600''$) | measured from files |
| **Time System (`TIMESYS`)** | `UTC` | measured from files |
| **Observation Timestamp (`DATE-OBS`)** | `2025-04-24T21:06:38.391` (ISO-8601 UTC) | measured from files |
| **Observation Start (`DATE-BEG`)** | `2025-04-24T21:06:38.391` | measured from files |
| **Observation Midpoint (`DATE-AVG`)** | `2025-04-24T21:07:35.950` | measured from files |
| **Observation End (`DATE-END`)** | `2025-04-24T21:08:33.509` | measured from files |
| **Detector Identification (`DETECTOR`)** | Array `4` (Detectors 1–3: SWIR, Detectors 4–6: MWIR) | measured from files |
| **Pipeline Software Version (`VERSION`)** | `6.4+psffix1` (SSDC Pipelines) | measured from files |
| **Spectral WCS Encoding (`CTYPE1W`)** | `WAVE-TAB` (FITS Paper III Table Lookup with alternate WCS key `'W'`) | measured from files |
| **Spectral Lookup Table Target (`PS1_0W`)** | Extension `WCS-WAVE` | measured from files |
| **Central Wavelength Range across Cutout** | $2.418\,\mu\text{m}$ (minimum) to $2.422\,\mu\text{m}$ (maximum) across the $29 \times 29$ pixel cutout | measured from files |
| **Uncertainty Variance Units** | `(MJy/sr)^2` in `VARIANCE` extension | measured from files |
| **Active Data Quality Flags** | Bit flags set in real exposure: bits `[0, 1, 2, 4, 16]` | measured from files |
| **Collection Identifier** | `spherex_qr2` in IRSA Table Access Protocol (TAP) metadata | from IRSA docs (https://caltech-ipac.github.io/irsa-tutorials/spherex-cutouts) |
| **Total Spectral Bands** | 102 continuous channels spanning $0.75\,\mu\text{m}$ to $5.0\,\mu\text{m}$ | from IRSA docs (https://caltech-ipac.github.io/irsa-tutorials/spherex-intro) |
| **Solid Angle Flux Conversion** | Surface brightness in $\text{MJy/sr}$ converts to $\mu\text{Jy}$ by multiplying by pixel solid angle $\Omega_{\text{pix}} = 9.043 \times 10^{-10}\,\text{sr}$ | from IRSA docs (https://caltech-ipac.github.io/irsa-tutorials/spherex-intro) |
| **Survey Cadence** | All-sky survey repeats approximately every 6 months | unverified |

---

## 3. Consequences for Our Design

Derived strictly from measured data structures and confirmed documentation:

### A. How a Spectrum Is Built from Many Exposures
- Traditional telescopes use broad fixed filters where all pixels in an image share a single wavelength.
- SPHEREx uses **Linear Variable Filters (LVF)**. In each exposure, the central wavelength varies continuously along the detector dispersion axis according to the `WCS-WAVE` lookup table.
- A star therefore does **not** have a static wavelength per image: its wavelength depends directly on which pixel column $(x, y)$ it illuminates in that specific exposure.
- To construct a complete 102-band Spectral Energy Distribution (SED) for an astronomical target $(RA, Dec)$:
  1. The pipeline retrieves all cutouts covering the coordinate.
  2. For each cutout, the target's celestial position is converted to pixel coordinates $(x, y)$ using the spatial WCS (`IMAGE` header).
  3. The exact central wavelength and bandwidth are evaluated at $(x, y)$ via the spectral WCS table (`WCS(header, fobj=hdulist, key="W")`).
  4. Aperture photometry is computed on `IMAGE` with variance propagated from `VARIANCE`.
  5. The extracted fluxes are sorted by central wavelength to produce the 102-channel SED curve.

### B. How Bands with No Coverage Become Null
- Because satellite scanning steps across the sky, a target may not be covered in all 102 filter columns in a single survey pass.
- Furthermore, pixels flagged by critical bits in the `FLAGS` bitmask (e.g., cosmic rays, saturation, bad pixels) are invalid.
- When an object has no coverage or invalid data in a specific band, that band must be explicitly stored as `null` (never `0.0 µJy`).
- The user interface must render `null` channels as open gaps in the SED curve, rather than dropping to zero flux, to prevent introducing false absorption troughs into astronomical analysis.

### C. What This Means for Moving-Object Pairs
- For Solar System moving body detection (asteroids, comets), comparing two dates requires that the images match in wavelength; subtracting images of differing wavelengths creates severe color residuals.
- Valid epoch pairs must satisfy three conditions:
  1. Observed on the **same detector array** (1 through 6).
  2. Central wavelength at the target coordinate must match to within **2 percent**.
  3. Observation dates (`DATE-OBS`) must be separated by at least **14 days**.
- Our pipeline automatically evaluates these criteria in `find_epoch_pairs()` and saves the verified candidate pairs to `cache/spherex/<region_id>/epoch_pairs.json`.
