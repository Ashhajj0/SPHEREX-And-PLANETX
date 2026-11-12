# SPHEREx Explorer — NASA Mission Data Pipeline (Release QR2)

Interactive spectrophotometry explorer for NASA's **SPHEREx** (Spectro-Photometer for the History of the Universe, Epoch of Reionization, and Ices Explorer) mission mapping cosmic origins across 102 continuous spectral bands.

- **Data Release**: Quick Release 2 (QR2)
- **Permanent Archive DOI**: [10.26131/IRSA652](https://doi.org/10.26131/IRSA652)
- **Data Host**: Caltech / IPAC Infrared Science Archive (IRSA) & AWS Open Data

---

## Getting the Data (Step-by-Step Guide)

Follow these exact steps on your laptop to download, filter, inspect, and verify real SPHEREx data.

### Step 1: Create and Activate a Python Virtual Environment

#### On macOS and Linux (Bash):
```bash
python3 -m venv venv
source venv/bin/activate
which python
```

#### On Windows (PowerShell):
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
where.exe python
```
*(If PowerShell displays a script execution error, run: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`)*

---

### Step 2: Install Python Requirements

#### On macOS and Linux (Bash):
```bash
pip install --upgrade pip
pip install -r requirements.txt
```

#### On Windows (PowerShell):
```powershell
python -m pip install --upgrade pip
pip install -r requirements.txt
```

---

### Step 3: Run the Data Pipeline (In Order)

Run each command one by one:

#### 1. Download Real SPHEREx QR2 Cutouts
```bash
python pipeline/fetch_spherex.py
```
*On Windows:*
```powershell
python pipeline\fetch_spherex.py
```
*What you will see:*
- Queries IRSA TAP for collection `spherex_qr2` covering all 3 target regions.
- Shows planned cutout count and prompts `Proceed with downloading cutouts? [y/N]:`.
- Downloads spatial cutouts, drops the massive PSF cube and ZODI to save disk space, and keeps `IMAGE`, `FLAGS`, `VARIANCE`, and `WCS-WAVE`.
- Computes central wavelength at the field center from `WCS-WAVE` and writes `cache/spherex/<region_id>/manifest.json`.
- Identifies exposure pairs observed $\ge 14$ days apart with matching detector and central wavelength within 2%, saving them to `cache/spherex/<region_id>/epoch_pairs.json`.

*(Tip: To auto-confirm without prompting, use `python pipeline/fetch_spherex.py --yes`)*

---

#### 2. Download Reference Star Catalogues (Gaia DR3 & AllWISE)
```bash
python pipeline/fetch_catalogue.py
```
*On Windows:*
```powershell
python pipeline\fetch_catalogue.py
```
*What you will see:*
- For `north-ecliptic-pole` and `south-ecliptic-pole`: Queries the official **ESA Gaia TAP** service (`gaiadr3.gaia_source`) including an extra 2-arcminute safety margin.
- For `cosmos`: Queries **IRSA TAP_SCHEMA.columns** to verify the real column names of `allwise_p3as_psd` before querying (`designation`, `ra`, `dec`, `w1mpro`, `w2mpro`).
- Prints the real source count and saves clean CSV files with full ADQL provenance to `cache/catalogue/<region_id>/`.
- Never uses or creates synthetic rows.

---

#### 3. Inspect Real FITS Cutouts & Generate Technical Report
```bash
python pipeline/inspect_fits.py
```
*On Windows:*
```powershell
python pipeline\inspect_fits.py
```
*What you will see:*
- Reads exclusively from `cache/spherex/` (fails if cache is empty; never touches demo fixtures).
- Measures HDU shapes, units, WCS pixel scale ($6.20''/\text{pixel}$), observation timestamps (`DATE-OBS`, `DATE-BEG`, etc.), detector IDs, and active `FLAGS` bits.
- Generates **`docs/DATA_NOTES.md`** with every statement tagged with strict verification statuses (`"measured from files"`, `"from IRSA docs (link)"`, or `"unverified"`).

