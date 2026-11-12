import glob, warnings, collections
import numpy as np
import astropy.units as u
from astropy.io import fits
from astropy.time import Time
from astropy.wcs import WCS

warnings.filterwarnings("ignore")

rows, failed = [], 0
for path in sorted(glob.glob("cache/spherex/*/*.fits")):
    try:
        with fits.open(path) as hdul:
            h = hdul["IMAGE"].header
            ny, nx = hdul["IMAGE"].data.shape
            w = WCS(h, fobj=hdul, key="W")
            w.sip = None
            lam, _ = w.pixel_to_world(nx / 2, ny / 2)
            det = hdul[0].header.get("DETECTOR") or h.get("DETECTOR")
            date = h.get("DATE-AVG") or hdul[0].header.get("DATE-AVG") \
                or h.get("DATE-OBS") or hdul[0].header.get("DATE-OBS")
            rows.append({
                "region": path.replace("\\", "/").split("/")[-2],
                "det": det,
                "t": Time(date),
                "wl": float(lam.to(u.micrometer).value),
            })
    except Exception as e:
        failed += 1
        if failed <= 3:
            print("could not read", path, "->", e)

print(f"\nFiles read: {len(rows)}   failed: {failed}")
by = collections.defaultdict(list)
for r in rows:
    by[r["region"]].append(r)

for region, rs in by.items():
    ts = sorted(r["t"] for r in rs)
    wl = [r["wl"] for r in rs]
    print(f"\nRegion: {region}   files: {len(rs)}")
    print(f"  dates: {ts[0].iso[:10]}  to  {ts[-1].iso[:10]}")
    print(f"  wavelength at field centre: {min(wl):.2f} to {max(wl):.2f} um")
    dets = collections.Counter(r["det"] for r in rs)
    print("  files per detector:", dict(sorted(dets.items(), key=lambda x: str(x[0]))))

    pairs, used = 0, set()
    for i in range(len(rs)):
        for j in range(i + 1, len(rs)):
            a, b = rs[i], rs[j]
            if a["det"] != b["det"]:
                continue
            if abs(a["wl"] - b["wl"]) / a["wl"] > 0.02:
                continue
            if abs((a["t"] - b["t"]).jd) < 14:
                continue
            pairs += 1
            used.update([i, j])
    print(f"  epoch pairs (same detector, wavelength within 2%, 14+ days apart): {pairs}")
    print(f"  files involved in pairs: {len(used)}")