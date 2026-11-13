"""
Moving-object screening: compare two epochs of the same SPHEREx field.
Run:  python -m backend.compute.moving_candidates
Epoch A: cache/spherex/north-ecliptic-pole      (existing 120 files)
Epoch B: cache/epoch_b/north-ecliptic-pole      (from pipeline/get_epoch_b.py)
Writes:  web/public/real/moving/  (index.json + PNG images)
Results are CANDIDATES only and need independent confirmation.
"""
import argparse, glob, json, os, warnings
from datetime import datetime, timezone
import numpy as np
warnings.filterwarnings("ignore")
from astropy import log
log.setLevel("ERROR")
import astropy.units as u
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.time import Time
from astropy.wcs import WCS
from PIL import Image
from reproject import reproject_interp
from scipy.ndimage import maximum_filter, median_filter
from backend.compute.detect import BAD_PIXEL_MASK

DIR_A = "cache/spherex/north-ecliptic-pole"
DIR_B = "cache/epoch_b/north-ecliptic-pole"
OUT_DIRS = ["web/public/real/moving", "public/real/moving"]
PIXEL_ARCSEC = 6.15


def load(path):
    with fits.open(path, memmap=False) as h:
        hdr = h["IMAGE"].header
        img = np.array(h["IMAGE"].data, dtype=float)
        flg = np.array(h["FLAGS"].data).astype(np.int64)
        det = h[0].header.get("DETECTOR") or hdr.get("DETECTOR")
        date = (hdr.get("DATE-AVG") or h[0].header.get("DATE-AVG")
                or hdr.get("DATE-OBS") or h[0].header.get("DATE-OBS"))
        wcs = WCS(hdr)
        lam = None
        try:
            wv = WCS(hdr, fobj=h, key="W")
            wv.sip = None
            ny, nx = img.shape
            lam_c, _ = wv.pixel_to_world(nx / 2, ny / 2)
            lam = float(lam_c.to(u.micrometer).value)
        except Exception:
            lam = None
    bad = ((flg & int(BAD_PIXEL_MASK)) != 0) | ~np.isfinite(img)
    return {"name": os.path.basename(path), "img": img, "bad": bad, "wcs": wcs,
            "det": det, "t": Time(date), "lam": lam, "valid": float((~bad).mean())}


def subtract_background(img, bad):
    work = np.where(bad, np.nan, img)
    work = np.where(np.isfinite(work), work, np.nanmedian(work))
    resid = work - median_filter(work, size=15, mode="nearest")
    vals = resid[~bad]
    sigma = 1.4826 * np.median(np.abs(vals - np.median(vals)))
    return np.where(bad, 0.0, resid), float(sigma)


def detect(resid, bad, sigma, min_snr, edge=6):
    mx = maximum_filter(resid, size=5, mode="nearest")
    ys, xs = np.nonzero((resid == mx) & (resid > 5.0 * sigma))
    h, w = resid.shape
    out = []
    for y, x in zip(ys, xs):
        if x < edge or y < edge or x >= w - edge or y >= h - edge:
            continue
        if bad[y - 2:y + 3, x - 2:x + 3].any():
            continue
        snr = resid[y, x] / sigma
        if snr < min_snr:
            continue
        win = np.clip(resid[y - 1:y + 2, x - 1:x + 2], 0, None)
        s = win.sum()
        if s <= 0:
            continue
        gy, gx = np.mgrid[y - 1:y + 2, x - 1:x + 2]
        out.append((float((win * gx).sum() / s), float((win * gy).sum() / s),
                    float(snr), float(resid[y - 1:y + 2, x - 1:x + 2].sum())))
    return out


def inside(other, ra, dec, margin=6):
    x, y = other["wcs"].all_world2pix(ra, dec, 0, quiet=True)
    x = np.nan_to_num(x, nan=-1e9)
    y = np.nan_to_num(y, nan=-1e9)
    h, w = other["img"].shape
    ok = (x >= margin) & (x < w - margin) & (y >= margin) & (y < h - margin)
    xi = np.clip(np.round(x).astype(int), 0, w - 1)
    yi = np.clip(np.round(y).astype(int), 0, h - 1)
    return ok & ~other["bad"][yi, xi]


