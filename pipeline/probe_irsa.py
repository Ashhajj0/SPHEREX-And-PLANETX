import re, warnings
warnings.filterwarnings("ignore")
import numpy as np
import astropy.units as u
from astropy.coordinates import SkyCoord
from astropy.time import Time
from astroquery.ipac.irsa import Irsa

coord = SkyCoord(270.3317 * u.deg, 66.5614 * u.deg)

names = []
try:
    tab = Irsa.list_collections()
    for row in tab:
        text = " ".join(str(v) for v in row)
        if "spherex" in text.lower():
            names.append(str(row["collection"]) if "collection" in tab.colnames else text[:40])
    print("SPHEREx collections IRSA lists:", sorted(set(names)))
except Exception as e:
    print("list_collections failed:", str(e)[:120])
names = sorted(set(names)) or ["spherex_qr", "spherex_qr2", "spherex_qr3"]

for name in names:
    for label, kw in (("default", {}), ("maxrec=100000", {"maxrec": 100000})):
        try:
            t = Irsa.query_sia(pos=(coord, 0.1 * u.deg), collection=name, **kw)
        except Exception as e:
            print(f"{name:14} {label:14} FAILED: {str(e)[:80]}")
            continue
        n = len(t)
        info = ""
        if n and "access_url" in t.colnames:
            weeks = sorted(set(re.findall(r"/(\d{4}W\d{2})_", " ".join(map(str, t["access_url"])))))
            if weeks:
                info = f" weeks {weeks[0]} to {weeks[-1]} ({len(weeks)} weeks)"
        if n and "t_min" in t.colnames:
            try:
                v = np.asarray(t["t_min"].filled(np.nan), dtype=float)
                info += f" | dates {Time(np.nanmin(v), format='mjd').iso[:10]} to {Time(np.nanmax(v), format='mjd').iso[:10]}"
            except Exception:
                pass
        print(f"{name:14} {label:14} rows: {n}{info}")