---

#### 4. Build Demo Fixtures from Real Data
```bash
python pipeline/make_fixtures.py
```
*On Windows:*
```powershell
python pipeline\make_fixtures.py
```
*What you will see:*
- Creates small, realistic test fixtures in `demo_fixtures/` by copying and cropping real cached cutouts.
- Tags every fixture with `FIXTURE = T` in the FITS header and prefixes file names with `fixture_`.
- If cache is empty, it creates nothing.

---

#### 5. Build Scientific Provenance Record
```bash
python pipeline/build_provenance.py
```
*On Windows:*
```powershell
python pipeline\build_provenance.py
```
*What you will see:*
- Computes SHA-256 checksums, file sizes, source URLs, and collection metadata.
- Strictly separates real files from demo fixtures in **`data/provenance.json`**.

---

#### 6. Run Strict Data Verification
```bash
python pipeline/verify_data.py
```
*On Windows:*
```powershell
python pipeline\verify_data.py
```
*What you will see:*
- Validates that no file in `cache/` has the `FIXTURE` flag.
- Validates that every catalogue in `cache/` has at least 20 rows.
- Validates that all files listed in `data/provenance.json` exist on disk.
- Prints a clear **`[PASS]`** or **`[FAIL]`** verdict.

---

### Step 4: Testing Offline Mode

To verify that the application and pipeline can run completely offline using cached data:

#### On macOS and Linux (Bash):
```bash
export OFFLINE=1
python pipeline/fetch_spherex.py
python pipeline/fetch_catalogue.py
python pipeline/verify_data.py
```

#### On Windows (PowerShell):
```powershell
$env:OFFLINE="1"
python pipeline\fetch_spherex.py
python pipeline\fetch_catalogue.py
python pipeline\verify_data.py
```

---

## Target Regions (`pipeline/regions.yaml`)

You can edit `pipeline/regions.yaml` in any text editor to adjust coordinates, field sizes, or file limits:

```yaml
regions:
  - id: "north-ecliptic-pole"
    name: "North Ecliptic Pole Deep Field (NEP)"
    ra_deg: 270.3317
    dec_deg: 66.5614
    size_arcmin: 15.0
    max_files: 8
    catalogue: "gaia_dr3"

  - id: "south-ecliptic-pole"
    name: "South Ecliptic Pole Deep Field (SEP)"
    ra_deg: 90.0000
    dec_deg: -66.5614
    size_arcmin: 15.0
    max_files: 8
    catalogue: "gaia_dr3"

  - id: "cosmos"
    name: "COSMOS Extragalactic Field"
    ra_deg: 150.1192
    dec_deg: 2.2058
    size_arcmin: 12.0
    max_files: 6
    catalogue: "allwise"
```

---

## Troubleshooting

| Problem | Cause | Solution |
| :--- | :--- | :--- |
| **"Network blocked / Connection timed out"** | Institutional proxy, firewall, or offline network | Set `OFFLINE=1` to use local `demo_fixtures/` immediately without internet access. |
| **"Query returns nothing / 0 records"** | IRSA SIA endpoint undergoing scheduled maintenance or collection index update | The script automatically checks the SPHEREx AWS Open Data mirror (`https://nasa-irsa-spherex.s3.amazonaws.com`). If both are offline, run `python pipeline/make_fixtures.py` to use offline fixtures. |
| **"Disk space warning / Planned size exceeds limit"** | Download size exceeds default 2 GB limit | Increase the limit by passing `--max-size-gb 4.0` or reduce `max_files` in `pipeline/regions.yaml`. |
| **"ImportError: No module named 'astropy'"** | Virtual environment is not activated | Activate your virtual environment first (`source venv/bin/activate` or `.\venv\Scripts\activate.bat`) and run `pip install -r requirements.txt`. |
| **"PowerShell: Execution of scripts is disabled"** (Windows) | Windows default execution policy restricts `.ps1` scripts | Run PowerShell as Administrator and run `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`, or use Command Prompt `activate.bat`. |