def alignment(ca, cb):
    idx, d2d, _ = cb.match_to_catalog_sky(ca)
    sel = d2d.arcsec < PIXEL_ARCSEC
    if sel.sum() < 8:
        return None
    dra = (cb.ra - ca[idx].ra).wrap_at(180 * u.deg).arcsec * np.cos(cb.dec.rad)
    ddec = (cb.dec - ca[idx].dec).arcsec
    off = [np.median(dra[sel]), np.median(ddec[sel])]
    for _ in range(3):
        sel = np.hypot(dra - off[0], ddec - off[1]) < 4.0
        if sel.sum() < 8:
            return None
        off = [np.median(dra[sel]), np.median(ddec[sel])]
    s_ra = 1.4826 * np.median(np.abs(dra[sel] - off[0]))
    s_dec = 1.4826 * np.median(np.abs(ddec[sel] - off[1]))
    return off, float(np.hypot(s_ra, s_dec)), int(sel.sum())


def save_gray(path, resid, invalid, sigma, lo, hi):
    v = np.arcsinh(resid / (3 * sigma))
    g = (np.clip((v - lo) / (hi - lo), 0, 1) * 255).astype(np.uint8)
    rgba = np.zeros(resid.shape + (4,), np.uint8)
    rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = g
    rgba[..., 3] = np.where(invalid, 0, 255)
    Image.fromarray(np.ascontiguousarray(np.flipud(rgba))).save(path)


def save_diff(path, d, invalid, s):
    v = np.clip(np.arcsinh(d / (3 * s)) / 1.97, -1, 1)
    rgba = np.zeros(d.shape + (4,), np.uint8)
    rgba[..., 0] = (255 * np.clip(v, 0, 1)).astype(np.uint8)
    rgba[..., 1] = (90 * np.abs(v)).astype(np.uint8)
    rgba[..., 2] = (255 * np.clip(-v, 0, 1)).astype(np.uint8)
    rgba[..., 3] = np.where(invalid, 0, 255)
    Image.fromarray(np.ascontiguousarray(np.flipud(rgba))).save(path)


def pick_pairs(A, B, tol, min_days, max_pairs):
    options = []
    for a in A:
        for b in B:
            if a["det"] != b["det"] or a["lam"] is None or b["lam"] is None:
                continue
            dl = abs(a["lam"] - b["lam"]) / a["lam"]
            days = abs(b["t"].jd - a["t"].jd)
            if dl > tol or days < min_days or min(a["valid"], b["valid"]) < 0.6:
                continue
            options.append((dl, -days, a, b))
    options.sort(key=lambda o: (o[0], o[1]))
    chosen, used_det, used_files = [], set(), set()
    for pass_no in (1, 2):
        for dl, nd, a, b in options:
            if len(chosen) >= max_pairs:
                break
            if a["name"] in used_files or b["name"] in used_files:
                continue
            if pass_no == 1 and a["det"] in used_det:
                continue
            chosen.append((a, b))
            used_det.add(a["det"])
            used_files.update([a["name"], b["name"]])
    return chosen, len(options)


