# Scientific Methodology & Photometry Architecture

This document details the mathematical algorithms, noise propagation models, flag filtering policies, and known astronomical limitations implemented in the SPHEREx data processing backend (`backend/compute/`).

---

## 1. Aperture Photometry & Background Annulus

SPHEREx is an infrared space telescope with an effective aperture of 20 cm and an image pixel scale of approximately $6.15''/\text{pixel}$. The optical Point Spread Function (PSF) has a Full Width at Half Maximum (FWHM) of roughly 2.0 pixels ($12.3''$).

### A. Aperture Radius ($r_{\text{ap}} = 2.0\,\text{pixels}$)
- Point source flux is accumulated over a circular aperture of radius $r_{\text{ap}} = 2.0\,\text{pixels}$ ($12.3''$), centered on the source's sub-pixel centroid $(x, y)$.
- This radius encloses $>85\%$ of the total point source energy while minimizing contamination from diffuse background and neighboring sources.

### B. Background Annulus ($r_{\text{in}} = 4.0\,\text{pixels}$, $r_{\text{out}} = 6.0\,\text{pixels}$)
- The zodiacal light (thermal emission and scattered sunlight from interplanetary dust) forms a strong, position-dependent background in raw SPHEREx cutouts.
- A local background annulus spanning from inner radius $r_{\text{in}} = 4.0\,\text{pixels}$ ($24.6''$) to outer radius $r_{\text{out}} = 6.0\,\text{pixels}$ ($36.9''$) is established around each source.
- The local background level $B$ (in $\text{MJy/sr}$) is determined as the **median** of all unflagged, valid pixels within this annulus:
  $$B = \text{median}\left(\{ I_j \mid j \in \text{annulus}, \text{FLAGS}_j \text{ is valid} \}\right)$$
- Subtracting the median background eliminates both large-scale zodiacal gradients and faint diffuse galactic light without biasing the stellar flux.

### C. Background-Subtracted Net Aperture Flux
For all valid aperture pixels $i \in \text{aperture}$:
$$F_{\text{net, MJy/sr}} = \left(\sum_{i \in \text{aperture, valid}} (I_i - B)\right) \times \left(\frac{N_{\text{total\_ap}}}{N_{\text{good\_ap}}}\right)$$
where the scale factor $\frac{N_{\text{total\_ap}}}{N_{\text{good\_ap}}}$ corrects for the small fraction ($\le 30\%$) of masked aperture pixels.

---

## 2. Flux Conversion from Surface Brightness to MicroJanskys

SPHEREx Level 2 image cutouts are calibrated in units of surface brightness: **$\text{MJy/sr}$ (MegaJanskys per steradian)**. Astronomical point sources are measured in units of total flux density: **$\mu\text{Jy}$ (microJanskys)**.

The conversion is computed as:
$$F_{\mu\text{Jy}} = F_{\text{net, MJy/sr}} \times \Omega_{\text{pix}} \times 10^{12}$$
where:
- $\Omega_{\text{pix}}$ is the pixel solid angle in steradians ($\text{sr}$).
  - If a calibrated detector solid angle map is available in `cache/solid_angle/solid_angle_d{detector}.fits`, the pixel-specific solid angle $\Omega_{\text{pix}}(x, y)$ is used (marked `"pixel map"`).
  - Otherwise, the nominal solid angle is derived from the spatial World Coordinate System (WCS) transformation matrix:
    $$\Omega_{\text{pix}} = \left(s_{\text{deg}} \times \frac{\pi}{180}\right)^2 \approx 8.905 \times 10^{-10}\,\text{sr}$$
    (marked `"nominal solid angle"`).
- The factor $10^{12}$ converts MegaJanskys ($10^6\,\text{Jy}$) to microJanskys ($10^{-6}\,\text{Jy}$): $10^6 \times 10^6 = 10^{12}\,\mu\text{Jy}/\text{MJy}$.

---

## 3. Uncertainty & Noise Propagation Formula

Measurement uncertainty is propagated directly from the real `VARIANCE` extension ($(\text{MJy/sr})^2$) of each cutout, combined with the statistical uncertainty of the background estimation.

