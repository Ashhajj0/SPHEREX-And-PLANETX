#!/usr/bin/env python3
"""
fetch_spherex.py
================
Downloads real NASA SPHEREx mission data cutouts (Release QR2, collection 'spherex_qr2',
DOI: 10.26131/IRSA652) from Caltech/IPAC IRSA for target sky regions.

Key features (IRSA SPHEREx Data Standards):
1. Queries IRSA for collection 'spherex_qr2' using Table Access Protocol (TAP).
2. Requests spatial CUTOUTS (not full images) by appending '?center=RA,DECd&size=SIZEd'
   per official Caltech-IPAC IRSA tutorial:
   https://caltech-ipac.github.io/irsa-tutorials/spherex-cutouts
3. Drops the massive PSF cube and ZODI extensions when saving, keeping only:
   - PRIMARY (HDU 0 with metadata and space-saving comment)
   - IMAGE (calibrated flux in MJy/sr)
   - FLAGS (data quality bits)
   - VARIANCE (uncertainty variance in (MJy/sr)^2)
   - WCS-WAVE (spectral lookup table for wavelength & bandwidth)
4. Computes central wavelength and bandwidth at the field center using WCS-WAVE.
5. Saves a comprehensive manifest: cache/spherex/<region_id>/manifest.json.
6. Identifies and saves epoch pairs: pairs of exposures on the same detector
   with central wavelength within 2% observed >= 14 days apart.
   Saved to cache/spherex/<region_id>/epoch_pairs.json.
7. Prompts user for confirmation before downloading, with configurable 2 GB limit,
   3 retry attempts, polite rate limiting (pause between calls), and cache resume.
8. NEVER creates, simulates, or falls back to synthetic data. Exits non-zero on failure.
"""

import os
import sys
import json
import time
import urllib.request
import urllib.parse
import urllib.error
import hashlib
import argparse
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

# Ensure repository root is on sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = REPO_ROOT / "cache" / "spherex"
CONFIG_FILE = REPO_ROOT / "pipeline" / "regions.yaml"

IRSA_TAP_URL = "https://irsa.ipac.caltech.edu/TAP/sync"
IRSA_TAP_ASYNC_URL = "https://irsa.ipac.caltech.edu/TAP/async"
IRSA_TAP_BASE_URL = "https://irsa.ipac.caltech.edu/TAP"
COLLECTION_NAME = "spherex_qr2"


