# SPHEREx Spectral Sky Explorer: Resources, Credits and Build Prompts

NASA International Space Apps Challenge 2026 · Challenge: **Planet X and SPHEREx** · Team **Red Shift** · Dhaka, Bangladesh

Live site: **https://spherex-and-planetx.vercel.app/** · Repository: **https://github.com/Ashhajj0/SPHEREX-And-PLANETX** · Demo video: **https://youtu.be/NC_445RK4Pg** (*240-second Prescreening video | PLANETX and SPHEREX | NASA Space APP Challenge 2026*)

> This file records the project, data, references, software, AI tools, video production and build prompts. Items marked **[TEAM TO CONFIRM]** cannot be established from the supplied repository, website or video link and must be completed by the team before final submission.

**Link review performed:** repository `main` branch, its `README.md`, `package.json`, `requirements.txt`, `index.html`, `src/index.css`, `metadata.json` and `docs/AI_USE.md`; the live Vercel URL; and the YouTube watch-page title. The live site's JSON data endpoints and the video's full production metadata were not accessible from these public page views.

## Contents

1. [What this project is](#1-what-this-project-is)
2. [Data sources](#2-data-sources)
3. [Scientific references and documentation](#3-scientific-references-and-documentation)
4. [Software, libraries and services](#4-software-libraries-and-services)
5. [Design assets](#5-design-assets)
6. [AI tools disclosure](#6-ai-tools-disclosure)
7. [Video and media production](#7-video-and-media-production-capcut-filmora-ai-subtitles-stock-footage)
8. [Architecture and how to run](#8-architecture-and-how-to-run)
9. [Deploying the live site](#9-deploying-the-live-site)
10. [Verified results and limitations](#10-verified-results-and-limitations)
11. [Prompt library](#11-prompt-library)
12. [Helper scripts](#12-helper-scripts)
13. [Problems met and how we fixed them](#13-problems-met-and-how-we-fixed-them)
14. [Citation, acknowledgements, license](#14-citation-acknowledgements-license)
15. [Submission checklist](#15-submission-checklist)

---

## 1. What this project is

A website that is also a scientific tool. The documented build uses real SPHEREx infrared exposures of the North Ecliptic Pole, detects sources, measures each source across the available exposures to build a spectrum with error bars, and matches sources to the Gaia DR3 catalogue. It also includes a moving-object screening workflow; any moving-object output must be presented only as a candidate and only when a valid epoch pair and measured result are available. The 120-exposure QR2 dataset summarized below spans only about three days, so it does not by itself meet the project's 14-day screening window.

| Fact | Value |
|---|---|
| Sources detected | 72 (5 sigma, on reference exposure E076, 3.049 µm, detector 4) |
| Exposures | 120 real cutouts, 6 detectors, 2025-04-24 to 2025-04-27, 0.74 to 4.83 µm |
| Spectrum points | 8,640 (8,342 valid, 298 null: 269 outside image, 29 too few good pixels) |
| Suspect points | 1,589 (18.39 percent): near image edge, flagged pixel in aperture, or peak pixel flagged |
| Sources with 100+ valid points | 71 of 72 |
| Gaia matches | Radius 6.15 arcsec; the 5 brightest sources matched within 0.11 to 0.50 arcsec |
| Photometry | Aperture radius 2.0 px, background annulus 4.0 to 6.0 px, error from the VARIANCE extension |
| Flux units | MJy/sr converted to µJy with a **nominal** pixel solid angle (absolute flux is approximate) |

Core rules we never broke:
1. Missing data is `null`, never zero, never interpolated.
2. We never use the words "discovery", "discovered" or "new object". Moving-object results are **candidates** that need independent confirmation.
3. Every number comes from tested Python. No AI model produced a number.
4. Anything that is not real SPHEREx data is labelled "Synthetic fixture".
5. The core science results are packaged as static files, so the data views can be served without live NASA queries. Confirm offline behavior separately for external fonts, any Gemini/API feature, and the deployed build.

---

## 2. Data sources

| Dataset | Provider | Identifier | What we used |
|---|---|---|---|
| **SPHEREx Quick Release 2 spectral images** (epoch A) | NASA/IPAC Infrared Science Archive (IRSA) | DOI **10.26131/IRSA652**, collection `spherex_qr2` | 120 cutouts (about 146 x 146 px, 6.15 arcsec per pixel) around RA 270.3317, Dec +66.5614 via IRSA's cutout service. Kept IMAGE (MJy/sr), FLAGS, VARIANCE and WCS-WAVE. Dropped PSF and ZODI to save space. |
| **SPHEREx epoch B** (moving-object screening) | IRSA | Collection `spherex_dr1_deep`; no DOI verified in the supplied sources (cite by collection name unless the team confirms a release DOI). | Up to 60 cutouts of the same field, taken at least 14 days after epoch A |
| **Gaia DR3** | ESA, Gaia archive (TAP service) | Table `gaiadr3.gaia_source` | 611 sources around the field: `source_id, ra, dec, phot_g_mean_mag, phot_bp_mean_mag, phot_rp_mean_mag, pmra, pmdec, parallax`. Proper motions are applied to the observation epoch when matching. |
| **NASA ADS** | Smithsonian/NASA | ui.adsabs.harvard.edu | Search links only (built from the Gaia identifier). No API, no token. |

Not used: AllWISE (configured, never downloaded), the South Ecliptic Pole and COSMOS regions (never downloaded), and any synthetic data except the clearly labelled fixtures in `demo_fixtures/`.

Exact file lists, sizes and checksums: `data/provenance.json`. Retrieval date: November 2026 (see the timestamps in that file).

**Repository cross-check:** the public README currently describes three configurable target regions and reports a pixel scale of 6.20 arcsec/pixel, while the measured results in this resource record describe only the North Ecliptic Pole and use 6.15 arcsec/pixel. These statements should be reconciled against `docs/DATA_NOTES.md` and the actual cutout headers before the README and submission are treated as consistent. The README also documents optional AllWISE/COSMOS pipeline support; that is not evidence that AllWISE data were downloaded or used in the final analysis.

**Important note on collection names:** when the project notes re-checked IRSA's collection list on 2026-11-13, `spherex_qr2` no longer appeared. The list showed `spherex_dr1`, `spherex_dr1_cal`, `spherex_dr1_cube`, `spherex_dr1_deep`, `spherex_qr3` and `spherex_qr3_deep`. The extracted results are committed in the repository's `public/real/` data folder, so the deployed site is intended to read static results rather than re-download the archive at runtime. To rebuild from raw data, list collections with `Irsa.list_collections()` and choose a currently available collection. Numbers may differ.

**Scope clarification:** the public README describes a pipeline configured for three target regions, but the measured results recorded in this document are for the North Ecliptic Pole only. Do not describe the final measured output as a three-region analysis unless the other regions have been processed and verified.

---

## 3. Scientific references and documentation

Mission and archive documentation:
- IRSA SPHEREx archive documentation, data products: https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products
- IRSA tutorial, SPHEREx spectral image cutouts: https://caltech-ipac.github.io/irsa-tutorials/spherex-cutouts
- IRSA tutorial, SPHEREx introduction: https://caltech-ipac.github.io/irsa-tutorials/spherex-intro
- IRSA tutorial, SPHEREx PSF: https://caltech-ipac.github.io/irsa-tutorials/spherex-psf/
- IRSA SPHEREx Data Explorer, Spectrophotometry tool help: https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/sp.html
- IRSA SPHEREx Data Explorer, Mosaic tool help: https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/mosaic.html
- IRSA cloud data access: https://irsa.ipac.caltech.edu/cloud_access/
- IRSA SPHEREx mission page: https://irsa.ipac.caltech.edu/Missions/spherex.html
- SPXQuery quality-control guide (community tool, used as a reference for flag handling): https://spxquery.readthedocs.io/en/latest/user_guide/quality_control.html

Papers (arXiv):
- The SPHEREx Image and Spectrophotometry Processing Pipeline: arXiv:2511.15823
- The SPHEREx Satellite Mission: arXiv:2511.02985
- SPHEREx: NASA's Near-Infrared Spectrophotometric All-Sky Survey: arXiv:2404.11017
- Spectral response of SPHEREx: arXiv:2602.09139
- The SPHEREx Ices Investigation: An Overview: arXiv:2603.22135 (design resolving powers by band)
- A bestiary of low-level electrical artifacts in SPHEREx flight data: arXiv:2608.09862 (flag and artifact background)
- SPHEREx 0.75 to 5 µm Spectra for a Sequence of Nearby Brown Dwarfs: arXiv:2607.00543 (flag-based quality cuts)

Things we took from these sources:
- Each spectral image carries IMAGE, FLAGS, VARIANCE, ZODI, PSF and WCS-WAVE extensions. Wavelength varies per pixel through a lookup table (WCS-WAVE, spectral key "W").
- Design resolving power: about 41 (detectors 1 to 3), 35 (4), 110 (5), 130 (6). Wavelength ranges: 0.75 to 1.11, 1.11 to 1.64, 1.64 to 2.42, 2.42 to 3.82, 3.82 to 4.42, 4.42 to 5.00 µm.
- The SOURCE flag (bit 21) marks pixels that contain source light and is **not** a bad-pixel flag. OVERFLOW (bit 1) means near saturation.
- The 102 nominal channels follow a geometric layout across each detector; our dataset is 120 exposures, not a 102-band grid.

---

## 4. Software, libraries and services

**Python 3.12.10** (virtual environment `.venv`)

| Package | Version we ran | Purpose |
|---|---|---|
| astropy | 8.0.2 | FITS, WCS, coordinates, time |
| astroquery | 0.4.11 | IRSA queries (SIA2) |
| pyvo | 1.10.0 | TAP queries (Gaia, catalogues) |
| numpy | 2.5.4 | arrays |
| photutils | 3.1.1 | source detection, apertures |
| scipy | 1.18.1 | filters (moving-object screening) |
| requests | 2.34.2 | cutout downloads |
| pyyaml | 6.0.3 | region configuration |
| tqdm | 4.70.1 | progress bars |
| fastapi / uvicorn | 0.162.2 / 0.54.0 | optional local API |
| pytest | 9.2.0 | tests |
| pillow | `>=10.0.0` declared in `requirements.txt` (installed version not verified) | PNG export |
| reproject | `>=0.13.0` declared in `requirements.txt` (installed version not verified) | Reprojection of display images |
| pyflakes | dev tool | catching undefined names |

**Website:** React `^19.0.1`, React DOM `^19.0.1`, Vite `^8.3.0`, TypeScript `^7.0.2`, Tailwind CSS `^4.3.3`, `@tailwindcss/vite` `^4.3.3`, and `@vitejs/plugin-react` `^6.1.1`. Other declared dependencies: `@google/genai` `^2.4.0`, `lucide-react` `^0.546.0`, `express` `^4.21.2`, `dotenv` `^17.2.3`, and `motion` `^12.23.24`. Declared dev dependencies include `esbuild` `^0.25.0`, `autoprefixer` `^10.4.21`, `tsx` `^4.21.0`, `typescript` `^7.0.2`, `tailwindcss` `^4.3.3`, and the listed React/Node/Express type packages. These are version ranges from the repository's `package.json`, not verified installed versions. Node.js/npm versions were not specified in the supplied links. See [`package.json`](https://github.com/Ashhajj0/SPHEREX-And-PLANETX/blob/main/package.json).

**Services and tools:** GitHub (repository), Vercel (hosting), Visual Studio Code, Windows PowerShell, Git.

Record exact versions for judges:
```text
pip freeze > docs/python-versions.txt
npm ls --depth=0 > docs/node-versions.txt
```

---

## 5. Design assets

- **Layout and visual design:** Google Stitch (five screens: Home, Explorer, Moving Objects, Method, About), then rebuilt in code.
- **Fonts actually loaded by the shipped app:** Archivo Narrow for interface text and Space Mono for monospace/data text, loaded from Google Fonts in `index.html` and selected in `src/index.css`. Both are licensed under the SIL Open Font License 1.1. The original design brief's Archivo / Fragment Mono names do not match the current implementation.
- **Icons:** `lucide-react` `^0.546.0` (ISC License) and Google Material Symbols Outlined (Apache License 2.0), loaded through Google Fonts in `index.html`. See [`index.html`](https://github.com/Ashhajj0/SPHEREX-And-PLANETX/blob/main/index.html), [`src/index.css`](https://github.com/Ashhajj0/SPHEREX-And-PLANETX/blob/main/src/index.css), [Lucide license](https://lucide.dev/license), and [Google Material Symbols licensing](https://developers.google.com/fonts/docs/material_symbols).
- **Colours:** dark theme with a wavelength colour ramp (pale gold at 0.75 µm through orange to deep red at 5 µm). Tokens are in the stylesheet.
- **Images in the app:** none from third parties. Sky images are PNG renders of the SPHEREx cutouts made by `backend/compute/export_region.py`.

---

## 6. AI tools disclosure

| Tool | Used for | Human review |
|---|---|---|
| **Google AI Studio (Build mode)** | Generated the website code and the first versions of the Python pipeline | Every script was run locally, tested and compared against documentation and real files |
| **Google Stitch** | Interface design of the five screens | Layout rebuilt and checked by the team |
| **Claude (Anthropic)** | Planning, writing and refining prompts, diagnosing errors, reviewing outputs against documentation, and writing the helper scripts in section 12, the README and AI-use drafts, the demo script and this file | Outputs were checked against the real data and IRSA documentation |
| **Video production tools** | The linked video is published, but its editing and caption tools are not identified by the repository/watch-page metadata. See section 7 for team confirmation. | Team to document the actual workflow. |
| **Google Gemini API / `@google/genai`** | The web repository declares `@google/genai` `^2.4.0`, and `metadata.json` lists a server-side Gemini API capability. The supplied public links do not establish which deployed feature calls the API or whether the feature is enabled. **[TEAM TO CONFIRM: inspect the server/API route and live UI; state the exact feature or say the dependency/capability is unused.]** Any AI explanation must not create or alter scientific measurements. | **[TEAM TO CONFIRM: describe human review if the feature is active.]** |

**What the team did ourselves (as stated in `docs/AI_USE.md`):** chose the challenge, sky region and science rules; ran the scripts and downloaded the real SPHEREx data locally; reviewed AI outputs against documentation and real files; and corrected erroneous AI-generated results. The video is publicly linked above, but the recording/editing credits and individual responsibilities are not stated in the repository. **[TEAM TO CONFIRM: list who recorded, presented, edited and reviewed the video.]** See [`docs/AI_USE.md`](https://github.com/Ashhajj0/SPHEREX-And-PLANETX/blob/main/docs/AI_USE.md).

**Problems the AI produced that we found and fixed**
- A catalogue script that silently saved made-up rows when a query failed.
- A data report generated from synthetic files instead of the real ones.
- Invented content: a 102-band table with spectral-line notes (one of them wrong), example asteroids with made-up motion rates, and wrong detector resolving powers.
- Unsupported home-page claims ("72 stars", "continuous coverage", 0.75 to 5.00 µm).
- Spectrum dips on bright stars. We traced them to saturated core pixels flagged OVERFLOW and now mark those points as suspect instead of hiding or correcting them.
- A moving-object routine with swapped match indices, which silently paired the wrong sources until we found it.

**Reproducibility:** all prompts are in section 11. Status of each (used, corrected, or not applied) is listed there.

---

## 7. Video and media production

Everything in this section describes the submission video. **Fill in what is true and delete what is not.**

### 7.1 Tools

| Item | Tool and version | Used for |
|---|---|---|
| Screen recording | **[TEAM TO CONFIRM: app and version]** | The video link does not identify the screen-recording software. |
| Editing | **[TEAM TO CONFIRM: editor and version]** | The video link does not identify the editing software or editing workflow. |
| Editing / captions | **[TEAM TO CONFIRM: app/version, or "not used"]** | Confirm whether captions were auto-generated, manually typed, or not used. |
| Audio | **[TEAM TO CONFIRM: microphone/recording setup and processing]** | Confirm voice-over recording and any noise removal. |

### 7.2 AI features used in the video (tick what applies)

**Status: not verifiable from the public YouTube watch page or repository.** Check the final editing project/export and tick only the features actually used.

- [ ] Auto-generated captions / subtitles (name the app)
- [ ] AI voice or text-to-speech (name the tool and voice)
- [ ] AI-generated background music or sound effects
- [ ] AI background removal, upscaling or other visual effects
- [ ] AI translation of captions
- [ ] None of the above

### 7.3 Caption (subtitle) statement

Use this wording if it is true, and edit it if it is not:

> **Template only — use this sentence only if accurate:** Subtitles were auto-generated with **[captioning app and version]**, then proofread line by line by **[team member]** against the voice-over script. Technical terms were corrected by hand. If subtitles were manual or not used, replace this statement accordingly.

### 7.4 Caption workflow

1. Finish the voice-over and the edit first, so the timing does not change afterwards.
2. Generate the automatic captions in the editor.
3. Proofread every caption against the script. Auto-captions often get these wrong, so check each one:
   - SPHEREx, IRSA, Gaia DR3, ADS, Apache-2.0
   - micron or micrometre (µm), arcsecond, ecliptic, Hawaii-2RG
   - the DOI: **10.26131/IRSA652** (show it on screen, so viewers do not depend on the caption)
4. Keep captions short (one or two lines), and keep them clear of the bottom status bar of the app.
5. Export two files: the video with burned-in captions, and the subtitle file (`.srt`). Save the `.srt` in `docs/video/captions.srt`.
6. Watch the whole video once with the sound off, to make sure the captions alone tell the story.

### 7.5 Stock footage and media log

List **every** clip, image and sound that did not come from our own app or recordings. Keep a screenshot of the license terms for each asset.

| # | Asset (description) | Where used (timestamp) | Source site / app library | Author or credit line | License | URL | Edited? |
|---|---|---|---|---|---|---|---|
| 1 | **[TEAM TO CONFIRM: first external clip/image/sound, or write "none" after checking the timeline]** | **[TEAM TO CONFIRM: timestamp]** | **[TEAM TO CONFIRM: source/library]** | **[TEAM TO CONFIRM: creator/credit]** | **[TEAM TO CONFIRM: license]** | **[TEAM TO CONFIRM: URL]** | **[TEAM TO CONFIRM]** |
| 2 | **[Add each additional external asset, or delete unused rows]** | | | | | | |
| 3 | | | | | | | |

Notes:
- Assets from the built-in libraries of CapCut or Filmora are licensed under those apps' terms, which can restrict reuse. Record where each asset came from and read the terms.
- For NASA, ESA or JPL imagery, use the credit line shown on the image's own page, and follow NASA's media usage guidelines on nasa.gov. Do not use logos in a way that implies endorsement.
- Prefer our own screen recordings over stock footage wherever possible. They are original, accurate and need no license.

### 7.6 Music and sound effects

| Track | Source | License | Where used |
|---|---|---|---|
| **[TEAM TO CONFIRM: track title and source, or "none" after checking the final edit]** | **[TEAM TO CONFIRM]** | **[TEAM TO CONFIRM]** | **[TEAM TO CONFIRM: timestamp]** |

### 7.7 People and likenesses

The project build prompts contain an instruction excluding the name, voice or likeness of anyone under 18. The supplied YouTube link does not establish the ages of people shown or heard, and this resource file does not include the official 2026 rule text. **[TEAM TO CONFIRM: check the current official Space Apps rules, then record who checked and the date; review every visible or audible participant.]**

### 7.8 Where the images in the video come from

- App footage: identify whether each screen capture is an original team recording.
- Data credit on screen: use "SPHEREx QR2, NASA/IPAC IRSA, DOI 10.26131/IRSA652. Gaia DR3, ESA" only where those data are shown.
- Moving-object scenes: label epoch A / epoch B with the actual release and provenance. Do not claim the app compares two real epochs unless the current deployed build and generated results confirm that it does.

### 7.9 Demo script (240 seconds)

| Time | Show | Say |
|---|---|---|
| 0:00-0:20 | Home page | "SPHEREx is NASA's telescope mapping the whole sky in infrared. We built a tool that turns its raw images into spectra you can click and read." |
| 0:20-0:45 | About or Home | "Our data is real: SPHEREx Quick Release 2 from NASA's IRSA archive, DOI 10.26131 slash IRSA652. 120 cutouts of the North Ecliptic Pole across all six detectors, matched against Gaia DR3." |
| 0:45-1:30 | Explorer: step exposures, click SPX-NEP-001 | "Each image is one exposure at one wavelength. Click a source and its spectrum draws from the available exposures, with error bars. The Match tab shows the Gaia DR3 catalogue identifier and the measured angular separation." |
| 1:30-2:10 | Hover a hollow point on SPX-NEP-002 | "Missing data is never filled in. Hollow points are marked suspect. These dips come from saturated star cores flagged as overflow. We traced the cause, and we mark those points instead of hiding or fixing them." |
| 2:10-2:40 | Method page | "Aperture photometry with a background ring, errors from SPHEREx's own variance maps. Fluxes use a nominal pixel solid angle, so absolute values are approximate." |
| 2:40-3:20 | Moving Objects | "The moving-object page applies a screening rule that requires a time baseline of at least 14 days and matching detector/wavelength conditions. Our 120 QR2 exposures span only about three days, so this set alone does not provide a qualifying epoch pair. We therefore do not claim a measured moving-object candidate from these QR2 exposures. Any separate epoch-B result must be shown with its own release label, measured pair count and alignment uncertainty." |
| 3:20-3:40 | Limitations | "Limits: one region, detection on one reference exposure, approximate calibration." |
| 3:40-4:00 | About, DOI | "Our project links its SPHEREx data to the IRSA archive DOI. We used Google AI Studio, Stitch and Claude, then reviewed and corrected the outputs against real data and documentation. Thank you." |

Rules: do not say "discovery". Say "120 exposures", not "102 bands".

### 7.10 Recording checklist

- Turn wifi off and run `npm run preview` for the backup recording.
- 1920 x 1080, browser zoom 100 percent, notifications off.
- One take per scene, voice-over recorded in a quiet room.
- Total length under 4:00 (the linked YouTube title identifies it as a 240-second prescreening video). **[TEAM TO CONFIRM: insert the exact submission deadline and time zone from the official 2026 Participant Guide; they are not stated in the supplied GitHub, website or YouTube links.]**
- Export a final MP4 and keep the project file.

---

## 8. Architecture and how to run

```text
repo/
  README.md, RESOURCES_AND_PROMPTS.md
  LICENSE (Apache-2.0) and NOTICE: add/verify before claiming this license; the current linked main branch did not expose LICENSE
  docs/            AI_USE.md, DATA_NOTES.md, METHOD.md, video/
  data/            provenance.json
  cache/           (ignored by git) real FITS and catalogue downloads
  demo_fixtures/   small labelled synthetic fixtures
  pipeline/        fetch_spherex.py, fetch_catalogue.py, inspect_fits.py,
                   build_provenance.py, verify_data.py, make_fixtures.py,
                   get_epoch_b.py
  backend/compute/ exposure, detect, photometry, spectrum, crossmatch,
                   common, export_region, validate_export, moving_candidates
  backend/tests/   pytest tests
  src/             React website (pages: Home, Explorer, Moving Objects,
                   Method, About)
  public/real/     generated results the website reads (committed)
  web/public/real/ same results, generation target
```

Run the site (no download needed, results are committed):
```text
npm install --legacy-peer-deps
npm run dev
```

Rebuild the data pipeline (Windows PowerShell):
```text
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python pipeline/fetch_spherex.py
python pipeline/fetch_catalogue.py
python pipeline/inspect_fits.py
python pipeline/build_provenance.py
python pipeline/verify_data.py
python -m backend.compute.export_region north-ecliptic-pole
python -m backend.compute.validate_export
pytest backend/tests -q
```

Moving-object screening (after the pipeline above):
```text
pip install pillow reproject
python pipeline/get_epoch_b.py --collection spherex_dr1_deep
python -m backend.compute.moving_candidates --max-pairs 8
```

How the website finds data: it fetches `/real/manifest.json`, `exposures.json`, `sources.json`, `spectra.json` and `images/E###.png`, plus `/real/moving/index.json` for the moving-object page. If a file is missing, the app says so instead of inventing data.

---

## 9. Deploying the live site

1. Make sure `public/real` and `web/public/real` are committed. They must **not** be in `.gitignore`. `cache/`, `.venv/`, `node_modules/` and `dist/` must be.
2. Add a file `.npmrc` in the repository root containing exactly: `legacy-peer-deps=true`.
3. Test the production build locally:
```text
npm run build
Test-Path dist\real\manifest.json
Test-Path dist\real\moving\index.json
npm run preview
```
4. On vercel.com: Add New, Project, import the repository. Framework: Vite. Build command: `npm run build`. Output directory: `dist`. Deploy.
5. Check that `https://YOUR-SITE.vercel.app/real/manifest.json` shows JSON, then click through all five pages.

If the live site says the real files were not found, the data did not reach the deployment. Run `git ls-files public/real | Measure-Object` (it must list files), then redeploy.

---

## 10. Verified results and limitations

Regression values that must never change after a re-export:
- SPX-NEP-001 at exposure E021: flux 243422.27 µJy, error 557.00 µJy.
- SPX-NEP-004 at exposure E061: flux 7402.03 µJy, error 196.77 µJy.

| Detector | Design range (µm) | Resolving power | Our exposures |
|---|---|---|---|
| 1 | 0.75-1.11 | about 41 | 22 |
| 2 | 1.11-1.64 | about 41 | 23 |
| 3 | 1.64-2.42 | about 41 | 15 |
| 4 | 2.42-3.82 | about 35 | 22 |
| 5 | 3.82-4.42 | about 110 | 23 |
| 6 | 4.42-5.00 | about 130 | 15 |

Flag census on our 120 cutouts (2,505,292 pixels):

| Bit | Name | Share | Rejected by our code |
|---|---|---|---|
| 0, 1, 2 | TRANSIENT, OVERFLOW, SUR_ERROR | 0.70, 0.04, 0.49 percent | yes |
| 6 | NONFUNC | 0.17 percent | no |
| 7, 11, 12, 17 | not named in the sources we read | 0.89, 0.05, 0.00, 0.29 percent | no |
| 19 | OUTLIER | 2.07 percent | no |
| 21 | SOURCE | 38.07 percent | no (correct: it marks source light) |

Our code's bad-pixel mask contains bits 0, 1, 2, 3, 15, 26 and 27 (as printed by `check_flags.py`). We did not apply a stricter policy for bits 6, 7, 11 and 19 (prompt P10 describes it).

**Limitations**
- Absolute flux is approximate (nominal pixel solid angle, not IRSA's calibrated map).
- Sources were detected on one reference exposure; sources faint at 3.05 µm may be missed.
- 18 percent of points are suspect. Bright-star core pixels can be flagged OVERFLOW; the flux is then biased low and the point is marked, not corrected.
- Flag bits 6, 7, 11 and 19 appear in about 3 percent of pixels and are not removed from the sums.
- One region only.
- Moving-object screening compares QR2 cutouts (epoch A) with cutouts from `spherex_dr1_deep` (epoch B). The releases may differ slightly in calibration, so epochs are aligned with matched stationary stars. Results are candidates only. In 15 arcminute cutouts, many entries are expected to be artifacts, chance pairings or high-proper-motion stars. Candidates are not yet checked against known solar-system objects (a natural next step).
- Moving-object results: **Not established by the supplied links.** Do not enter a pair count, candidate count or alignment scatter without reading the final output in `public/real/moving/` (or the equivalent generated `moving/index.json`). The 120 QR2 exposures in this report span about three days and cannot form a pair under the stated 14-day screening rule. If a separate DR1-deep epoch-B run was used, record its actual measured outputs separately.

---

## 11. Prompt library

All prompts were used in **Google AI Studio (Build mode)** unless stated. How to use them:
- Paste **one at a time**, test, then continue. Never combine two phases.
- AI Studio cannot run Python. Python files are written by it as real files, then run locally.
- Each new zip can overwrite local fixes. After downloading, copy only the folders that changed, and re-check your fixes.

| ID | Purpose | Status |
|---|---|---|
| P1 | Project briefing (no building) | Used |
| P2 | Google Stitch design prompt | Used (in Stitch) |
| P3 | Master build prompt (rules and architecture) | Used |
| P4 | Rebuild the website from the Stitch design | Used |
| P5 | Phase 1: real-data pipeline | Used, then corrected (this is the corrected version) |
| P6 | Phase 2: science code | Used |
| P6a | Fix: aperture at image edges | Used |
| P6b | Fix: circular import and sorting | Used |
| P6c | Fix: tests (`to_dict`, sorting, corner case) | Used |
| P7 | Phase 3A: export real results | Used |
| P8 | Phase 3B: connect the website to real data | Used |
| P9 | Final fix pass (suspect quality fields, text and claims) | Used |
| P10 | Flag policy: mark more flag bits as suspect | **Not applied** (ran out of credits) |
| P11 | Targeted text fixes | Applied partly by hand |
| P12 | Handoff prompt for a new chat | Used |

If you rebuild from scratch, fold P6a to P6c into P6 so the bugs do not appear.

### P1: Project briefing (paste first, before anything else)

```text
I want you to understand my project before we do any work. Do NOT design, code
or generate anything yet. Read everything, then reply with a short summary in
your own words and a list of questions you still have.

ABOUT US AND THE EVENT
Team of [number] people from [city], Bangladesh, in the NASA International
Space Apps Challenge 2026 (global hackathon, November 2026). We chose
"Planet X and SPHEREx". Skill level: [beginner/intermediate/advanced]. Time
before the event: about [number] days.

THE CHALLENGE
SPHEREx is a NASA infrared space telescope surveying the whole sky in 102
infrared wavelength bands. The challenge asks us to explore cosmic maps and
astronomical data connected to the SPHEREx mission.

WHAT WE ARE BUILDING
A website that is also a real scientific tool, the "SPHEREx Spectral Sky
Explorer":
1. Shows SPHEREx image cutouts of a sky region with an exposure/band selector.
2. Detects sources; when the user clicks one, draws its spectrum (flux against
   wavelength, with error bars) using aperture photometry.
3. Cross-matches the source against a cached catalogue and shows the matched
   identifier, the separation in arcseconds, and a link to NASA ADS.
4. Moving-object mode: loads two epochs of the same region, aligns them,
   differences them, and lists sources whose position changed by more than a
   stated threshold, shown only as "candidates" with measured motion and
   uncertainty.

NASA'S SUGGESTED BUILD PROMPT (from the challenge)
"Build a SPHEREx spectral sky explorer. Data: pre-cached SPHEREx cutouts as
FITS in cache/spherex/, one file per wavelength band for two or three sky
regions, plus a catalogue subset for the same regions. Record the release
version and DOI in the repo. Backend: astropy and photutils. Source detection
on a chosen band, aperture photometry across every band to build a spectrum,
and a cross-match against the cached catalogue returning the matched
identifier and separation in arcseconds. Bands without coverage return null,
never an interpolated value. Frontend: a FITS image viewer with a band
selector, click a source to draw its spectrum as flux against wavelength with
error bars, and a match panel showing the catalogue identifier, separation,
and a link to ADS. Moving-object mode: load two epochs of the same region,
align them, difference them, and list sources whose position changed by more
than a stated threshold. Label these as candidates, show the measured motion,
and never call anything a discovery. Cite the SPHEREx release DOI
10.26131/IRSA652 in the interface and the README. Apache-2.0, public repo."

SCIENCE RULES (non-negotiable)
- Missing coverage is null. Never interpolate, smooth or fill. Charts show a gap.
- Moving objects are only "candidates". Never use "discovery", "discovered",
  "new object" or "new planet".
- All numbers come from tested Python (astropy, photutils, numpy). An AI model
  never produces a number.
- Every result shows its data source (live, cache or fixture); anything not
  real SPHEREx data is labelled "Synthetic fixture".
- The demo must work offline: all data is downloaded and cached beforehand, and
  the website never calls NASA services directly.
- Do not assume FITS header details. Real SPHEREx images define wavelength per
  pixel, so inspect real headers first. If unsure about a fact, say so.

EVENT RULES
Open source (Apache-2.0, public repo). Cite every data source and tool. AI tools
are allowed if we name them, explain prompts, and show our own work (docs/
AI_USE.md). No name, voice or likeness of anyone under 18 in videos or
submissions.

DATA AND TOOLS
SPHEREx release QR2, DOI 10.26131/IRSA652 (IRSA, collection spherex_qr2,
astroquery Irsa.query_sia). Catalogue: Gaia DR3 via the ESA Gaia TAP. NASA ADS
search URLs (no token). Python 3.11+, astropy, photutils, numpy, FastAPI;
React + TypeScript; Google AI Studio; Google Stitch.

REPLY WITH
1. The project in 5 sentences. 2. The rules you must follow. 3. What you are
unsure about. 4. Up to 5 questions. Then wait.
```

### P2: Google Stitch design prompt (paste into Stitch)

```text
Design a complete desktop web application called "SPHEREx Explorer": a
professional scientific tool for exploring infrared sky images from NASA's
SPHEREx space telescope, extracting a source's spectrum, matching it to
catalogues, and screening for moving-object candidates. It is software, not a
marketing site. First impression: "wow, modern and elite", while staying
serious, precise and a little classic, like mission control software crossed
with a premium photo editor.

CANVAS: desktop 1440x900, full-bleed, no empty areas. Five screens in one
consistent system: Home, Explorer, Moving Objects, Method, About.

STYLE: dark theme only, flat surfaces, 1px hairline borders, 4px radius, no
shadows, glow, blur or glassmorphism. Avoid purple/neon gradients, emoji, stock
photos, big rounded cards, pill buttons, sci-fi flavour words. Very little
text: short sentence-case labels, icons with tooltips, numbers and visuals do
the talking. Dense but breathable, 4px grid.

COLOURS: background #07090D, panel #0D1117, raised #131922, hairline #1E2733,
strong hairline #2C3846, text #E8ECF1, muted #98A2B0, faint #66717F, UI accent
signal blue #4C9AFF, candidate colour mint #3DDBB0, status ok #4CAF7A, warning
#E0A030, error #E5534B. Data ramp for wavelength, used only inside images,
the ribbon and spectrum lines: pale gold #F6D58E at 0.76 um, orange #F08A3C at
2 um, deep red #C2412D at 5 um.

TYPOGRAPHY: Archivo (variable width) for UI, weights 400/500/600; Fragment Mono
for numbers only. Write units correctly ("µm", "arcsec").

SIGNATURE ELEMENT: the Spectral Ribbon, a thin strip of hairline ticks, one per
exposure/band, coloured along the wavelength ramp, hollow ticks for no
coverage, axis labels 1 to 5 um. It is the band selector in the Explorer, a
hero element on Home, and a thin footer element elsewhere.

APP SHELL: top bar 48px (logo mark, "SPHEREx Explorer", tabs Home / Explorer /
Moving objects / Method / About, search "Ctrl K", data chip). Status bar 28px
(Fragment Mono 11px): cursor RA/Dec, band and wavelength, zoom, data source,
and "SPHEREx QR2 · DOI 10.26131/IRSA652" on the right.

HOME: full-viewport hero with a realistic infrared sky edge to edge (soft round
stars in warm gold to red, faint nebulosity, galaxies, vignette, fine grid).
One star highlighted with a blue ring and a floating spectrum tooltip (hover a
star, see its spectrum, ribbon lights its covered bands). Left: headline "See
the sky in 102 colours of infrared." (only "102" in gold), one short line, two
buttons "Open Explorer" (solid blue) and "Moving objects" (outline). Bottom
right: compact "Session" panel. Full-width ribbon at the bottom. Below: stat
strip (large light numbers), "Tools" row of three panels with real mini visuals,
"Regions" tiles, a one-line pipeline strip (Cutouts, Detect, Photometry, Match,
Candidates), slim 3-column footer with the DOI and licence.

EXPLORER (full screen, no page scroll): tool rail 48px | sky viewer | inspector
380px. 40px toolbar (region, colormap segmented control Infrared / Grayscale /
Inverted, stretch, markers toggle, fit, zoom). Viewer filled by the sky image
with RA/Dec rulers, compass, scale bar, crosshair readout, minimap, source
rings with IDs, selected source in blue with a leader line. Inspector tabs
Spectrum / Match / Sources. Spectrum: large chart filling the height (flux vs
wavelength, ramp-coloured line, points with error bars, crosshair readout,
hollow dashed "No coverage" band, marker for the selected band) plus a compact
Photometry table (aperture, flux, error, SNR, pixels, coverage) and an Export
CSV icon. Match: catalogue name, identifier, separation as a gauge against the
match radius, "Open in ADS". Band dock (about 96px) at the bottom with the
full-width ribbon, band number and wavelength in large mono, coverage chip,
Prev/Next.

MOVING OBJECTS: triptych Epoch A | Epoch B | Difference side by side with a
synchronised crosshair; diverging colour scale for the difference. Candidates
are mint rings with a motion arrow. Right panel 380px: histogram of measured
motions with a threshold line and slider, candidate cards (three stamps A/B/
difference, motion ± uncertainty, position angle, SNR, "Candidate" tag),
compact Alignment box, info icon "Candidates need independent confirmation".
Never use the words "discovery", "discovered" or "new object".

METHOD: readable page, content 720px wide, left table of contents, short
sections with small diagrams: Data, Detection, Photometry, Uncertainty,
Catalogue match, Moving-object screening, Limitations; aperture sum equation;
copyable citation block with the DOI.

ABOUT: challenge name, team, data sources (SPHEREx QR2 with DOI, catalogue,
ADS), Apache-2.0, AI-use disclosure, "How to cite".

RULES SHOWN IN THE UI: missing coverage is always an empty gap or hollow tick;
every data view carries a source chip (live, cache or fixture); placeholder
data is labelled "Synthetic fixture".
```

### P3: Master build prompt (AI Studio, paste after P1)

```text
You are building "SPHEREx Spectral Sky Explorer" for the NASA Space Apps
Challenge 2026. Build in phases. I will send one phase at a time. Do only that
phase, keep earlier phases working, and end each phase with: (a) what you
built, (b) how I test it, (c) anything still faked, assumed or unverified. Use
plain language.

PAGES: Home, Explorer, Moving Objects, Method, About.

NON-NEGOTIABLE RULES
1. Honest data: missing coverage = null, never interpolated; charts show gaps.
2. Candidates, never discoveries. The words "discovery", "discovered", "new
   object" and "new planet" never appear in the UI, README or code strings.
   Add an automated test that fails if they do.
3. Deterministic science: all numbers come from tested Python (astropy,
   photutils, numpy). An LLM never produces a number.
4. Provenance: show "SPHEREx QR2 release, DOI 10.26131/IRSA652" in the footer,
   About page, README and data/provenance.json. Each result shows a source
   badge: live, cache or fixture.
5. Offline-first: the website never calls NASA directly; it reads only static
   JSON and images from the repository.
6. Open source: Apache-2.0 LICENSE, public repo, README, docs/AI_USE.md.
7. Never assume FITS header keywords. Inspect real headers and record them in
   docs/DATA_NOTES.md. If unsure, say so.

ARCHITECTURE: AI Studio cannot run Python, so write Python as real files for me
to run locally. Website: React + TypeScript + Vite.
repo/ LICENSE, NOTICE, README.md, docs/, data/provenance.json, cache/ (ignored),
demo_fixtures/, pipeline/, backend/compute/, backend/tests/, src/, public/real/.

DATA SHAPES
source:   {id, x, y, ra_deg, dec_deg, peak_snr}
spectrum: {source_id, points:[{wavelength_um, flux|null, flux_err|null,
          n_good_pixels, detector, time_utc, null_reason|null}]}
match:    {source_id, catalogue, identifier|null, separation_arcsec|null,
          max_radius_arcsec, ads_url|null}
candidate:{id, ra_deg, dec_deg, motion_arcsec, motion_err_arcsec,
          threshold_arcsec, label:"Candidate"}

DESIGN: implement the Stitch design I will attach, exactly.

Reply only "Ready for Phase 0" if you understand.
```

### P4: Rebuild the website from the Stitch design (attach the Stitch screenshots and code)

```text
REBUILD THE INTERFACE FROM MY STITCH DESIGN. I attached screenshots of all 5
screens and the Stitch HTML/CSS. The design is final. Match it as exactly as
you can.

KEEP: all existing logic (data adapters, source selection, spectrum data,
match data, candidates, routing) and the science rules (null gaps, only the word
"Candidate", source chip on every data view, "Synthetic fixture" on non-real
data, citation "SPHEREx QR2 · DOI 10.26131/IRSA652" in the status bar).

CHANGE (visuals only)
1. Extract exact colours, fonts, sizes, spacing, borders and radii from the
   Stitch code into one tokens file. Remove old styles, fonts and colours.
2. Fonts: Archivo for text, Fragment Mono for numbers only. Units show as "µm",
   never uppercased.
3. Rebuild each page to match its screenshot. Reusable components: AppShell,
   TopBar, StatusBar, Panel, SpectralRibbon, SkyViewer, SpectrumChart,
   MatchPanel, SourceTable, CandidateCard, Histogram, StatStrip, RegionTile.
4. Layout: full-screen, edge to edge, grid exactly 100dvh (top bar, content,
   status bar). Explorer and Moving Objects: no page scrollbar. No large empty
   areas. The sky canvas fills its viewer; the inspector reaches the right edge.
5. SpectralRibbon: thin ticks drawn with canvas or SVG, coloured along the
   wavelength ramp, hollow ticks for no coverage, axis labels 1 to 5 µm. It is
   the selector in the Explorer. Tooltip rendered in a portal.
6. Home hero animation (build carefully, the first one glitched): one canvas
   and one requestAnimationFrame loop with state in refs; time-based movement
   with delta time clamped to 50 ms; debounced ResizeObserver; animate only
   transform and opacity; eased mouse parallax (lerp, max 12 px); pause when the
   tab is hidden or the hero is off screen; static frame for
   prefers-reduced-motion; fixed random seed. Headline and buttons never move
   with the mouse.
7. Keep interactions: click a source for spectrum and match, [ and ] keys, Ctrl+K
   search, zoom and pan, epoch toggle, threshold slider, CSV export.

DO NOT add features, change the data model, add libraries without telling me,
or invent content that is not in the design.

Work in steps and stop after each so I can check: (1) tokens, fonts, shell;
(2) SpectralRibbon and Home; (3) Explorer; (4) Moving Objects; (5) Method and
About. Start with step 1 only. After each step list the files changed and where
you could not match the design.
```

### P5: Phase 1, real-data pipeline (corrected version)

Original assumption errors fixed here: the collection name, the file structure (one file per exposure, wavelength per pixel), no fallback to fake data. **Check `Irsa.list_collections()` for the current collection name (see section 2).**

```text
PHASE 1: REAL DATA PIPELINE. Do not change the website. Add only new files in
pipeline/, data/, docs/ and the repo root. I am a beginner; explain simply.
These scripts run on MY laptop.

ABSOLUTE RULE: no script may ever create, simulate or fall back to synthetic
data inside cache/ or any results file. If a download or query fails, print a
clear error and exit with a non-zero code. Fixtures live only in
demo_fixtures/, are labelled as fixtures, and are never used unless OFFLINE=1.

REAL SPHEREx FACTS (from IRSA documentation; verify against the files)
- IRSA SIA2 collection (use "spherex_qr2", or the current name from
  Irsa.list_collections()).
- Each file is a multi-extension FITS: IMAGE (MJy/sr), FLAGS, VARIANCE
  ((MJy/sr)^2), ZODI, PSF (a cube), WCS-WAVE (lookup table mapping each pixel to
  central wavelength and bandwidth; spectral WCS key "W").
- Follow IRSA's tutorial for cutouts:
  https://caltech-ipac.github.io/irsa-tutorials/spherex-cutouts

TASKS
1. pipeline/regions.yaml: north-ecliptic-pole, RA 270.3317, Dec 66.5614, size
   15 arcmin, max_files 120, catalogue gaia_dr3 (editable).
2. requirements.txt (astropy, astroquery, pyvo, numpy, photutils, requests,
   pyyaml, tqdm, fastapi, uvicorn, pytest) and a virtual environment.
3. fetch_spherex.py: query the collection for the region and download CUTOUTS
   (not full images). Keep IMAGE, FLAGS, VARIANCE, WCS-WAVE; drop PSF and ZODI
   to save space (say so in a comment). Write cache/spherex/<region>/
   manifest.json (time, detector, wavelength at centre, file, size). List pairs
   of exposures on the same detector with similar wavelength at least 14 days
   apart (epoch_pairs.json). Show total size and ask me to confirm. Retry 3
   times, resume from cache, pause between requests. Respect OFFLINE=1.
4. fetch_catalogue.py: Gaia DR3 from the ESA Gaia TAP, table
   gaiadr3.gaia_source (columns source_id, ra, dec, phot_g_mean_mag,
   phot_bp_mean_mag, phot_rp_mean_mag, pmra, pmdec, parallax). Print real row
   counts; stop with an error on 0 rows. No fallback that writes sources. If
   AllWISE is used, read real column names from TAP_SCHEMA first.
5. inspect_fits.py: read ONLY real files in cache/. Write docs/DATA_NOTES.md
   from measured facts only: extensions, shapes, units, pixel scale, times,
   detector, wavelength range from WCS-WAVE, variance units, FLAGS bits found.
   Mark each statement "measured from files", "from IRSA docs" or "unverified".
6. make_fixtures.py: build fixtures by cropping 2-3 REAL cutouts and add
   FIXTURE = T to every header. If cache/ is empty, create nothing.
7. build_provenance.py: real_files and fixtures listed separately, with URL,
   checksum, size, collection, service URLs and queries.
8. verify_data.py: PASS or FAIL (fails if a fixture is in cache/, a catalogue
   has fewer than 20 rows, or provenance lists a missing file).
9. README "Getting the data": exact PowerShell and bash commands, one per line.

FINISH WITH: files changed, exact commands, what to send back, and anything you
could not verify.
```

### P6: Phase 2, science code

```text
PHASE 2: SCIENCE CODE. Do not change the website. Add files only in backend/ and
docs/. Plain-language comments. I am a beginner.

REAL DATA FACTS (measured)
- cache/spherex/north-ecliptic-pole/ holds 120 real cutouts: IMAGE (MJy/sr),
  FLAGS, VARIANCE ((MJy/sr)^2), WCS-WAVE; 146x146 px, about 6.15 arcsec per
  pixel, detectors 1 to 6, 2025-04-24 to 2025-04-27, 0.74 to 4.83 um at the
  field centre.
- Catalogue: cache/catalogue/north-ecliptic-pole/ Gaia DR3 CSV (611 rows). Read
  real column names from the file.
- Wavelength is per pixel: WCS(header, fobj=hdul, key="W"), set .sip = None,
  pixel_to_world(x, y) gives wavelength and bandwidth.
- One exposure gives ONE spectral point per source. A spectrum is all exposures
  covering the source, sorted by wavelength.
- IMAGE contains zodiacal background, so local background subtraction in an
  annulus is required.
- There are NO epoch pairs in this data. Do not write moving-object code.

RULES
- Missing or unusable data is null (None), never zero, never interpolated, and
  every null has a reason: "outside image", "flagged pixels", "too few good
  pixels", "no variance".
- All numbers from tested Python. Silence astropy SIP notices with
  astropy.log.setLevel("ERROR"). Never use "discovery", "discovered", "new
  object".

WRITE
1. backend/__init__.py and backend/compute/__init__.py.
2. exposure.py: load_exposure(path) -> image, flags, variance, celestial WCS,
   spectral WCS, observation time (DATE-AVG), detector, file name.
3. detect.py: pick a reference exposure (lowest median variance, few flagged
   pixels); detect with photutils (Background2D with flagged pixels masked,
   DAOStarFinder or segmentation, 5 sigma). IDs SPX-NEP-001... sorted by SNR.
4. photometry.py: measure_source(exposure, ra, dec, r_aperture_pix=2.0,
   annulus_pix=(4.0, 6.0)): background-subtracted aperture flux in MJy/sr,
   multiplied by the pixel solid angle (IRSA's map if present under
   cache/solid_angle/, else nominal, and say which) to give uJy
   (1 MJy = 1e12 uJy). Error from VARIANCE plus a background term (write the
   formula in docs/METHOD.md). Null if outside the image, fewer than 70 percent
   good pixels, or no variance. Look up FLAGS bit meanings in the IRSA
   Explanatory Supplement; never treat SOURCE (bit 21) as bad; list the bits
   you reject in docs/METHOD.md and mark each verified or unverified.
5. spectrum.py: build_spectrum(source, exposures) sorted by wavelength, nulls
   kept, with a summary (total, valid, nulls, range).
6. crossmatch.py: load the Gaia CSV, propagate positions to the observation date
   with pmra/pmdec if present (apply_space_motion), match with
   SkyCoord.match_to_catalog_sky, default radius 6.15 arcsec. Return Gaia
   identifier, separation, number of other candidates in the radius, and an ADS
   search URL; null if nothing matches.
7. backend/tests/: pytest with small synthetic arrays only: known flux recovered
   within 5 percent; off-edge source null; heavily flagged aperture null; no
   match null; match at 3.0 arcsec reported correctly; a test that fails if the
   words "discovery", "discovered" or "new object" appear in backend/ or src/.
8. run_region.py: python -m backend.compute.run_region north-ecliptic-pole
   prints exposures loaded, reference exposure, number of sources, and for the 5
   brightest: ID, RA, Dec, valid and total points, wavelength range, Gaia ID and
   separation. Writes nothing.
9. docs/METHOD.md: aperture, annulus, error formula, threshold, match radius,
   null rules, flag handling, limitations.

KNOWN-BUG PREVENTION (add these from the start)
- Put shared helpers (BAD_PIXEL_MASK as an integer, is_bad_pixel,
  sanitize_scalar) in backend/compute/common.py with no imports from other
  compute modules, to avoid circular imports.
- Add "import math" wherever math is used.
- measure_source never raises for ordinary data. If any part of the aperture
  lies outside the image, return null "outside image". Build aperture and
  annulus masks over the same index range as the (clipped) cut-out so shapes
  always match.
- One sort function (ascending wavelength, None last) used by build_spectrum and
  the exporter.
- Result classes get a to_dict() that turns NaN/infinity into None.

FINISH WITH: files created, exact commands (pytest, then run_region), what to
send back, anything unverified.
```

### P6a: Fix, aperture at image edges

```text
BUG FIX. Do not change the website. Change only backend/ files and tests.
Crash: photometry.py in measure_source:
  good_aperture_mask = aperture_mask & (~sub_bad)
  ValueError: operands could not be broadcast together with shapes (14,14) (13,14)
Cause: near an image edge the cut-out is clipped but the aperture mask is not.
FIX: (1) measure_source must not raise for ordinary data; on anything unexpected
return null with null_reason "measurement error". (2) If any part of the aperture
lies outside the image, return null "outside image"; never shrink or estimate.
If the aperture is inside but the annulus is partly outside, use the inside part
and return null "too few background pixels" if fewer than 20 good annulus pixels
remain. Build masks from coordinate grids over exactly the same slice. (3) In
export_region.py print null counts by reason; stop with an error if
"measurement error" exceeds 1 percent. (4) Before converting images to uint8 use
np.nan_to_num, clip 0 to 1, and make invalid pixels transparent through an alpha
channel. (5) Check "import math" in crossmatch.py and fix any undefined names
across backend/.
TESTS (synthetic only): centre source valid; sources 1 px from each edge and
corner give null "outside image" without exceptions; clipped annulus never
raises; export of a tiny synthetic region gives valid JSON.
```

### P6b: Fix, circular import and sorting

```text
BUG FIX. Backend only; do not change any science numbers.
1. Circular import: detect.py imports sanitize_scalar from photometry.py and
   photometry.py imports BAD_PIXEL_MASK and is_bad_pixel from detect.py. Create
   backend/compute/common.py with the shared helpers and no imports from other
   compute modules; both modules import from it; keep the old names importable.
   Add a pytest that imports every compute module in a fresh subprocess.
2. Five spectra are not sorted by wavelength. Print the first out-of-order pairs
   for each, then create ONE sort function (ascending, stable, None or NaN
   wavelength last, never crashes) used by build_spectrum and the exporter. Record
   the count of unplaceable points in manifest.json.
Regression guard: SPX-NEP-001 at E021 flux 243422.27 uJy, error 557.00; SPX-NEP-004
at E061 flux 7402.03, error 196.77 (within 0.1 percent).
```

### P6c: Fix, tests

```text
TEST AND CODE FIX. Backend only. Never weaken a scientific rule to make a test
pass; decide whether the code or the test is wrong and say why in one sentence.
1. test_export_spectrum_schema_and_sorting: exported points must be sorted by
   wavelength; use the single sort function; test with unsorted input including
   a None wavelength.
2. AttributeError 'SpectralPoint' has no attribute 'to_dict': add to_dict() to
   every exported result class (JSON-safe, NaN and infinity become None).
3. Corner test: a source at (2.1, 2.1) with annulus (4, 6) keeps about 28
   annulus pixels (20 or more), so valid flux is correct and the test premise
   was wrong. Expose n_background_pixels, keep that half of the test, and add a
   case that truly leaves fewer than 20 good annulus pixels (flag most annulus
   pixels) and expects null "too few background pixels".
```

### P7: Phase 3A, export real results for the website

```text
PHASE 3A: EXPORT REAL RESULTS FOR THE WEBSITE. Do not change the website. Add
backend files, docs and requirements.txt (add "reproject").

OUTPUT FOLDER: web/public/real/ (NOT the synthetic demo folder). Add
web/public/real/README.txt: "Generated from real SPHEREx QR2 files by
export_region.py. Do not edit by hand."

WRITE backend/compute/export_region.py, run as
python -m backend.compute.export_region north-ecliptic-pole
It reuses the existing compute functions and writes:
1. manifest.json: kind "real", release, doi, collection, region, generated UTC
   time, counts {exposures, sources, spectrum_points, null_points}, units,
   solid_angle_kind actually used, detection {reference_exposure_id,
   wavelength_um, threshold_sigma}, catalogue {name, rows}, common_grid {ra_deg,
   dec_deg, pixel_scale_arcsec, width, height, north_up}, notes (one exposure
   gives one point per source; no epoch pairs).
2. exposures.json sorted by wavelength: index, id (E001...), file, detector,
   time_utc, wavelength_um, wavelength_min_um, wavelength_max_um, bandwidth_um,
   image, vmin, vmax, pct_good_pixels.
3. images/E###.png: display images on ONE common north-up grid (reproject_interp
   onto a TAN WCS), grayscale, asinh stretch from the 1st to 99.5th percentile,
   transparent where invalid. Reprojection is for DISPLAY only; photometry uses
   the original pixels.
4. sources.json: id, ra_deg, dec_deg, x, y (common grid, origin top-left),
   peak_snr, valid_points, total_points, wavelength range, match {catalogue,
   identifier, separation_arcsec, n_candidates_in_radius, ads_url} or null.
5. spectra.json keyed by source id: points {exposure_id, wavelength_um,
   bandwidth_um, flux_uJy|null, flux_err_uJy|null, n_good_pixels, detector,
   time_utc, null_reason|null} sorted by wavelength; nulls stay in the list.

RULES: valid JSON (NaN/infinity become null, allow_nan=False); nothing from
demo_fixtures/; stop with an error if cache/ is empty; never recompute or change
a photometry value in the export step.

ALSO WRITE backend/compute/validate_export.py (PASS/FAIL): files exist, JSON
loads, no NaN, spectra sorted, source ids consistent, kind "real". Print file
sizes, solid_angle_kind, null counts by reason, 12 evenly spaced points for
SPX-NEP-001 and SPX-NEP-004, and the number of sources with 100+ valid points.
Add a pytest for valid JSON with synthetic arrays.
```

### P8: Phase 3B, connect the website to the real data

Before sending, open `web/public/real/manifest.json` and paste its contents where marked.

```text
PHASE 3B: CONNECT THE WEBSITE TO REAL SPHEREx DATA. Keep the design system,
pages, components and all honesty rules. Do the steps in order; list what is
left if you cannot finish.

REAL DATA (generated locally; you cannot see the files)
Folder web/public/real/ (served at /real/):
- manifest.json (my actual file): [PASTE manifest.json HERE]
- exposures.json (120 items sorted by wavelength: index, id "E001", file,
  detector, time_utc, wavelength_um, wavelength_min_um, wavelength_max_um,
  bandwidth_um, image, vmin, vmax, pct_good_pixels)
- images/E###.png: 120 display images on ONE common north-up grid
- sources.json: 72 sources (array or {"sources": [...]}; accept both): id, ra_deg,
  dec_deg, x, y, peak_snr, valid_points, total_points, wavelength range, match
  {catalogue, identifier, separation_arcsec, n_candidates_in_radius, ads_url}|null
- spectra.json keyed by source id: points {exposure_id, wavelength_um,
  bandwidth_um, flux_uJy|null, flux_err_uJy|null, n_good_pixels, detector,
  time_utc, null_reason|null}, about 4 MB, load once

FACTS TO RESPECT: one exposure gives ONE spectral point per source; there is NO
fixed 102-band grid (we have 120 exposures from 6 detectors); nulls are gaps with
reasons; flux uses a NOMINAL solid angle (say so); sources were detected on one
reference exposure (say so on Method); no epoch pairs in this dataset.

STEP 1 data layer: loadRealData() fetches the four JSON files, checks shapes at
runtime, and never crashes: if a file or key is missing, console.warn the exact
problem, show a small error panel, and fall back to the synthetic data. Global
data-source state "real" or "fixture"; the chip shows "Real SPHEREx QR2" or
"Synthetic fixture". Check where package.json is; if Vite cannot serve
web/public/real, add scripts/copy-real.mjs and wire it into predev and prebuild.
Add pixelToSky and skyToPixel (gnomonic projection from manifest.common_grid)
with a unit test.
STEP 2 Explorer: draw the selected exposure's PNG on the dark plate with zoom
and pan; colormaps Infrared / Grayscale / Inverted; exposure ribbon of 120 ticks
sorted by wavelength; [ and ] change exposure; hollow ticks where the selected
source has a null point; source rings with hover and click; status-bar readout
from app state. Inspector tabs Spectrum / Match / Sources. Spectrum: flux (uJy)
vs wavelength (um), error bars, colour or shape by detector with legend, log or
linear y, marker at the selected exposure's wavelength, hollow marks on the x
axis for nulls (hover shows the reason), Export CSV (nulls stay empty cells with
null_reason), info text "Step changes at detector boundaries can be
instrumental" and "Absolute flux is approximate (nominal pixel solid angle)",
photometry table for the hovered point. Match: Gaia identifier, separation gauge
vs 6.15 arcsec, other candidates, "Open in ADS" button; if null show "No Gaia
match within 6.15 arcsec". Sources: sortable table of all 72. First load
selects the brightest source.
STEP 3 Home uses real source positions in the hero; hovering shows a spectrum
sparkline; stat strip from the manifest; one real region tile.
STEP 4 Moving Objects: calm "Not available for this dataset" panel with the real
dates and the 14-day rule; no demo content.
STEP 5 Method and About: describe what the code does and the limitations. Clean
up: remove version tags, avatars, "SYNCED" badges and fixed example values; every
status-bar value from app state ("--" when empty); remove glossy effects and
unsupported claims; confirm "discovery", "discovered", "new object" appear
nowhere.

FINISH WITH: files changed, how I run it locally, what I should check, anything
unverified.
```

### P9: Final fix pass (suspect quality fields, claims, text)

```text
FINAL FIX PASS before judging. Keep the design system, pages and honesty rules.

PART 1 BACKEND (do NOT change any flux, error or null_reason): the spectrum of
SPX-NEP-002 has points 3 to 5 times below their neighbours. In photometry.py add
to every result: n_aperture_pixels, n_flagged_in_aperture, edge_distance_pix,
peak_pixel_flagged. Add quality "ok" or "suspect" with quality_reasons: suspect if
n_flagged_in_aperture > 0, or edge_distance_pix < 7, or peak_pixel_flagged.
Export these in spectra.json and add suspect counts per reason to manifest.json.
Write backend/compute/diagnose_dips.py (prints only): for the 5 brightest
sources, list points below 0.6 times the median of the 4 nearest points in
wavelength with their flags, and how many are marked suspect; run it at the end of
export_region.py. Regression guard: SPX-NEP-001 at E021 and SPX-NEP-004 at E061
unchanged.
PART 2 EXPLORER: suspect points hollow with no connecting line; tooltip lists the
reasons; legend entry and a "Show suspect points" toggle (default on); CSV
includes quality fields. Chart: axis titles "Flux (µJy)" and "Wavelength (µm)",
x ticks 1 to 5 µm, readable y ticks, light gridlines; connecting line only between
consecutive valid, non-suspect points of the SAME detector. The sky image fills
the viewer (crop to the valid-pixel bounding box, 16 px padding). "Infrared"
colormap is warm and independent of the exposure. Header "Detection SNR"; the
photometry panel says "Point SNR".
PART 3 HOME: "72 sources" (not "stars"); wavelength card from exposures.json,
"120 separate exposures", no "continuous coverage"; crisp points in the hero, no
glow.
PART 4 MOVING OBJECTS: default "Not available for this dataset"; delete the
synthetic demo and every real object name and invented motion rate.
PART 5 METHOD: correct resolving powers (41, 41, 41, 35, 110, 130) with a column
computed from exposures.json; delete the unsourced 102-band table and tracer
notes; keep or correct the proper-motion sentence according to what
crossmatch.py really does; links described as ADS searches; add the Suspect Points
limitation.
PART 6 NAVIGATION: use :focus-visible only; active tab keeps the underline.
```

### P10: Flag policy (not applied)

```text
FLAG POLICY: MARK, DO NOT CHANGE. Do not change any flux, error, null_reason or
BAD_PIXEL_MASK. Flag bits present in the data but not in our bad mask: bit 6
NONFUNC (0.17 percent of pixels), bit 7 (0.89), bit 11 (0.05), bit 19 OUTLIER
(2.07). Bit 21 SOURCE (38 percent) marks source light and must stay NOT bad.
1. A point is also "suspect" if any aperture pixel has bit 6, 7, 11 or 19 set.
   Reasons in plain words. Add n_flagged_extra_in_aperture. Do not change which
   pixels enter the sum.
2. Export the new reasons and counts; write bad_flag_bits (decoded from
   BAD_PIXEL_MASK) in manifest.json.
3. Write backend/compute/compare_exports.py <old_spectra.json> <new_spectra.json>:
   every flux, error and null_reason must be identical (exit with an error if not);
   print how many points became newly suspect and the counts per reason.
4. Regression guard values unchanged.
5. Tests: a bit-19 pixel makes a point suspect with unchanged flux; a pixel with only
   bit 21 does NOT.
```

### P11: Targeted text fixes (small prompt, cheap in credits)

```text
TARGETED TEXT FIXES. Edit only the files named. Do not rewrite or regenerate any
file or touch data. List each change.
1. src/components/MethodPage.tsx, card "6. Rigorous Null Accounting": replace the
   paragraph with: A point is null (never zero, never interpolated) when no usable
   measurement exists, with a reason such as outside image or too few good pixels.
   Points with flagged pixels in the aperture or near an image edge are kept and
   marked suspect.
2. Same file, limitation card "4. Suspect Points": For the brightest sources, the
   core pixel is often flagged OVERFLOW (nearing saturation) and left out of the
   sum, so the measured flux is biased low. These points are kept, drawn hollow and
   marked suspect, never silently corrected. The SOURCE flag, which marks pixels
   that contain source light, is not treated as bad. Pixels flagged non-functional
   (bit 6), outlier (bit 19) or with bits 7 and 11 are not removed from the sum and
   do not by themselves mark a point suspect.
3. Same file, detector table: remove the "Scientific Role" column; change
   "Mid-infrared" to "Near-infrared" anywhere it remains.
4. src/components/MovingObjectsPage.tsx: box heading "Screening requirements
   (project criteria)"; bullets "Time baseline: our rule requires two exposures at
   least 14 days apart." / "Detector pairing: same detector array and central
   wavelength within 2 percent." / "This dataset: all 120 exposures were taken
   within about 3 days, so no pair qualifies." Remove any claim that 14 days or the
   6.15 arcsec pixel is a SPHEREx requirement or the point-spread function.
5. src/components/HomePage.tsx, "VALID SPECTRAL POINTS": third line "of which N
   suspect", N = manifest.counts.suspect_points (not hard-coded).
6. Find why the data chip shows "Synthetic fixture" on one page while real data is
   loaded, and fix it so it shows "Real SPHEREx QR2" whenever real data loaded.
```

Tip: when editing text by hand in VS Code, turn word wrap off (Alt+Z) before using Shift+End, otherwise part of a long line is left behind.

### P12: Handoff prompt (paste into a new chat when credits run out)

```text
HANDOFF: CONTINUE MY PROJECT. Do NOT build or rebuild anything yet. Read all of
this, then reply with (1) a 5-line summary, (2) questions, (3) which files you need
me to paste. Then wait.

WHO AND WHAT: team in Dhaka, Bangladesh, in NASA Space Apps 2026, challenge "Planet
X and SPHEREx". We built the "SPHEREx Spectral Sky Explorer" (website plus Python
science code) that runs locally on Windows (VS Code, PowerShell). I am a beginner:
explain in simple steps, one at a time. Very little time, no AI Studio credits.

HOW YOU MUST WORK: you cannot see my files. Never regenerate the project or output a
zip. For each change give the exact file, the exact text to find (I use Ctrl+Shift+F)
and the exact replacement; ask me to paste any file you need. Change only what I ask.
Do not invent facts about SPHEREx.

STACK: React + TypeScript + Vite (npm install --legacy-peer-deps, npm run dev);
Python 3.12 in .venv (backend/compute, pipeline). The site reads results from
public/real/ (manifest.json, exposures.json, sources.json, spectra.json,
images/E###.png, moving/index.json).

REAL DATA (verified): SPHEREx QR2 spectral images, DOI 10.26131/IRSA652, 120 cutouts
of the North Ecliptic Pole (IMAGE, FLAGS, VARIANCE, WCS-WAVE), about 146x146 px at
6.15 arcsec per pixel, all 6 detectors, 2025-04-24 to 2025-04-27, 0.74 to 4.83 um;
Gaia DR3 (611 rows with pmra, pmdec, parallax). One exposure gives ONE spectral
point per source.
RESULTS: 72 sources at 5 sigma on reference exposure E076 (3.049 um, detector 4);
aperture 2 px, annulus 4 to 6 px; nominal solid angle (flux approximate); Gaia match
radius 6.15 arcsec. 8,640 points: 8,342 valid, 298 null, 1,589 suspect (18.39
percent). Regression values that must never change: SPX-NEP-001 at E021 243422.27
uJy ± 557.00; SPX-NEP-004 at E061 7402.03 uJy ± 196.77. Dips on bright stars come
from the brightest pixel flagged OVERFLOW (bit 1) and left out of the sum; they are
marked suspect (hollow, no connecting line), never hidden or corrected. Flag bit 21
SOURCE (38 percent of pixels) is correctly NOT rejected.
MOVING OBJECTS: epoch A is QR2; epoch B comes from IRSA collection spherex_dr1_deep
(at least 14 days later). Results are candidates only.

PROJECT RULES: null never zero or interpolated; never "discovery", "discovered" or
"new object"; all numbers from tested Python; cite DOI 10.26131/IRSA652; Apache-2.0
and docs/AI_USE.md; anything not real is labelled synthetic.

WHAT IS LEFT: Enter the active outstanding tasks here before reusing this handoff prompt.
When you reply, start with the summary and questions, and write no code yet.
```

---

## 12. Helper scripts

These were written with Claude's help, tested by running them on real data, and live in the repository. Their full source is in the repo; this table records what each does.

| File | Purpose |
|---|---|
| `pipeline/summary.py` | Reads every cutout and prints dates, wavelength range, files per detector, and the number of epoch pairs |
| `check_flags.py` | Prints which FLAGS bits are set in the aperture of chosen source/exposure pairs and which bits our code treats as bad |
| `check_bits.py` | Flag census across all cutouts: bit, share of pixels, rejected or not |
| `pipeline/probe_irsa.py` | Lists SPHEREx collections IRSA offers and how many rows each returns for our field |
| `pipeline/get_epoch_b.py` | Downloads a second epoch of cutouts (at least 14 days after epoch A) into `cache/epoch_b/` |
| `backend/compute/moving_candidates.py` | Pairs exposures (same detector, wavelength within 2 percent, 14+ days apart), aligns epochs on stationary stars, builds A, B and difference images, links sources, and writes `public/real/moving/` |
| `src/components/MovingObjectsPage.tsx` | The Moving Objects page: three images, threshold slider, candidate table, alignment box |

Method of `moving_candidates.py` in short: subtract a median-filtered background, detect peaks at 8 sigma or more, remove the median offset between epochs using matched stationary stars, link sources less than 60 arcsec apart whose fluxes agree within a factor of 2.5, and list as candidates the links whose motion exceeds the threshold (default the larger of one pixel and three times the alignment scatter). Everything is reported with the alignment scatter as uncertainty and labelled "Candidate".

---

## 13. Problems met and how we fixed them

| Problem | Cause | Fix |
|---|---|---|
| Commands pasted three times on one line | Copy and paste | Run one command per line |
| Long "SIP distortion" notice for every file | astropy information message | Harmless; silenced with `astropy.log.setLevel("ERROR")` |
| IRSA HTTP 503 during download | Busy server | Wait and rerun; downloads resume |
| Catalogue script saved made-up rows after failed queries | Fallback code written by the AI | Fallback deleted; ESA Gaia TAP; `verify_data.py` checks row counts |
| `DATA_NOTES.md` described fake files | Generated from synthetic fixtures | Regenerated from real cached files only |
| `NameError: math` | Missing import; each AI Studio zip overwrote the local fix | Fixed in the code and re-checked after each zip |
| Circular import between detect and photometry | Shared helpers in two directions | `common.py` with shared helpers |
| Aperture shape mismatch near image edges | Clipped cut-out but unclipped mask | Edge rules: null "outside image" |
| Dips in bright-star spectra | Core pixel flagged OVERFLOW and left out of the sum | Points marked suspect; diagnosed with `check_flags.py` |
| `npm install` error `ERESOLVE` | esbuild peer-version conflict | `.npmrc` with `legacy-peer-deps=true` |
| Moving objects "not available" | All main-dataset files within 3 days | Second epoch from `spherex_dr1_deep` |
| `spherex_qr2` returned 0 rows | Collection no longer listed by IRSA | `probe_irsa.py` found the current collections |
| Moving-object crashes and wrong pairing | `search_around_sky` returns indices in a different order than the code assumed | Unpack as `ib, ia, d2d, _` |
| Leftover text after a hand edit | VS Code word wrap: Shift+End stops at the end of the visible row | Turn wrap off (Alt+Z) |
| "Real files not found" on Vercel | Data not committed or not copied into the build | Commit `public/real`, check `dist/real/manifest.json` |
| AI Studio credits ran out | Large Build-mode runs | Small targeted prompts, hand edits, the handoff prompt P12 |

---

## 14. Citation, acknowledgements, license

**Cite the data:**
> SPHEREx Quick Release 2 spectral images, NASA/IPAC Infrared Science Archive, DOI 10.26131/IRSA652. Epoch B: SPHEREx spectral images, IRSA collection `spherex_dr1_deep` (no separate DOI verified; cite the collection name unless confirmed by IRSA). Reference catalogue: Gaia DR3 (ESA).

**Acknowledgements** (check each archive's current wording):
- This research has made use of the NASA/IPAC Infrared Science Archive, which is funded by the National Aeronautics and Space Administration and operated by the California Institute of Technology.
- This work has made use of data from the European Space Agency (ESA) mission Gaia (https://www.cosmos.esa.int/gaia), processed by the Gaia Data Processing and Analysis Consortium (DPAC, https://www.cosmos.esa.int/web/gaia/dpac/consortium). Funding for the DPAC has been provided by national institutions, in particular the institutions participating in the Gaia Multilateral Agreement.
- Literature links use NASA ADS.
- SPHEREx is a NASA Astrophysics Medium Explorer mission. Its data are served by IRSA at Caltech/IPAC.

**License status:** the project prompts and this draft describe Apache-2.0 as the intended code license, but the linked repository's current `main` branch did not expose a root `LICENSE` file when checked (the raw `LICENSE` URL returned 404). Do not claim the repository is already Apache-2.0 licensed until the team adds/commits the license file and verifies it is visible. SPHEREx/Gaia data and video assets retain their own terms; fonts and icon licenses are listed in section 5.

---

## 15. Submission checklist

- [ ] Repository is public; `README.md` and `docs/AI_USE.md` are present. **Add and verify the intended `LICENSE` file** (the supplied repository link currently returns 404 for `/LICENSE`). Confirm whether `RESOURCES_AND_PROMPTS.md` is committed; it was not visible in the repository root listing reviewed.
- [ ] `public/real/` and `web/public/real/` are committed; `cache/`, `.venv/`, `node_modules/`, `dist/`, `.env` are not
- [ ] `npm run build` succeeds and `dist/real/manifest.json` exists
- [ ] Live site works, with every page tested on a phone as well
- [ ] Data chip says "Real SPHEREx QR2" on every page; DOI in the status bar and About
- [ ] No "discovery", "discovered" or "new object" anywhere (the test passes)
- [ ] All **[TEAM TO CONFIRM]** items in this file are completed or deleted
- [ ] Section 7 asset log is complete, with a license screenshot per asset
- [ ] Captions proofread; `.srt` saved in `docs/video/`
- [ ] Nobody under 18 appears or is named (confirm against the official rules)
- [ ] Backup video recorded offline, under the length limit
- [ ] Official Space Apps submission guide re-read **today** (deadlines, AI-disclosure wording, video length)
- [ ] Team names and roles filled in below

**Team:** Team Red Shift (confirm official team name/spelling before submission). **[TEAM TO CONFIRM: list every member's name and project role; the supplied public links do not provide a complete roster or role allocation.]**