$$\sigma_{\text{flux, MJy/sr}}^2 = \sum_{i \in \text{aperture, valid}} \text{VARIANCE}_i \cdot \left(\frac{N_{\text{total\_ap}}}{N_{\text{good\_ap}}}\right)^2 + \frac{\pi}{2} \cdot \frac{N_{\text{total\_ap}}^2}{N_{\text{annulus}}} \cdot \sigma_{\text{bkg}}^2$$

### Derivation of Terms:
1. **Pixel Poisson & Readout Variance** ($\sum \text{VARIANCE}_i$):
   The SPHEREx Level 2 `VARIANCE` extension contains the per-pixel sum of detector read noise, dark current variance, and photon shot noise (including source and zodiacal photon counts) from sample-up-the-ramp fitting.
2. **Background Median Uncertainty** ($\frac{\pi}{2} \frac{N_{\text{ap}}^2}{N_{\text{annulus}}} \sigma_{\text{bkg}}^2$):
   Because the local background is estimated as the sample median of $N_{\text{annulus}}$ pixels, its variance is $\frac{\pi}{2} \frac{\sigma_{\text{bkg}}^2}{N_{\text{annulus}}}$ (standard asymptotic variance of the sample median for normally distributed noise). Subtracting this median across all $N_{\text{ap}}$ aperture pixels introduces a fully correlated variance term scaled by $N_{\text{ap}}^2$.

The total 1-sigma flux uncertainty in $\mu\text{Jy}$ is:
$$\sigma_{\mu\text{Jy}} = \sqrt{\sigma_{\text{flux, MJy/sr}}^2} \times \Omega_{\text{pix}} \times 10^{12}$$

---

## 4. Source Detection Strategy & 5-Sigma Threshold

Sources are detected using `photutils.detection.DAOStarFinder` operating on a 2D background-subtracted reference exposure:
1. **Reference Exposure Selection**:
   The pipeline selects the exposure cutout with the lowest median noise variance and the lowest fraction of corrupted pixels across the survey dataset.
2. **2D Spatial Background Modeling**:
   A 2D background and noise RMS map is fitted with `photutils.background.Background2D` using a $24 \times 24$ pixel box, masking all flagged/bad pixels.
3. **Detection Threshold ($5\sigma$)**:
   Point sources are identified where the local peak flux exceeds 5 times the local background RMS ($\text{threshold} = 5.0 \times \sigma_{\text{bkg}}$).
4. **Coordinate Mapping**:
   Sub-pixel detector centroids $(x, y)$ are projected into celestial coordinates $(RA, Dec)$ using the reference exposure's full TAN-SIP spatial WCS.

---

## 5. Astrometric Crossmatching Radius ($6.15''$)

Detected sources are crossmatched against the reference star catalogue (Gaia DR3):
- **Search Radius**: $6.15\,\text{arcsec}$, corresponding to exactly one nominal SPHEREx detector pixel.
- **Proper Motion Propagation**: If proper motion components (`pmra`, `pmdec`) are present in the catalogue, stellar coordinates are propagated from the Gaia DR3 reference epoch (J2016.0) to the SPHEREx observation date:
  $$\Delta t = t_{\text{obs}} - 2016.0\,\text{years}$$
  $$\Delta RA = \frac{\text{pmra} \cdot \Delta t}{3600 \times 1000 \times \cos(Dec)}\,^\circ, \quad \Delta Dec = \frac{\text{pmdec} \cdot \Delta t}{3600 \times 1000}\,^\circ$$
- **Multi-Candidate Identification**: The algorithm counts all catalogue stars lying within the $6.15''$ radius. If more than 1 catalogue star falls within the beam, the field is noted as crowded or blended.
- **Null Match Rule**: If no catalogue star lies within $6.15''$, the Gaia ID and separation are set to `null` (`None`).

---

## 6. Null Value Assignment Rules

Missing, unobserved, or corrupted data is strictly represented as `null` (`None`), **never zero**, and **never interpolated**:

| Null Reason | Trigger Condition |
| :--- | :--- |
| **`"outside image"`** | The source coordinates $(RA, Dec)$ or its surrounding background annulus fall outside the pixel boundaries of the cutout ($x < 0$, $x \ge W$, $y < 0$, or $y \ge H$). |
| **`"too few good pixels"`** | Fewer than 70% of the pixels inside the aperture radius ($r \le 2.0\,\text{pix}$) are valid ($N_{\text{good}} / N_{\text{total}} < 0.70$). |
| **`"flagged pixels"`** | The background annulus contains fewer than 5 valid pixels, preventing a reliable local sky subtraction. |
| **`"no variance"`** | The `VARIANCE` extension contains NaN, missing, or non-positive values inside the aperture. |

---

## 7. Flag Handling Policy (Bad Bits vs Benign Flags)

The `FLAGS` extension stores a 32-bit bitmask per pixel. **Not all non-zero flags represent bad data.** Some bits indicate benign alerts or astronomical source presence. The table below classifies each bit:

| Bit | Integer Value | Flag Name | Classification | Treatment in Photometry | Verification Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **0** | `1` | `TRANSIENT` | **Bad** | Cosmic ray hit; pixel is masked | verified (IRSA SPHEREx Explanatory Supplement) |
| **1** | `2` | `OVERFLOW` | **Bad** | Saturated pixel / full-well overflow; pixel is masked | verified (IRSA SPHEREx Explanatory Supplement) |
| **2** | `4` | `SUR_ERROR` | **Bad** | Readout error during sample-up-the-ramp fit; pixel is masked | verified (IRSA SPHEREx Explanatory Supplement) |
| **3** | `8` | `DEAD_HOT` | **Bad** | Hardware dead or high-dark-current hot pixel; pixel is masked | verified (IRSA SPHEREx Explanatory Supplement) |
| **4** | `16` | `EDGE_PIXEL` | **Benign** | Detector edge region; valid unless near full boundary | unverified |
| **15** | `32768` | `NONLINEAR` | **Bad** | Severe uncorrectable non-linearity; pixel is masked | verified (IRSA SPHEREx Explanatory Supplement) |
| **26** | `67108864` | `BLOOM` | **Bad** | Saturated charge blooming artifact; pixel is masked | verified (IRSA SPHEREx Explanatory Supplement) |
| **27** | `134217728` | `SNOWBALL` | **Bad** | Large secondary cosmic-ray snowball artifact; pixel is masked | verified (IRSA SPHEREx Explanatory Supplement) |

*Mask Definition*:
$$\text{BAD\_PIXEL\_MASK} = 1 + 2 + 4 + 8 + 32768 + 67108864 + 134217728 = 201359375$$
A pixel is treated as bad if and only if `(FLAGS & BAD_PIXEL_MASK) != 0`.

---

## 8. Astronomical & Physical Limitations

1. **Wavelength Dependence of Source Detection**:
   Because SPHEREx uses Linear Variable Filters, source detection is performed on a single reference exposure with a specific central wavelength. An astronomical object with very red infrared colors or strong molecular ice absorption features may fall below the detection threshold on that exposure while being detectable at other wavelengths.
2. **Gaia DR3 Epoch Proper Motion Differences**:
   Gaia DR3 coordinates are referenced to epoch J2016.0, whereas SPHEREx QR2 observations were acquired in April 2025 (~9.3 years later). High-proper-motion stars may drift by up to $1''$--$3''$. The pipeline propagates proper motions when available, but faint stars without measured proper motions may exhibit larger offsets.
3. **Zodiacal Light Background Residuals**:
   The zodiacal background varies along the ecliptic and across spacecraft roll angles. Annulus subtraction assumes the background is locally flat over a $37''$ diameter patch.
4. **Nominal Solid Angle vs Pixel Map**:
   When calibrated detector pixel solid angle maps (`cache/solid_angle/`) are absent, the pipeline computes the nominal solid angle from the WCS transformation matrix. Local optical distortions may cause small spatial variations ($\sim 1\%$) in the effective pixel area across detector corners.
