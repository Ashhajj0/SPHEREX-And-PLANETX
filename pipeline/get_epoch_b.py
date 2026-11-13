"""
Download a SECOND EPOCH of SPHEREx cutouts for moving-object screening.
Run:   python pipeline/get_epoch_b.py
Saves to cache/epoch_b/north-ecliptic-pole/ (kept apart from the main dataset).
Safe to stop (Ctrl+C) and rerun: finished files are skipped.
"""
import argparse, glob, io, os, re, sys, time, warnings
from collections import Counter
from datetime import datetime
warnings.filterwarnings("ignore")
import requests
from astropy import log
log.setLevel("ERROR")
import astropy.units as u
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.time import Time
from astroquery.ipac.irsa import Irsa

RA, DEC, SIZE_DEG = 270.3317, 66.5614, 0.25
MAIN_DIR = "cache/spherex/north-ecliptic-pole"
OUT_DIR = "cache/epoch_b/north-ecliptic-pole"
KEEP = ["PRIMARY", "IMAGE", "FLAGS", "VARIANCE", "WCS-WAVE"]


def latest_main_time():
    latest = None
    for f in glob.glob(os.path.join(MAIN_DIR, "*.fits")):
        with fits.open(f) as h:
            hdr = h["IMAGE"].header
            d = (hdr.get("DATE-AVG") or h[0].header.get("DATE-AVG")
                 or hdr.get("DATE-OBS") or h[0].header.get("DATE-OBS"))
        t = Time(d)
        if latest is None or t > latest:
            latest = t
    return latest


def row_info(r, cols):
    url = str(r["access_url"])
    wk = re.search(r"/(\d{4})W(\d{2})_", url)
    det = re.search(r"/(\d)/level2_", url) or re.search(r"D(\d)_spx", url)
    t = None
    if "t_min" in cols and "t_max" in cols:
        try:
            a, b = float(r["t_min"]), float(r["t_max"])
            if a == a and b == b:
                t = Time(0.5 * (a + b), format="mjd")
        except Exception:
            t = None
    if t is None and wk:
        t = Time(datetime.strptime(f"{wk.group(1)}-W{wk.group(2)}-1", "%G-W%V-%u"))
    if t is None:
        return None
    return {"url": url, "t": t,
            "week": f"{wk.group(1)}W{wk.group(2)}" if wk else "?",
            "det": int(det.group(1)) if det else 0}


def download(url, out_path):
    cut = f"{url}?center={RA:.6f},{DEC:.6f}d&size={SIZE_DEG:.6f}d"
    last = "unknown error"
    for attempt in range(1, 6):
        try:
            resp = requests.get(cut, timeout=180)
            if resp.status_code == 200 and len(resp.content) > 2000:
                with fits.open(io.BytesIO(resp.content), memmap=False) as hdul:
                    names = [h.name for h in hdul]
                    if not all(k in names for k in KEEP):
                        return "missing extensions"
                    for h in list(hdul):
                        if h.name not in KEEP:
                            hdul.remove(h)
                    hdul.writeto(out_path, overwrite=True)
                return "ok"
            last = f"HTTP {resp.status_code}"
            if resp.status_code in (400, 404):
                return last
        except Exception as e:
            last = str(e)[:80]
        time.sleep(4 * attempt)
    return last


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--collection", default="spherex_qr2")
    ap.add_argument("--min-days", type=float, default=14.0)
    ap.add_argument("--max-files", type=int, default=60)
    args = ap.parse_args()

    a_end = latest_main_time()
    if a_end is None:
        print("No epoch-A files found in", MAIN_DIR)
        sys.exit(1)
    print("Epoch A ends:", a_end.iso[:10])

    print("Asking IRSA for all observations of the field (can take a minute)...")
    coord = SkyCoord(RA * u.deg, DEC * u.deg)
    try:
        try:
            tab = Irsa.query_sia(pos=(coord, 0.1 * u.deg),
                                 collection=args.collection, maxrec=100000)
        except TypeError:
            tab = Irsa.query_sia(pos=(coord, 0.1 * u.deg), collection=args.collection)
    except Exception as e:
        print("IRSA query failed:", e)
        sys.exit(1)
    cols = tab.colnames
    print("IRSA returned", len(tab), "rows.")
    if "access_url" not in cols:
        print("Columns found:", cols)
        print("No access_url column. Send me this list.")
        sys.exit(1)

    rows = [x for x in (row_info(r, cols) for r in tab) if x and ".fits" in x["url"].lower()]
    if not rows:
        print("No usable rows.")
        sys.exit(1)
    weeks = Counter(r["week"] for r in rows)
    print("Observations per week:", ", ".join(f"{w}:{n}" for w, n in sorted(weeks.items())))
    print("Date range available:", min(r["t"] for r in rows).iso[:10],
          "to", max(r["t"] for r in rows).iso[:10])

    later = [r for r in rows if r["t"].mjd >= a_end.mjd + args.min_days]
    if not later:
        print(f"\nNO observations at least {args.min_days:.0f} days after epoch A in "
              f"collection {args.collection}.")
        print("Send me the lines above. Moving-object mode cannot work with this collection.")
        sys.exit(0)

    later.sort(key=lambda r: r["t"].mjd)
    wk_order = []
    for r in later:
        if r["week"] not in wk_order:
            wk_order.append(r["week"])
    pool = []
    for w in wk_order:
        pool += [r for r in later if r["week"] == w]
        if len(pool) >= args.max_files * 3:
            break
    by_det = {}
    for r in pool:
        by_det.setdefault(r["det"], []).append(r)
    chosen = []
    while len(chosen) < args.max_files and any(by_det.values()):
        for d in sorted(by_det):
            if by_det[d] and len(chosen) < args.max_files:
                chosen.append(by_det[d].pop(0))

    print(f"\nWill download {len(chosen)} cutouts (roughly 5 MB each) from weeks "
          f"{sorted(set(r['week'] for r in chosen))}.")
    print("Press Ctrl+C to cancel. Starting in 5 seconds...")
    time.sleep(5)
    os.makedirs(OUT_DIR, exist_ok=True)

    ok = 0
    for i, r in enumerate(chosen, 1):
        name = os.path.basename(r["url"].split("?")[0])
        out = os.path.join(OUT_DIR, name)
        if os.path.exists(out):
            ok += 1
            print(f"[{i}/{len(chosen)}] {name} already done")
            continue
        status = download(r["url"], out)
        ok += status == "ok"
        print(f"[{i}/{len(chosen)}] {name} -> {status}")
        time.sleep(0.3)
    print(f"\nDone: {ok}/{len(chosen)} files in {OUT_DIR}")
    print("Next: python -m backend.compute.moving_candidates")


if __name__ == "__main__":
    main()