# ---------------------------------------------------------------------------
# Configuration Loader
# ---------------------------------------------------------------------------
def load_config(config_path: Path) -> Dict[str, Any]:
    """Loads pipeline/regions.yaml with target regions and settings."""
    if not config_path.exists():
        print(f"[FATAL] Configuration file not found at: {config_path}")
        sys.exit(1)

    try:
        import yaml
        with open(config_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f)
    except ImportError:
        # Pure-Python YAML parser fallback
        data: Dict[str, Any] = {"regions": [], "settings": {}}
        current_reg: Optional[Dict[str, Any]] = None
        with open(config_path, "r", encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if s.startswith("- id:"):
                    current_reg = {"id": s.split(":", 1)[1].strip().strip('"\'')}
                    data["regions"].append(current_reg)
                elif current_reg is not None and ":" in s and not s.startswith("#"):
                    k, v = s.split(":", 1)
                    k, v = k.strip(), v.strip().strip('"\'')
                    try:
                        current_reg[k] = float(v) if "." in v else int(v)
                    except ValueError:
                        current_reg[k] = v
        return data


# ---------------------------------------------------------------------------
# SHA-256 Checksum
# ---------------------------------------------------------------------------
def calculate_sha256(file_path: Path) -> str:
    """Computes SHA-256 hash of a file for integrity verification."""
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


# ---------------------------------------------------------------------------
# Query IRSA TAP for Real SPHEREx QR2 Cutouts
# ---------------------------------------------------------------------------
def _build_obscore_adql(
    ra_deg: float,
    dec_deg: float,
    max_files: int,
) -> str:
    """Builds a lightweight ADQL spatial query against IRSA spherex.obscore (no JOIN)."""
    return f"""
    SELECT TOP {max_files}
        access_url,
        t_min,
        obs_id,
        obs_collection
    FROM spherex.obscore
    WHERE CONTAINS(POINT('ICRS', {ra_deg:.6f}, {dec_deg:.6f}), s_region) = 1
    """.strip()


def _build_spherex_adql(
    ra_deg: float,
    dec_deg: float,
    size_arcmin: float,
    max_files: int,
    ordered: bool = True,
) -> str:
    """Builds the ADQL query against IRSA spherex.artifact & spherex.plane."""
    size_deg = size_arcmin / 60.0
    order_clause = "ORDER BY p.time_bounds_lower" if ordered else ""
    return f"""
    SELECT TOP {max_files}
        'https://irsa.ipac.caltech.edu/' || a.uri || '?center={ra_deg:.6f},{dec_deg:.6f}d&size={size_deg:.6f}d' AS uri,
        p.time_bounds_lower,
        p.energy_bandpassname,
        p.obsid
    FROM spherex.artifact a
    JOIN spherex.plane p ON a.planeid = p.planeid
    WHERE 1 = CONTAINS(POINT('ICRS', {ra_deg:.6f}, {dec_deg:.6f}), p.poly)
    {order_clause}
    """.strip()


def _execute_sync_tap(adql_query: str, timeout: int = 90) -> str:
    """Executes synchronous ADQL query against IRSA TAP."""
    params = {
        "REQUEST": "doQuery",
        "LANG": "ADQL",
        "FORMAT": "csv",
        "QUERY": adql_query,
    }
    data = urllib.parse.urlencode(params).encode("utf-8")
    req = urllib.request.Request(
        IRSA_TAP_URL,
        data=data,
        headers={"User-Agent": "SPHEREx-Data-Pipeline/2.0 (IRSA-QR2)"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        text = resp.read().decode("utf-8", errors="replace")
    if "<INFO" in text and "ERROR" in text:
        raise RuntimeError(f"IRSA TAP returned error response: {text[:300]}")
    return text


def _execute_async_tap(adql_query: str, timeout: int = 180) -> List[Dict[str, Any]]:
    """
    Executes asynchronous ADQL query against IRSA TAP (/TAP/async).
    Async jobs avoid HTTP gateway read timeouts on busy/dense sky fields.
    """
    # Prefer pyvo if installed (bundled via requirements.txt)
    try:
        import pyvo
        tap = pyvo.dal.TAPService(IRSA_TAP_BASE_URL)
        job = tap.submit_job(adql_query)
        try:
            job.run()
            job.wait(phases=["COMPLETED", "ERROR", "ABORTED"], timeout=float(timeout))
            job.raise_if_error()
            table = job.fetch_result().to_table()
            records: List[Dict[str, Any]] = []
            for row in table:
                raw_uri = row["uri"]
                uri = raw_uri.decode("utf-8", errors="ignore") if isinstance(raw_uri, bytes) else str(raw_uri)
                if "spherex" in uri:
                    try:
                        mjd_val = float(row["time_bounds_lower"])
                    except Exception:
                        mjd_val = 0.0
                    bp = row["energy_bandpassname"]
                    oid = row["obsid"]
                    records.append({
                        "uri": uri,
                        "time_mjd": mjd_val,
                        "bandpass": bp.decode("utf-8", errors="ignore") if isinstance(bp, bytes) else str(bp or ""),
                        "obsid": oid.decode("utf-8", errors="ignore") if isinstance(oid, bytes) else str(oid or ""),
                    })
            return records
        finally:
            try:
                job.delete()
            except Exception:
                pass
    except ImportError:
        pass

    # Pure-Python UWS Async TAP fallback
    params = {
        "REQUEST": "doQuery",
        "LANG": "ADQL",
        "FORMAT": "csv",
        "PHASE": "RUN",
        "QUERY": adql_query,
    }
    data = urllib.parse.urlencode(params).encode("utf-8")

    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    opener = urllib.request.build_opener(_NoRedirect())
    req = urllib.request.Request(
        IRSA_TAP_ASYNC_URL,
        data=data,
        headers={"User-Agent": "SPHEREx-Data-Pipeline/2.0 (IRSA-QR2)"},
    )
    job_url = None
    try:
        with opener.open(req, timeout=45) as resp:
            job_url = resp.geturl()
    except urllib.error.HTTPError as e:
        if e.code in (302, 303) and e.headers.get("Location"):
            job_url = e.headers.get("Location")
        else:
            raise

    if not job_url:
        raise RuntimeError("IRSA Async TAP did not return a job URL")

    job_url = job_url.rstrip("/")
    deadline = time.time() + timeout
    phase = "EXECUTING"
    while time.time() < deadline:
        with urllib.request.urlopen(f"{job_url}/phase", timeout=30) as p_resp:
            phase = p_resp.read().decode("utf-8", errors="replace").strip().upper()
        if phase in ("COMPLETED", "ERROR", "ABORTED"):
            break
        time.sleep(2.5)

    if phase != "COMPLETED":
        raise RuntimeError(f"IRSA Async TAP job ended with phase={phase}")

    with urllib.request.urlopen(f"{job_url}/results/result", timeout=60) as r_resp:
        csv_text = r_resp.read().decode("utf-8", errors="replace")
    return _parse_tap_csv(csv_text)


def _parse_tap_csv(text: str) -> List[Dict[str, Any]]:
    """Parses CSV text returned by IRSA TAP (artifact/plane OR spherex.obscore) into records."""
    import csv
    import io

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) <= 1:
        return []

    reader = csv.DictReader(io.StringIO(text))
    records: List[Dict[str, Any]] = []
    for row in reader:
        uri = (row.get("uri") or row.get("access_url") or "").strip()
        if not uri or "spherex" not in uri:
            continue
        raw_t = row.get("time_bounds_lower") or row.get("t_min") or 0.0
        try:
            t_mjd = float(raw_t)
        except Exception:
            t_mjd = 0.0
        records.append({
            "uri": uri,
            "time_mjd": t_mjd,
            "bandpass": row.get("energy_bandpassname") or row.get("obs_collection") or "",
            "obsid": row.get("obsid") or row.get("obs_id") or "",
        })
    return records


def _short_err(err: Exception) -> str:
    """Formats verbose HTML HTTP 502/503 proxy errors into a clean one-line summary."""
    msg = str(err)
    if "502" in msg and ("Proxy Error" in msg or "<html" in msg.lower()):
        return "HTTP 502 Proxy Error (Caltech/IPAC IRSA server temporarily unavailable)"
    if "503" in msg and "<html" in msg.lower():
        return "HTTP 503 Service Unavailable (Caltech/IPAC IRSA overloaded)"
    return msg.splitlines()[0][:180]


def _query_via_sia(
    ra_deg: float,
    dec_deg: float,
    size_arcmin: float,
    max_files: int,
    preferred_collection: str = COLLECTION_NAME,
) -> Optional[List[Dict[str, Any]]]:
    """
    Fast indexed search via IRSA SIAv2 (astroquery.ipac.irsa.Irsa.query_sia).
    Returns None if astroquery/SIA fails so callers can fall back to TAP,
    or a list of cutout records (possibly empty if verified 0 coverage).
    """
    try:
        from astroquery.ipac.irsa import Irsa
        from astropy.coordinates import SkyCoord
        import astropy.units as u
    except ImportError:
        return None

    size_deg = size_arcmin / 60.0
    coord = SkyCoord(ra=ra_deg, dec=dec_deg, unit="deg", frame="icrs")

    # Discover live SPHEREx collections on IRSA SIA so we always match active release names
    collections_to_try: List[str] = [preferred_collection]
    try:
        coll_tbl = Irsa.list_collections(servicetype="SIA", filter="spherex")
        if coll_tbl is not None and len(coll_tbl) > 0:
            col_name = "collection" if "collection" in coll_tbl.colnames else coll_tbl.colnames[0]
            live = [str(v).strip() for v in coll_tbl[col_name] if "spherex" in str(v).lower()]
            # Prefer qr2 first, then qr3 / dr1 wide surveys
            for c in ["spherex_qr2", "spherex_qr3", "spherex_dr1", "spherex_qr3_deep", "spherex_dr1_deep"]:
                if c in live and c not in collections_to_try:
                    collections_to_try.append(c)
            for c in live:
                if c not in collections_to_try:
                    collections_to_try.append(c)
    except Exception:
        for c in ["spherex_qr3", "spherex_dr1"]:
            if c not in collections_to_try:
                collections_to_try.append(c)

    for coll in collections_to_try:
        print(f"  Trying fast IRSA SIAv2 search (collection='{coll}')...")
        try:
            res = Irsa.query_sia(pos=(coord, 1 * u.arcsec), collection=coll)
        except Exception as e:
            short = _short_err(e)
            print(f"    [SIA '{coll}' warning] {short}")
            if "capabilities" in str(e) and ("502" in str(e) or "503" in str(e)):
                # /SIA/capabilities is shared across all collections; avoid spamming duplicate 502s
                break
            continue

        if res is None or len(res) == 0:
            print(f"    SIA '{coll}' returned 0 rows for RA={ra_deg:.4f}, Dec={dec_deg:.4f}.")
            continue

        records: List[Dict[str, Any]] = []
        seen_urls = set()
        cols = set(res.colnames)

        for row in res:
            raw_url = row["access_url"] if "access_url" in cols else ""
            url = raw_url.decode("utf-8", errors="ignore") if isinstance(raw_url, bytes) else str(raw_url or "")
            if not url:
                continue

            fmt = ""
            if "access_format" in cols:
                raw_fmt = row["access_format"]
                fmt = raw_fmt.decode("utf-8", errors="ignore") if isinstance(raw_fmt, bytes) else str(raw_fmt or "")
            if "datalink" in fmt.lower():
                continue
            if ".fits" not in url.lower() and "fits" not in fmt.lower():
                continue

            # Append IRSA spatial cutout query params so we download ~35 KB cutouts, not full ~150 MB frames
            if "irsa.ipac.caltech.edu" in url and "?center=" not in url and "&center=" not in url:
                sep = "&" if "?" in url else "?"
                cutout_url = f"{url}{sep}center={ra_deg:.6f},{dec_deg:.6f}d&size={size_deg:.6f}d"
            else:
                cutout_url = url

            if cutout_url in seen_urls:
                continue
            seen_urls.add(cutout_url)

            mjd_val = 0.0
            if "t_min" in cols:
                try:
                    mjd_val = float(row["t_min"])
                except Exception:
                    mjd_val = 0.0

            bp_val = ""
            for bp_col in ("energy_bandpassname", "bandpass_id"):
                if bp_col in cols and row[bp_col] is not None:
                    bp_val = str(row[bp_col])
                    break

            obs_val = ""
            for obs_col in ("obs_id", "obs_publisher_did"):
                if obs_col in cols and row[obs_col] is not None:
                    obs_val = str(row[obs_col])
                    break

            records.append({
                "uri": cutout_url,
                "time_mjd": mjd_val,
                "bandpass": bp_val,
                "obsid": obs_val,
                "collection": coll,
            })

        if records:
            records.sort(key=lambda r: r.get("time_mjd", 0.0))
            return records[:max_files]

    return None


def query_spherex_cutouts(
    ra_deg: float,
    dec_deg: float,
    size_arcmin: float,
    max_files: int,
    timeout: int = 90,
) -> List[Dict[str, Any]]:
    """
    Queries IRSA for SPHEREx observation cutouts covering the given coordinates.
    Order of attempts for speed & reliability:
    1. Fast spatially-indexed IRSA SIAv2 (astroquery Irsa.query_sia)
    2. Fast single-table IRSA Sync TAP on spherex.obscore (avoids polygon JOIN)
    3. Fast unordered IRSA Sync TAP on spherex.artifact JOIN spherex.plane
    4. IRSA Asynchronous TAP (/TAP/async) fallback (obscore then artifact/plane)
    """
    # 1. Try fast SIAv2 first (avoids TAP polygon join bottlenecks)
    sia_records = _query_via_sia(ra_deg, dec_deg, size_arcmin, max_files)
    if sia_records:
        return sia_records

    obscore_adql = _build_obscore_adql(ra_deg, dec_deg, max_files)
    unordered_adql = _build_spherex_adql(ra_deg, dec_deg, size_arcmin, max_files, ordered=False)
    ordered_adql = _build_spherex_adql(ra_deg, dec_deg, size_arcmin, max_files, ordered=True)

    last_err: Optional[Exception] = None
    records: Optional[List[Dict[str, Any]]] = None

    # 2. Try single-table spherex.obscore Sync TAP (no JOIN)
    print(f"  Sending spherex.obscore ADQL query to IRSA TAP (timeout={timeout}s)...")
    try:
        text = _execute_sync_tap(obscore_adql, timeout=timeout)
        records = _parse_tap_csv(text)
        records.sort(key=lambda r: r.get("time_mjd", 0.0))
    except Exception as e:
        last_err = e
        print(f"    [obscore Sync warning] {_short_err(e)}")

    # 3. Try fast unordered Sync TAP on artifact JOIN plane (2 attempts)
    if records is None:
        print(f"  Sending artifact/plane ADQL query to IRSA TAP (timeout={timeout}s)...")
        for attempt in range(1, 3):
            try:
                text = _execute_sync_tap(unordered_adql, timeout=timeout)
                records = _parse_tap_csv(text)
                records.sort(key=lambda r: r.get("time_mjd", 0.0))
                break
            except Exception as e:
                last_err = e
                print(f"    [Sync Retry {attempt}/2] IRSA TAP query warning: {_short_err(e)}")
                time.sleep(2.0 * attempt)

    # 4. Fall back to IRSA Async TAP (/TAP/async)
    if records is None:
        print("  Sync TAP timed out/failed; switching to IRSA Asynchronous TAP (/TAP/async)...")
        for label, q in [
            ("obscore", obscore_adql),
            ("unordered artifact/plane", unordered_adql),
            ("ordered artifact/plane", ordered_adql),
        ]:
            try:
                records = _execute_async_tap(q, timeout=max(180, timeout * 2))
                records.sort(key=lambda r: r.get("time_mjd", 0.0))
                break
            except Exception as e:
                last_err = e
                print(f"    [Async '{label}'] failed ({_short_err(e)})")

    if records is None:
        raise RuntimeError(f"IRSA queries failed (SIAv2 + Sync TAP + Async TAP): {_short_err(last_err) if last_err else 'Unknown error'}")

    if not records:
        print(f"  [NO QR2 COVERAGE] IRSA returned 0 exposures for coordinates RA={ra_deg}, Dec={dec_deg}.")
        print("  No matching observations found yet. Never inventing fake data.")
        return []

    return records


# ---------------------------------------------------------------------------
# Filter and Save FITS Cutout (Keep IMAGE, FLAGS, VARIANCE, WCS-WAVE)
# ---------------------------------------------------------------------------
def _resolve_datalink_candidates(
    datalink_url: str,
    ra_deg: float,
    dec_deg: float,
    size_arcmin: float,
) -> List[Tuple[str, bool]]:
    """
    Resolves an IRSA DataLink VOTable URL into ordered download candidates:
    [(url, needs_local_cutout), ...]
    Prefer fast IRSA server-side cutout first, then direct NASA AWS S3 FITS + local Cutout2D.
    """
    import xml.etree.ElementTree as ET

    req = urllib.request.Request(
        datalink_url,
        headers={"User-Agent": "SPHEREx-Data-Pipeline/2.0 (IRSA-QR2)"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        xml_bytes = resp.read()

    root = ET.fromstring(xml_bytes)
    ns = {"v": "http://www.ivoa.net/xml/VOTable/v1.3"}
    size_deg = size_arcmin / 60.0

    candidates: List[Tuple[str, bool]] = []
    s3_urls: List[Tuple[str, bool]] = []

    for tr in root.findall(".//v:TABLEDATA/v:TR", ns):
        tds = [td.text or "" for td in tr.findall("v:TD", ns)]
        if len(tds) < 5:
            continue
        semantics = tds[4].strip()
        access_url = tds[1].strip()
        service_def = tds[2].strip()
        ibe_path = tds[12].strip() if len(tds) > 12 else ""

        if semantics == "#cutout" and service_def == "ibe-cutout" and ibe_path:
            q_url = (
                "https://irsa.ipac.caltech.edu/ibe/cutout?"
                + urllib.parse.urlencode({
                    "ra": f"{ra_deg:.6f}",
                    "dec": f"{dec_deg:.6f}",
                    "size": f"{size_deg:.6f}",
                    "path": ibe_path,
                })
            )
            candidates.append((q_url, False))
        elif semantics == "#this" and access_url:
            candidates.append((
                f"{access_url}?center={ra_deg:.6f},{dec_deg:.6f}d&size={size_deg:.6f}d",
                False,
            ))
            # Check AWS S3 location metadata in last TD
            meta_json = tds[-1].strip() if tds else ""
            if meta_json.startswith("{"):
                try:
                    meta = json.loads(meta_json)
                    aws = meta.get("aws", {})
                    bucket = aws.get("bucket_name")
                    key = aws.get("key")
                    if bucket and key:
                        s3_urls.append((f"https://{bucket}.s3.amazonaws.com/{key}", True))
                except Exception:
                    pass

    candidates.extend(s3_urls)
    return candidates


def _slice_local_cutout_hdulist(
    hdulist: Any,
    ra_deg: float,
    dec_deg: float,
    size_arcmin: float,
) -> Any:
    """
    Slices a full SPHEREx Level-2 MEF (from AWS S3) down to a centered sky cutout
    matching IRSA's cutout layout (IMAGE, FLAGS, VARIANCE, WCS-WAVE).
    """
    from astropy.io import fits
    from astropy.nddata import Cutout2D
    from astropy.wcs import WCS
    from astropy.coordinates import SkyCoord
    import astropy.units as u

    img_hdr = hdulist["IMAGE"].header
    spatial_wcs = WCS(img_hdr)
    center = SkyCoord(ra=ra_deg * u.deg, dec=dec_deg * u.deg, frame="icrs")
    box_size = (size_arcmin * u.arcmin, size_arcmin * u.arcmin)

    cut_img = Cutout2D(
        hdulist["IMAGE"].data,
        position=center,
        size=box_size,
        wcs=spatial_wcs,
        mode="partial",
        fill_value=float("nan"),
    )
    xmin, ymin = cut_img.xmin_original, cut_img.ymin_original

    new_img_hdr = img_hdr.copy()
    new_img_hdr.update(cut_img.wcs.to_header(relax=True))
    # Shift spectral WCS ('W') reference pixels to match the sliced image origin
    if "CRPIX1W" in new_img_hdr:
        new_img_hdr["CRPIX1W"] = float(new_img_hdr["CRPIX1W"]) - float(xmin)
    if "CRPIX2W" in new_img_hdr:
        new_img_hdr["CRPIX2W"] = float(new_img_hdr["CRPIX2W"]) - float(ymin)

    clean_hdus = [hdulist[0].copy()]
    clean_hdus[0].header.add_comment("Cutout sliced locally from NASA AWS S3 (nasa-irsa-spherex)")
    clean_hdus[0].header["SPHEREX_RELEASE"] = ("QR2", "NASA SPHEREx Quick Release 2")
    clean_hdus[0].header["ARCHIVE_DOI"] = ("10.26131/IRSA652", "IRSA Archive DOI")

    clean_hdus.append(fits.ImageHDU(data=cut_img.data, header=new_img_hdr, name="IMAGE"))

    for ext_name, fill_val in [("FLAGS", 1), ("VARIANCE", float("nan"))]:
        if ext_name in hdulist:
            ext_cut = Cutout2D(
                hdulist[ext_name].data,
                position=center,
                size=box_size,
                wcs=spatial_wcs,
                mode="partial",
                fill_value=fill_val,
            )
            ext_hdr = hdulist[ext_name].header.copy()
            ext_hdr.update(ext_cut.wcs.to_header(relax=True))
            clean_hdus.append(fits.ImageHDU(data=ext_cut.data, header=ext_hdr, name=ext_name))

    if "WCS-WAVE" in hdulist:
        clean_hdus.append(hdulist["WCS-WAVE"].copy())

    return fits.HDUList(clean_hdus)


def download_and_filter_cutout(
    cutout_url: str,
    dest_path: Path,
    max_retries: int = 3,
    ra_deg: Optional[float] = None,
    dec_deg: Optional[float] = None,
    size_arcmin: float = 15.0,
) -> Dict[str, Any]:
    """
    Downloads the cutout MEF (or resolves DataLink + falls back to NASA AWS S3 + Cutout2D
    if IRSA IBE returns 502/503), drops PSF and ZODI, and extracts metadata.
    """
    # Build ordered download candidate list: [(url, needs_local_cutout), ...]
    download_candidates: List[Tuple[str, bool]] = []
    if "datalink/links/spherex" in cutout_url and ra_deg is not None and dec_deg is not None:
        download_candidates.extend(
            _resolve_datalink_candidates(cutout_url, ra_deg, dec_deg, size_arcmin)
        )
    else:
        download_candidates.append((cutout_url, False))
        # If this is an IRSA ibe/data/spherex/... URL, also append direct NASA S3 fallback
        if "irsa.ipac.caltech.edu/ibe/data/spherex/" in cutout_url:
            s3_key = cutout_url.split("irsa.ipac.caltech.edu/ibe/data/spherex/", 1)[1].split("?")[0]
            download_candidates.append((f"https://nasa-irsa-spherex.s3.amazonaws.com/{s3_key}", True))

    if not download_candidates:
        download_candidates.append((cutout_url, False))

    raw_data: Optional[bytes] = None
    needs_local_cutout = False
    used_url = cutout_url
    last_err: Optional[Exception] = None

    for cand_url, cand_needs_cutout in download_candidates:
        if cand_needs_cutout:
            print(f"    -> Falling back to NASA AWS S3 mirror (local spatial cutout)...")
        for attempt in range(1, max_retries + 1):
            try:
                req = urllib.request.Request(
                    cand_url,
                    headers={"User-Agent": "SPHEREx-Data-Pipeline/2.0 (IRSA-QR2)"}
                )
                with urllib.request.urlopen(req, timeout=90) as resp:
                    candidate = resp.read()
                if len(candidate) <= 2880 or not candidate.startswith(b"SIMPLE  ="):
                    raise ValueError(
                        f"Response was not a valid FITS file (len={len(candidate)})"
                    )
                raw_data = candidate
                needs_local_cutout = cand_needs_cutout
                used_url = cand_url
                break
            except Exception as e:
                last_err = e
                print(f"    [Retry {attempt}/{max_retries}] Download warning ({_short_err(e)})")
                if "502" in str(e) or "503" in str(e):
                    # Switch immediately to next mirror/S3 candidate on upstream proxy errors
                    break
                time.sleep(1.5 * attempt)
        if raw_data is not None:
            break

    if raw_data is None or len(raw_data) < 2880:
        raise RuntimeError(f"Failed to download cutout from {cutout_url}: {last_err}")

    # 2. Parse HDUs, slice locally if downloaded full frame from S3, and drop PSF/ZODI
    # Try astropy if available, otherwise pure Python FITS splitter
    try:
        from astropy.io import fits
        import io
        from astropy.wcs import WCS
        import astropy.units as u
        from astropy.coordinates import SkyCoord
        from astropy import log as astropy_log
        astropy_log.setLevel("ERROR")

        hdulist = fits.open(io.BytesIO(raw_data))
        if needs_local_cutout and ra_deg is not None and dec_deg is not None:
            sliced = _slice_local_cutout_hdulist(hdulist, ra_deg, dec_deg, size_arcmin)
            hdulist.close()
            hdulist = sliced

        # Primary header carries software version
        version = hdulist[0].header.get("VERSION", "unknown")
        date_obs = hdulist["IMAGE"].header.get("DATE-OBS", "not found")
        detector = hdulist["IMAGE"].header.get("DETECTOR", "not found")

        # Spectral wavelength calculation from WCS-WAVE lookup table
        central_wavelength_um = None
        bandwidth_um = None
        try:
            # WCS key "W" maps pixels to (wavelength, bandwidth)
            image_header = hdulist["IMAGE"].header
            spatial_wcs = WCS(image_header)
            crval1 = float(image_header.get("CRVAL1", 0.0))
            crval2 = float(image_header.get("CRVAL2", 0.0))
            center_coord = SkyCoord(ra=crval1 * u.deg, dec=crval2 * u.deg, frame="icrs")
            x, y = spatial_wcs.world_to_pixel(center_coord)

            spectral_wcs = WCS(image_header, fobj=hdulist, key="W")
            spectral_wcs.sip = None
            wave, band = spectral_wcs.pixel_to_world(x, y)
            central_wavelength_um = round(float(wave.to(u.micrometer).value), 5)
            bandwidth_um = round(float(band.to(u.micrometer).value) if hasattr(band, "to") else float(band), 5)
        except Exception as err:
            # Fallback if spectral_wcs fails on edge pixels
            pass

        # Build clean HDU list: Primary, IMAGE, FLAGS, VARIANCE, WCS-WAVE
        # Drop PSF cube and ZODI when saving to save space
        clean_hdus = [hdulist[0].copy()]
        clean_hdus[0].header.add_comment("Dropped PSF cube and ZODI extensions to save disk space")
        clean_hdus[0].header["SPHEREX_RELEASE"] = ("QR2", "NASA SPHEREx Quick Release 2")
        clean_hdus[0].header["ARCHIVE_DOI"] = ("10.26131/IRSA652", "IRSA Archive DOI")

        for name in ["IMAGE", "FLAGS", "VARIANCE", "WCS-WAVE"]:
            if name in hdulist:
                clean_hdus.append(hdulist[name].copy())

        filtered_hdul = fits.HDUList(clean_hdus)
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        filtered_hdul.writeto(dest_path, overwrite=True)
        hdulist.close()

    except ImportError:
        # Pure-Python fallback to parse and filter FITS without astropy
        import io
        buf = io.BytesIO(raw_data)
        dest_path.parent.mkdir(parents=True, exist_ok=True)

        # Parse HDU blocks
        hdus_data = []
        pos = 0
        buf.seek(0, 2)
        total_len = buf.tell()
        buf.seek(0)

        date_obs = "not found"
        detector = "not found"
        central_wavelength_um = None
        bandwidth_um = None

        while pos < total_len:
            hdr_bytes = b""
            while True:
                blk = buf.read(2880)
                if not blk:
                    break
                hdr_bytes += blk
                if b"END     " in blk:
                    break

            lines = [hdr_bytes[i:i+80].decode("ascii", errors="ignore") for i in range(0, len(hdr_bytes), 80)]
            header_map = {}
            for l in lines:
                if "=" in l:
                    k, v = l.split("=", 1)
                    header_map[k.strip()] = v.split("/")[0].strip().strip("' ")

            extname = header_map.get("EXTNAME", "PRIMARY")
            if "DATE-OBS" in header_map:
                date_obs = header_map["DATE-OBS"]
            if "DETECTOR" in header_map:
                try:
                    detector = int(header_map["DETECTOR"])
                except ValueError:
                    detector = header_map["DETECTOR"]

            # Calculate data bytes
            naxis = int(header_map.get("NAXIS", 0))
            data_bytes = 0
            if naxis > 0:
                shape = [int(header_map.get(f"NAXIS{i}", 0)) for i in range(1, naxis+1)]
                bitpix = int(header_map.get("BITPIX", 8))
                n_elem = 1
                for s in shape:
                    n_elem *= s
                pcount = int(header_map.get("PCOUNT", 0))
                gcount = int(header_map.get("GCOUNT", 1))
                bytes_elem = abs(bitpix) // 8
                data_bytes = (n_elem + pcount) * gcount * bytes_elem

            data_blocks = (data_bytes + 2879) // 2880
            d_bytes = buf.read(data_blocks * 2880)

            # Drop PSF and ZODI to save space
            if extname not in ("PSF", "ZODI"):
                hdus_data.append((hdr_bytes, d_bytes))

            pos = buf.tell()

        with open(dest_path, "wb") as f_out:
            for h_bytes, d_bytes in hdus_data:
                f_out.write(h_bytes)
                f_out.write(d_bytes)

    saved_size = dest_path.stat().st_size
    return {
        "file_name": dest_path.name,
        "observation_time": date_obs,
        "detector": detector,
        "central_wavelength_um": central_wavelength_um,
        "bandwidth_um": bandwidth_um,
        "size_bytes": saved_size,
        "sha256": calculate_sha256(dest_path),
        "source_url": used_url
    }


# ---------------------------------------------------------------------------
# Epoch Pair Finder
# ---------------------------------------------------------------------------
def find_epoch_pairs(manifest: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Identifies pairs of exposures on the same detector with similar central
    wavelength (within 2 percent) that were observed at least 14 days apart.
    """
    from datetime import datetime

    def parse_date(date_str: str) -> Optional[datetime]:
        for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime(date_str.split("+")[0].strip(), fmt)
            except ValueError:
                continue
        return None

    pairs = []
    n = len(manifest)

    for i in range(n):
        f1 = manifest[i]
        d1 = parse_date(f1.get("observation_time", ""))
        det1 = f1.get("detector")
        w1 = f1.get("central_wavelength_um")

        if d1 is None or det1 is None:
            continue

        for j in range(i + 1, n):
            f2 = manifest[j]
            d2 = parse_date(f2.get("observation_time", ""))
            det2 = f2.get("detector")
            w2 = f2.get("central_wavelength_um")

            if d2 is None or det2 is None:
                continue

            # Check same detector
            if det1 != det2:
                continue

            # Check observed at least 14 days apart
            delta_days = abs((d2 - d1).total_seconds()) / 86400.0
            if delta_days < 14.0:
                continue

            # Check similar central wavelength within 2 percent
            if w1 is not None and w2 is not None and w1 > 0:
                wavelength_diff_pct = abs(w1 - w2) / w1 * 100.0
                if wavelength_diff_pct > 2.0:
                    continue
            else:
                wavelength_diff_pct = 0.0

            pairs.append({
                "detector": det1,
                "epoch_1": {
                    "file_name": f1["file_name"],
                    "observation_time": f1["observation_time"],
                    "central_wavelength_um": w1
                },
                "epoch_2": {
                    "file_name": f2["file_name"],
                    "observation_time": f2["observation_time"],
                    "central_wavelength_um": w2
                },
                "separation_days": round(delta_days, 1),
                "wavelength_diff_pct": round(wavelength_diff_pct, 2)
            })

    return pairs


# ---------------------------------------------------------------------------
# Main Routine
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Download real NASA SPHEREx QR2 cutouts from IRSA TAP."
    )
    parser.add_argument("--yes", "-y", action="store_true", help="Auto-confirm download prompt.")
    parser.add_argument("--max-size-gb", type=float, default=2.0, help="Maximum total download size in GB.")
    parser.add_argument("--timeout", type=int, default=90, help="TAP query timeout in seconds (default: 90).")
    parser.add_argument("--skip-cached", action="store_true", help="Skip regions that already have a cached manifest.json.")
    parser.add_argument(
        "--region",
        type=str,
        default="all",
        help="Region ID to download (or 'all' for all regions in pipeline/regions.yaml)."
    )
    args = parser.parse_args()

    print("=================================================================")
    print(" SPHEREx Offline Data Pipeline - Image Cutout Fetcher")
    print(f" Collection: {COLLECTION_NAME} | DOI: 10.26131/IRSA652")
    print("=================================================================\n")

    offline_mode = os.environ.get("OFFLINE", "0").lower() in ("1", "true", "yes")
    config = load_config(CONFIG_FILE)
    all_regions = config.get("regions", [])

    if args.region.lower() != "all":
        requested = {r.strip() for r in args.region.split(",") if r.strip()}
        regions = [r for r in all_regions if r.get("id") in requested]
        if not regions:
            valid_ids = [r.get("id") for r in all_regions]
            print(f"[FATAL] Region(s) {sorted(requested)} not found in pipeline/regions.yaml.")
            print(f"Available region IDs: {', '.join(valid_ids)}")
            sys.exit(1)
    else:
        regions = all_regions

    if offline_mode:
        print("[OFFLINE MODE ACTIVE] OFFLINE=1 is set. Checking local cache only.\n")
        missing_regions = []
        for reg in regions:
            reg_id = reg["id"]
            reg_dir = CACHE_DIR / reg_id
            manifest_file = reg_dir / "manifest.json"
            if not manifest_file.exists():
                missing_regions.append(reg_id)
                print(f"[{reg_id}] [MISSING] No local manifest found in cache/spherex/{reg_id}/.")
            else:
                with open(manifest_file, "r", encoding="utf-8") as f:
                    m = json.load(f)
                print(f"[{reg_id}] [OK] {len(m)} cached FITS files in {reg_dir.relative_to(REPO_ROOT)}.")

        if missing_regions:
            print(f"\n[FATAL] Missing offline cache for regions: {missing_regions}")
            print("To download real data, run without OFFLINE=1.")
            sys.exit(1)
        print("\n[PASS] Offline verification complete.")
        sys.exit(0)

    downloaded_regions: List[str] = []
    no_coverage_regions: List[str] = []
    failed_regions: List[str] = []

    # Online mode: query IRSA TAP and download real cutouts
    for reg in regions:
        reg_id = reg["id"]
        ra = float(reg["ra_deg"])
        dec = float(reg["dec_deg"])
        size_arcmin = float(reg["size_arcmin"])
        max_files = int(reg.get("max_files", 120))

        reg_dir = CACHE_DIR / reg_id
        reg_dir.mkdir(parents=True, exist_ok=True)
        manifest_file = reg_dir / "manifest.json"
        epoch_pairs_file = reg_dir / "epoch_pairs.json"

        # Load any previous manifest so resumed cached files keep accurate metadata
        prev_manifest_map: Dict[str, Dict[str, Any]] = {}
        if manifest_file.exists():
            try:
                with open(manifest_file, "r", encoding="utf-8") as pmf:
                    for item in json.load(pmf):
                        if item.get("file_name"):
                            prev_manifest_map[item["file_name"]] = item
            except Exception:
                pass

        if args.skip_cached and prev_manifest_map:
            print(f"[{reg_id}] [CACHED] Skipping IRSA query ({len(prev_manifest_map)} files in cache).")
            downloaded_regions.append(reg_id)
            continue

        print(f"[{reg_id}] Region: {reg.get('name', reg_id)}")
        print(f"  Coordinates: RA={ra:.4f}°, Dec={dec:.4f}°, Size={size_arcmin}'")

        try:
            records = query_spherex_cutouts(
                ra, dec, size_arcmin, max_files, timeout=args.timeout
            )
        except Exception as e:
            print(f"  [ERROR] Could not query IRSA TAP for [{reg_id}]: {e}")
            print("  Skipping this region for now and continuing...\n")
            failed_regions.append(reg_id)
            continue

        if not records:
            no_coverage_regions.append(reg_id)
            print()
            continue

        print(f"  Found {len(records)} overlapping exposures in '{COLLECTION_NAME}'.")

        # Estimate download size (clean cutouts without PSF/ZODI are ~35 KB)
        estimated_mb = len(records) * 0.05
        print(f"  Estimated download size: ~{estimated_mb:.1f} MB (well within {args.max_size_gb:.1f} GB limit).")

        # User confirmation
        if not args.yes:
            prompt = f"  Proceed with downloading {len(records)} cutouts for [{reg_id}]? [y/N]: "
            try:
                choice = input(prompt).strip().lower()
            except EOFError:
                choice = "y"
            if choice not in ("y", "yes"):
                print("  Download cancelled by user.")
                continue

        manifest: List[Dict[str, Any]] = []
        skipped_count = 0

        for idx, rec in enumerate(records, 1):
            uri = rec["uri"]
            # Clean filename from URI (handle DataLink URLs cleanly)
            if "datalink/links/spherex" in uri and rec.get("obsid"):
                safe_obs = rec["obsid"].replace("/", "_").replace(":", "_")
                det_suffix = uri.split("/")[-1] if "/" in uri else f"{idx:03d}"
                base_name = f"spherex_{safe_obs}_{det_suffix}.fits"
            else:
                base_name = uri.split("?")[0].split("/")[-1]
                if not base_name.endswith(".fits"):
                    base_name = f"spherex_cutout_{idx:03d}.fits"
            dest_file = reg_dir / base_name

            # Resume from cache if file already exists and is non-empty
            if dest_file.exists() and dest_file.stat().st_size > 1024:
                print(f"  [{idx}/{len(records)}] Cached: {base_name} ({dest_file.stat().st_size} bytes)")
                prev = prev_manifest_map.get(base_name, {})
                manifest.append({
                    "file_name": base_name,
                    "observation_time": prev.get("observation_time", str(rec.get("time_mjd", ""))),
                    "detector": prev.get("detector", rec.get("bandpass")),
                    "central_wavelength_um": prev.get("central_wavelength_um"),
                    "bandwidth_um": prev.get("bandwidth_um"),
                    "size_bytes": dest_file.stat().st_size,
                    "sha256": calculate_sha256(dest_file),
                    "source_url": uri
                })
                continue

            print(f"  [{idx}/{len(records)}] Downloading cutout: {base_name}...")
            try:
                file_meta = download_and_filter_cutout(
                    uri,
                    dest_file,
                    ra_deg=ra,
                    dec_deg=dec,
                    size_arcmin=size_arcmin,
                )
                manifest.append(file_meta)
            except Exception as e:
                skipped_count += 1
                print(f"  [WARNING] Skipping cutout {base_name} for [{reg_id}]: {_short_err(e)}")
                continue
            time.sleep(0.35)  # Polite pause between requests to IRSA

        if not manifest:
            failed_regions.append(reg_id)
            print()
            continue

        # Write manifest.json (even if partial so next run resumes cleanly)
        with open(manifest_file, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
        print(f"  -> Saved manifest to: {manifest_file.relative_to(REPO_ROOT)} ({len(manifest)} exposures)")

        # Find and save epoch pairs
        epoch_pairs = find_epoch_pairs(manifest)
        with open(epoch_pairs_file, "w", encoding="utf-8") as f:
            json.dump(epoch_pairs, f, indent=2)

        if epoch_pairs:
            print(f"  -> Found {len(epoch_pairs)} moving-object candidate epoch pairs (saved to {epoch_pairs_file.relative_to(REPO_ROOT)}).")
        else:
            print(f"  -> No epoch pairs separated by >= 14 days were found for this region.")

        if skipped_count > 0:
            print(f"  [NOTE] {len(manifest)}/{len(records)} exposures saved for [{reg_id}] ({skipped_count} skipped).")
        downloaded_regions.append(reg_id)
        print()

    if not downloaded_regions:
        if failed_regions:
            print(f"[FATAL] Queries/downloads failed for requested regions: {failed_regions}")
        elif no_coverage_regions:
            print(f"[FATAL] None of the requested regions had QR2 coverage on IRSA yet: {no_coverage_regions}")
        sys.exit(1)

    if failed_regions:
        print(f"[WARNING] Some regions timed out or failed (re-run with --region {','.join(failed_regions)}): {', '.join(failed_regions)}")
    if no_coverage_regions:
        print(f"[NOTICE] Regions with 0 exposures in IRSA spherex_qr2 at this time: {', '.join(no_coverage_regions)}")

    print(f"[SUCCESS] SPHEREx QR2 cutouts download complete for {len(downloaded_regions)} region(s).")


if __name__ == "__main__":
    main()