def process_pair(a, b, pid, args, out_dirs):
    img_a, sa = subtract_background(a["img"], a["bad"])
    img_b, sb = subtract_background(b["img"], b["bad"])
    da = detect(img_a, a["bad"], sa, args.min_snr)
    db = detect(img_b, b["bad"], sb, args.min_snr)
    if len(da) < 8 or len(db) < 8:
        return None, f"too few sources (A {len(da)}, B {len(db)})"
    raa, deca = a["wcs"].all_pix2world([p[0] for p in da], [p[1] for p in da], 0)
    rab, decb = b["wcs"].all_pix2world([p[0] for p in db], [p[1] for p in db], 0)
    ma, mb = inside(b, raa, deca), inside(a, rab, decb)
    da = [p for p, m in zip(da, ma) if m]
    db = [p for p, m in zip(db, mb) if m]
    raa, deca, rab, decb = raa[ma], deca[ma], rab[mb], decb[mb]
    if len(da) < 8 or len(db) < 8:
        return None, "too few sources in the overlap"
    ca = SkyCoord(raa * u.deg, deca * u.deg)
    cb = SkyCoord(rab * u.deg, decb * u.deg)
    al = alignment(ca, cb)
    if al is None:
        return None, "alignment failed (fewer than 8 stationary matches)"
    off, rms, n_match = al
    ra_bc = rab - off[0] / 3600.0 / np.cos(np.radians(decb))
    dec_bc = decb - off[1] / 3600.0
    cbc = SkyCoord(ra_bc * u.deg, dec_bc * u.deg)

    fa = np.array([p[3] for p in da])
    fb = np.array([p[3] for p in db])
    ib, ia, d2d, _ = ca.search_around_sky(cbc, args.max_link * u.arcsec)
    dist = d2d.arcsec
    ratio = fb[ib] / np.maximum(fa[ia], 1e-12)
    keep = (ratio > 1 / args.flux_ratio) & (ratio < args.flux_ratio)
    ia, ib, dist = ia[keep], ib[keep], dist[keep]
    used_a, used_b, matches = set(), set(), []
    for k in np.argsort(dist):
        i, j = int(ia[k]), int(ib[k])
        if i in used_a or j in used_b:
            continue
        used_a.add(i)
        used_b.add(j)
        matches.append((i, j, float(dist[k])))

    stat_tol = max(3.0, 3.0 * rms)
    n_stat = sum(1 for m in matches if m[2] <= stat_tol)
    changed = [m for m in matches if m[2] > stat_tol]
    xb_a, yb_a = a["wcs"].all_world2pix(ra_bc, dec_bc, 0, quiet=True)
    links = []
    for i, j, dd in changed:
        links.append({
            "ra_deg": round(float(raa[i]), 6), "dec_deg": round(float(deca[i]), 6),
            "ra_b_deg": round(float(ra_bc[j]), 6), "dec_b_deg": round(float(dec_bc[j]), 6),
            "x_a": round(da[i][0], 2), "y_a": round(da[i][1], 2),
            "x_b": round(float(xb_a[j]), 2), "y_b": round(float(yb_a[j]), 2),
            "motion_arcsec": round(dd, 2), "motion_err_arcsec": round(rms, 2),
            "significance": round(dd / max(rms, 0.3), 1),
            "pa_deg": round(float(ca[i].position_angle(cbc[j]).deg), 1),
            "snr_a": round(da[i][2], 1), "snr_b": round(db[j][2], 1)})
    links.sort(key=lambda l: -l["significance"])
    for n, l in enumerate(links, 1):
        l["id"] = f"{pid}-C{n:02d}"

    # images on the epoch-A pixel grid
    rb, _ = reproject_interp((img_b, b["wcs"]), a["wcs"], shape_out=img_a.shape)
    badb, _ = reproject_interp((b["bad"].astype(float), b["wcs"]), a["wcs"],
                               shape_out=img_a.shape, order="nearest-neighbor")
    inv_b = ~np.isfinite(rb) | ~np.isfinite(badb) | (badb > 0.5)
    rb = np.where(inv_b, 0.0, rb)
    inv_a = a["bad"]
    diff = img_a - rb
    inv_d = inv_a | inv_b
    sd = 1.4826 * np.median(np.abs(diff[~inv_d] - np.median(diff[~inv_d])))
    va = np.arcsinh(img_a / (3 * sa))
    lo, hi = np.percentile(va[~inv_a], 1), np.percentile(va[~inv_a], 99.7)
    for d in out_dirs:
        os.makedirs(d, exist_ok=True)
        save_gray(os.path.join(d, f"{pid}_A.png"), img_a, inv_a, sa, lo, hi)
        save_gray(os.path.join(d, f"{pid}_B.png"), rb, inv_b, sa, lo, hi)
        save_diff(os.path.join(d, f"{pid}_diff.png"), diff, inv_d, max(sd, 1e-9))

    h, w = img_a.shape
    return {
        "id": pid, "detector": int(a["det"]),
        "wavelength_um": round(a["lam"], 3), "wavelength_b_um": round(b["lam"], 3),
        "file_a": a["name"], "file_b": b["name"],
        "time_a": a["t"].iso[:19], "time_b": b["t"].iso[:19],
        "days_apart": round(abs(b["t"].jd - a["t"].jd), 1),
        "width": int(w), "height": int(h),
        "image_a": f"moving/{pid}_A.png", "image_b": f"moving/{pid}_B.png",
        "image_diff": f"moving/{pid}_diff.png",
        "alignment": {"n_matched": n_match, "offset_ra_arcsec": round(off[0], 2),
                      "offset_dec_arcsec": round(off[1], 2), "rms_arcsec": round(rms, 2)},
        "stationary_tolerance_arcsec": round(stat_tol, 2),
        "default_threshold_arcsec": round(max(PIXEL_ARCSEC, 3.0 * rms), 1),
        "n_sources_a": len(da), "n_sources_b": len(db), "n_stationary": n_stat,
        "links": links}, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tol", type=float, default=0.02)
    ap.add_argument("--min-days", type=float, default=14.0)
    ap.add_argument("--max-pairs", type=int, default=6)
    ap.add_argument("--min-snr", type=float, default=8.0)
    ap.add_argument("--max-link", type=float, default=60.0)
    ap.add_argument("--flux-ratio", type=float, default=2.5)
    args = ap.parse_args()

    files_a = sorted(glob.glob(os.path.join(DIR_A, "*.fits")))
    files_b = sorted(glob.glob(os.path.join(DIR_B, "*.fits")))
    if not files_a or not files_b:
        print("Need epoch A in", DIR_A, "and epoch B in", DIR_B)
        print("Run: python pipeline/get_epoch_b.py")
        return
    print(f"Loading {len(files_a)} epoch-A and {len(files_b)} epoch-B files...")
    A, B = [load(f) for f in files_a], []
    for f in files_b:
        try:
            B.append(load(f))
        except Exception as e:
            print("  skipped", os.path.basename(f), str(e)[:60])

    pairs, n_opt = pick_pairs(A, B, args.tol, args.min_days, args.max_pairs)
    print(f"Pairs with same detector, wavelength within {args.tol * 100:.0f}% and "
          f">= {args.min_days:.0f} days apart: {n_opt} possible, using {len(pairs)}")
    if not pairs:
        print("No pair qualifies. Try:  python -m backend.compute.moving_candidates --tol 0.03")
        print("A:", sorted(set(a["det"] for a in A)), " B:", sorted(set(b["det"] for b in B)))
        return

    out_dirs = [d for d in OUT_DIRS if os.path.isdir(os.path.dirname(d))] or [OUT_DIRS[0]]
    results = []
    for n, (a, b) in enumerate(pairs, 1):
        pid = f"P{n:02d}"
        try:
            res, why = process_pair(a, b, pid, args, out_dirs)
        except Exception as e:
            res, why = None, f"error: {str(e)[:100]}"
        if res is None:
            print(f"{pid}: skipped, {why}")
            continue
        results.append(res)
        thr = res["default_threshold_arcsec"]
        n_c = sum(1 for l in res["links"] if l["motion_arcsec"] >= thr)
        print(f"{pid}: detector {res['detector']}  {res['wavelength_um']:.2f} um  "
              f"{res['days_apart']:.0f} days apart | sources A/B {res['n_sources_a']}/"
              f"{res['n_sources_b']} | stationary {res['n_stationary']} | alignment rms "
              f"{res['alignment']['rms_arcsec']:.2f} arcsec | candidates >= {thr:.1f} arcsec: {n_c}")

    index = {"kind": "real", "release": "QR2 (epoch A), spherex_dr1_deep (epoch B)", "doi": "10.26131/IRSA652 (epoch A)",
             "region": "north-ecliptic-pole",
             "generated_utc": datetime.now(timezone.utc).isoformat(),
             "settings": {"min_days": args.min_days, "wavelength_tolerance": args.tol,
                          "min_snr": args.min_snr, "max_link_arcsec": args.max_link,
                          "flux_ratio_limit": args.flux_ratio, "detection_sigma": 5.0},
             "pairs": results}
    for d in out_dirs:
        with open(os.path.join(d, "index.json"), "w") as f:
            json.dump(index, f, allow_nan=False)
    print(f"\nWrote {len(results)} pairs to: {', '.join(out_dirs)}")


if __name__ == "__main__":
    main()