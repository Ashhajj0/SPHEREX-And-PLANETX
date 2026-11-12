import glob, json, os, warnings
warnings.filterwarnings("ignore")
from astropy import log
log.setLevel("ERROR")
import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from backend.compute.detect import BAD_PIXEL_MASK

NAMES = {0: "TRANSIENT", 1: "OVERFLOW", 2: "SUR_ERROR", 6: "NONFUNC",
         19: "OUTLIER", 21: "SOURCE"}

def bits(v):
    return [b for b in range(32) if int(v) & (1 << b)]

def label(b):
    return f"{b}:{NAMES.get(b, '?')}"

print("Bits our code treats as BAD:", [label(b) for b in bits(BAD_PIXEL_MASK)])

base = "web/public/real/"
exps = {e["id"]: e for e in json.load(open(base + "exposures.json"))}
raw = json.load(open(base + "sources.json"))
sources = raw["sources"] if isinstance(raw, dict) else raw
src = {s["id"]: s for s in sources}

cases = [("SPX-NEP-001", "E013"), ("SPX-NEP-001", "E029"),
         ("SPX-NEP-002", "E029"), ("SPX-NEP-002", "E056")]

for sid, eid in cases:
    name = os.path.basename(exps[eid]["file"])
    found = glob.glob(f"cache/spherex/**/{name}", recursive=True)
    print(f"\n{sid} in {eid} ({exps[eid]['wavelength_um']:.3f} um)")
    if not found:
        print("  file not found in cache/")
        continue
    with fits.open(found[0]) as h:
        img = h["IMAGE"].data
        flg = h["FLAGS"].data
        w = WCS(h["IMAGE"].header)
        x, y = w.all_world2pix(src[sid]["ra_deg"], src[sid]["dec_deg"], 0)
        x, y = float(x), float(y)
    yy, xx = np.indices(img.shape)
    ap = (xx - x) ** 2 + (yy - y) ** 2 <= 4.0
    top = np.nanmax(img[ap])
    print(f"  pixels in aperture: {ap.sum()}   brightest pixel: {top:.3g} MJy/sr")
    for py, px in zip(*np.where(ap & (flg != 0))):
        tag = " <- brightest" if img[py, px] == top else ""
        print(f"  flagged pixel ({px},{py}): value {img[py, px]:.3g}, "
              f"bits {[label(b) for b in bits(flg[py, px])]}{tag}")