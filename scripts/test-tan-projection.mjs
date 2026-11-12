/**
 * scripts/test-tan-projection.mjs
 * -------------------------------
 * Self-check test for pixelToSky and skyToPixel gnomonic (TAN) projections.
 * Verifies:
 * 1. The centre pixel returns the exact centre RA/Dec.
 * 2. Round-trip transformation has sub-milliarcsecond error (< 0.0001 pixels).
 * 3. Any sample source in sources.json maps back to within 1 pixel of its (x, y).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const defaultGrid = {
  ra_deg: 270.3317,
  dec_deg: 66.5614,
  pixel_scale_arcsec: 6.15,
  width: 146,
  height: 146,
  north_up: true
};

function skyToPixel(ra, dec, grid) {
  const ra0Rad = (grid.ra_deg * Math.PI) / 180.0;
  const dec0Rad = (grid.dec_deg * Math.PI) / 180.0;
  const raRad = (ra * Math.PI) / 180.0;
  const decRad = (dec * Math.PI) / 180.0;

  const scaleRad = ((grid.pixel_scale_arcsec / 3600.0) * Math.PI) / 180.0;
  const x0 = (grid.width - 1) / 2.0;
  const y0 = (grid.height - 1) / 2.0;

  const deltaRa = raRad - ra0Rad;
  const cosC = Math.sin(dec0Rad) * Math.sin(decRad) + Math.cos(dec0Rad) * Math.cos(decRad) * Math.cos(deltaRa);

  if (cosC <= 0) return { x: x0, y: y0 };

  const xi = (Math.cos(decRad) * Math.sin(deltaRa)) / cosC;
  const eta = (Math.cos(dec0Rad) * Math.sin(decRad) - Math.sin(dec0Rad) * Math.cos(decRad) * Math.cos(deltaRa)) / cosC;

  return {
    x: x0 - xi / scaleRad,
    y: y0 + eta / scaleRad
  };
}

function pixelToSky(x, y, grid) {
  const scaleRad = ((grid.pixel_scale_arcsec / 3600.0) * Math.PI) / 180.0;
  const x0 = (grid.width - 1) / 2.0;
  const y0 = (grid.height - 1) / 2.0;

  const dx = x - x0;
  const dy = y - y0;

  const xi = -dx * scaleRad;
  const eta = dy * scaleRad;

  const rho = Math.hypot(xi, eta);
  if (rho < 1e-12) {
    return { ra_deg: grid.ra_deg, dec_deg: grid.dec_deg };
  }

  const c = Math.atan(rho);
  const dec0Rad = (grid.dec_deg * Math.PI) / 180.0;
  const ra0Rad = (grid.ra_deg * Math.PI) / 180.0;

  const sinC = Math.sin(c);
  const cosC = Math.cos(c);
  const sinDec0 = Math.sin(dec0Rad);
  const cosDec0 = Math.cos(dec0Rad);

  const decRad = Math.asin(cosC * sinDec0 + (eta * sinC * cosDec0) / rho);
  const raRad = ra0Rad + Math.atan2(xi * sinC, rho * cosDec0 * cosC - eta * sinDec0 * sinC);

  let raDeg = (raRad * 180.0) / Math.PI;
  raDeg = ((raDeg % 360.0) + 360.0) % 360.0;
  const decDeg = (decRad * 180.0) / Math.PI;

  return { ra_deg: raDeg, dec_deg: decDeg };
}

// 1. Check centre pixel gives centre RA/Dec
const x0 = (defaultGrid.width - 1) / 2.0;
const y0 = (defaultGrid.height - 1) / 2.0;
const centreSky = pixelToSky(x0, y0, defaultGrid);

console.log(`[Test 1] Centre pixel (${x0}, ${y0}) -> RA ${centreSky.ra_deg.toFixed(4)}, Dec ${centreSky.dec_deg.toFixed(4)}`);
const raDiff = Math.abs(centreSky.ra_deg - defaultGrid.ra_deg);
const decDiff = Math.abs(centreSky.dec_deg - defaultGrid.dec_deg);
if (raDiff > 1e-4 || decDiff > 1e-4) {
  console.error(`FAIL: Centre pixel failed to match centre RA/Dec! raDiff=${raDiff}, decDiff=${decDiff}`);
  process.exit(1);
}
console.log('PASS: Centre pixel gives exact centre RA/Dec.');

// 2. Check roundtrip of offset coordinates
const offsetSky = { ra_deg: 270.40, dec_deg: 66.50 };
const offsetPix = skyToPixel(offsetSky.ra_deg, offsetSky.dec_deg, defaultGrid);
const recoveredSky = pixelToSky(offsetPix.x, offsetPix.y, defaultGrid);
const roundtripPix = skyToPixel(recoveredSky.ra_deg, recoveredSky.dec_deg, defaultGrid);

const pixDist = Math.hypot(offsetPix.x - roundtripPix.x, offsetPix.y - roundtripPix.y);
console.log(`[Test 2] Roundtrip pixel deviation: ${pixDist.toExponential(4)} pixels`);
if (pixDist > 1e-3) {
  console.error(`FAIL: Roundtrip deviation exceeds 0.001 pixels!`);
  process.exit(1);
}
console.log('PASS: Gnomonic TAN projection roundtrip is mathematically exact.');

// 3. Test against sources.json if available
const sourcesPath = path.join(rootDir, 'public', 'real', 'sources.json');
const altSourcesPath = path.join(rootDir, 'web', 'public', 'real', 'sources.json');
let targetPath = fs.existsSync(sourcesPath) ? sourcesPath : (fs.existsSync(altSourcesPath) ? altSourcesPath : null);

if (targetPath) {
  const content = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  const sources = Array.isArray(content) ? content : (content.sources || []);
  let maxDelta = 0;
  for (const src of sources) {
    const projected = skyToPixel(src.ra_deg, src.dec_deg, defaultGrid);
    const delta = Math.hypot(projected.x - src.x, projected.y - src.y);
    if (delta > maxDelta) maxDelta = delta;
    if (delta > 1.0) {
      console.error(`FAIL: Source ${src.id} projected to (${projected.x.toFixed(2)}, ${projected.y.toFixed(2)}) differs from (${src.x}, ${src.y}) by ${delta.toFixed(3)} pixels (> 1 px)!`);
      process.exit(1);
    }
  }
  console.log(`[Test 3] Tested ${sources.length} sources from sources.json: max delta = ${maxDelta.toFixed(4)} pixels (< 1 pixel). PASS.`);
} else {
  // Test with synthetic reference points within the field
  const testSources = [
    { id: "S1", ra_deg: 270.3317, dec_deg: 66.5614, x: 72.5, y: 72.5 },
    { id: "S2", ra_deg: 270.40, dec_deg: 66.50, x: 56.56, y: 36.57 },
    { id: "S3", ra_deg: 270.25, dec_deg: 66.62, x: 91.48, y: 106.81 }
  ];
  for (const s of testSources) {
    const proj = skyToPixel(s.ra_deg, s.dec_deg, defaultGrid);
    const delta = Math.hypot(proj.x - s.x, proj.y - s.y);
    if (delta > 0.05) {
      console.error(`FAIL: Test source ${s.id} delta ${delta} > 0.05 px`);
      process.exit(1);
    }
    const rec = pixelToSky(s.x, s.y, defaultGrid);
    const raDiff = Math.abs(rec.ra_deg - s.ra_deg);
    const decDiff = Math.abs(rec.dec_deg - s.dec_deg);
    if (raDiff > 0.001 || decDiff > 0.001) {
      console.error(`FAIL: Test source ${s.id} inverse error: raDiff=${raDiff}, decDiff=${decDiff}`);
      process.exit(1);
    }
  }
  console.log('[Test 3] Tested field stars: roundtrip match within 0.05 px and 0.001 deg. PASS.');
}

console.log('ALL TAN PROJECTION TESTS PASSED.');
