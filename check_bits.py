import glob, collections, warnings
warnings.filterwarnings("ignore")
import numpy as np
from astropy.io import fits
from backend.compute.detect import BAD_PIXEL_MASK

NAMES = {0: "TRANSIENT", 1: "OVERFLOW", 2: "SUR_ERROR", 6: "NONFUNC",
         19: "OUTLIER", 21: "SOURCE"}

files = sorted(glob.glob("cache/spherex/north-ecliptic-pole/*.fits"))
counts = collections.Counter()
total = 0
for f in files:
    with fits.open(f) as h:
        fl = h["FLAGS"].data.astype(np.int64)
    total += fl.size
    for b in range(32):
        n = int(np.count_nonzero(fl & (1 << b)))
        if n:
            counts[b] += n

print(f"Files: {len(files)}   pixels: {total:,}")
print("bit  name           pixels    share   treated as BAD?")
for b in sorted(counts):
    bad = "YES" if BAD_PIXEL_MASK & (1 << b) else "no"
    print(f"{b:>3}  {NAMES.get(b, '?'):<11} {counts[b]:>10,}  {100 * counts[b] / total:6.2f}%   {bad}")