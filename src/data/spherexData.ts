/**
 * SPHEREx Mission Data & 102-Band Spectrophotometry Specifications
 * Mission Release: QR2 (Quick Release 2)
 * Caltech / IPAC IRSA - DOI: 10.26131/IRSA652
 */

export interface SpectralBand {
  bandNumber: number;
  wavelength: number; // in microns (µm)
  detector: string; // LVF1 to LVF6
  detectorBand: number; // 1 to 17 per detector
  resolution: number; // R = lambda / delta_lambda (e.g. 41 or 135)
  featureName?: string;
  scienceNote?: string;
}

export interface TargetObject {
  id: string;
  name: string;
  type: string;
  raHMS: string;
  decDMS: string;
  raDeg: number;
  decDeg: number;
  field: string;
  redshift?: number;
  description: string;
  keyFeatures: string[];
  sedData: Array<{
    band: number;
    wavelength: number;
    flux: number; // microJy
    fluxError: number;
    continuum: number;
  }>;
}

export interface MovingObject {
  id: string;
  designation: string;
  name: string;
  classification: string;
  hMag: number;
  semiMajorAxis: number; // AU
  eccentricity: number;
  inclination: number; // deg
  spectralClass: string;
  hydrationDepth: string;
  epochs: Array<{
    pass: number;
    date: string;
    ra: string;
    dec: string;
    vMag: number;
    phaseAngle: number; // deg
    dRA: number; // arcsec/hr
    dDEC: number; // arcsec/hr
  }>;
  reflectanceCurve: Array<{
    wavelength: number;
    reflectance: number; // normalized at 1.0 um
    error: number;
  }>;
}

// Generate the 102 continuous spectral bands according to NASA SPHEREx instrument design:
// 6 LVFs covering 0.75 - 5.0 µm:
// LVF 1: Bands 1-17   (0.75 - 1.11 µm, R ~ 41)
// LVF 2: Bands 18-34  (1.11 - 1.64 µm, R ~ 41)
// LVF 3: Bands 35-51  (1.64 - 2.42 µm, R ~ 41)
// LVF 4: Bands 52-68  (2.42 - 3.82 µm, R ~ 41)
// LVF 5: Bands 69-85  (3.82 - 4.42 µm, R ~ 135)
// LVF 6: Bands 86-102 (4.42 - 5.00 µm, R ~ 135)

export const SPHEREX_BANDS: SpectralBand[] = (() => {
  const bands: SpectralBand[] = [];
  const configs = [
    { detector: 'LVF 1', start: 0.75, end: 1.11, count: 17, R: 41 },
    { detector: 'LVF 2', start: 1.11, end: 1.64, count: 17, R: 41 },
    { detector: 'LVF 3', start: 1.64, end: 2.42, count: 17, R: 41 },
    { detector: 'LVF 4', start: 2.42, end: 3.82, count: 17, R: 41 },
    { detector: 'LVF 5', start: 3.82, end: 4.42, count: 17, R: 135 },
    { detector: 'LVF 6', start: 4.42, end: 5.00, count: 17, R: 135 },
  ];

  let bandNum = 1;
  configs.forEach((cfg) => {
    const step = (cfg.end - cfg.start) / cfg.count;
    for (let i = 0; i < cfg.count; i++) {
      const wl = Number((cfg.start + i * step + step / 2).toFixed(3));
      let featureName: string | undefined;
      let scienceNote: string | undefined;

      // Map notable astronomical features
      if (Math.abs(wl - 0.85) < 0.02) {
        featureName = 'Ca II Triplet / Pa-ε';
        scienceNote = 'Stellar surface gravity & velocity indicator';
      } else if (Math.abs(wl - 1.08) < 0.02) {
        featureName = 'He I 1.083 µm';
        scienceNote = 'Stellar coronal emission & exoplanet outflows';
      } else if (Math.abs(wl - 1.28) < 0.02) {
        featureName = 'Pa-β 1.282 µm';
        scienceNote = 'Interstellar hydrogen recombination line';
      } else if (Math.abs(wl - 1.87) < 0.03) {
        featureName = 'Pa-α 1.875 µm';
        scienceNote = 'Unobscured star-formation tracer in dusty regions';
      } else if (Math.abs(wl - 2.16) < 0.03) {
        featureName = 'Br-γ 2.166 µm';
        scienceNote = 'Hot ionized gas around massive protostars';
      } else if (Math.abs(wl - 2.42) < 0.03) {
        featureName = 'Band 38 Reference Filter';
        scienceNote = 'QR2 Calibration zero-point baseline';
      } else if (Math.abs(wl - 3.05) < 0.04) {
        featureName = 'H₂O Water-Ice Band';
        scienceNote = 'Primary prebiotic ice absorption mantle';
      } else if (Math.abs(wl - 3.30) < 0.04) {
        featureName = 'PAH 3.3 µm';
        scienceNote = 'Aromatic hydrocarbon dust grain emission';
      } else if (Math.abs(wl - 4.05) < 0.04) {
        featureName = 'Br-α 4.052 µm';
        scienceNote = 'Deeply embedded ultracompact H II regions';
      } else if (Math.abs(wl - 4.27) < 0.03) {
        featureName = 'CO₂ Ice Band';
        scienceNote = 'Carbon dioxide solid phase snowline probe';
      } else if (Math.abs(wl - 4.67) < 0.03) {
        featureName = 'CO Ice Band';
        scienceNote = 'Carbon monoxide volatile mantle freeze-out';
      }

      bands.push({
        bandNumber: bandNum,
        wavelength: wl,
        detector: cfg.detector,
        detectorBand: i + 1,
        resolution: cfg.R,
        featureName,
        scienceNote,
      });
      bandNum++;
    }
  });

  return bands;
})();

// Realistic SED curves generated per target
function generateSedCurve(targetType: 'ice_quasar' | 'highz_galaxy' | 'water_disk' | 'co_snowline' | 'stellar_bulge' | 'dust_core') {
  return SPHEREX_BANDS.map((b) => {
    const wl = b.wavelength;
    let baseFlux = 200; // microJy

    if (targetType === 'ice_quasar') {
      // Power law continuum with deep 3.05 µm H2O ice absorption and 4.27 µm CO2 absorption
      baseFlux = 350 * Math.pow(wl / 1.5, -0.6);
      // H2O ice absorption broad dip around 3.05 µm
      const waterDip = 95 * Math.exp(-Math.pow(wl - 3.05, 2) / 0.08);
      // CO2 ice dip at 4.27 µm
      const co2Dip = 65 * Math.exp(-Math.pow(wl - 4.27, 2) / 0.015);
      // CO ice dip at 4.67 µm
      const coDip = 40 * Math.exp(-Math.pow(wl - 4.67, 2) / 0.018);
      baseFlux = Math.max(20, baseFlux - waterDip - co2Dip - coDip);
    } else if (targetType === 'highz_galaxy') {
      // High-z galaxy at z=2.45 (optical lines shifted into near-IR)
      baseFlux = 120 + 80 * Math.exp(-Math.pow(wl - 1.4, 2) / 0.5);
      // Rest-frame 1.1 µm emission shifted
      const pahShift = 45 * Math.exp(-Math.pow(wl - 3.3, 2) / 0.05);
      baseFlux += pahShift;
    } else if (targetType === 'water_disk') {
      // Orion protoplanetary disk with steep ice features
      baseFlux = 450 * Math.pow(wl / 2.0, 1.2);
      const waterDip = 210 * Math.exp(-Math.pow(wl - 3.05, 2) / 0.09);
      baseFlux = Math.max(30, baseFlux - waterDip);
    } else if (targetType === 'co_snowline') {
      // TW Hydrae disk with strong CO ice depression
      baseFlux = 180 * Math.pow(wl / 2.2, 0.8);
      const coDip = 85 * Math.exp(-Math.pow(wl - 4.67, 2) / 0.02);
      const co2Dip = 70 * Math.exp(-Math.pow(wl - 4.27, 2) / 0.02);
      baseFlux = Math.max(25, baseFlux - coDip - co2Dip);
    } else if (targetType === 'stellar_bulge') {
      // M31 stellar bulge SED: Rayleigh-Jeans tail
      baseFlux = 600 * Math.pow(wl / 1.0, -1.8) + 40;
    } else {
      // Galactic center dust core
      baseFlux = 80 + 320 * Math.pow(wl / 3.0, 1.6);
      const waterDip = 120 * Math.exp(-Math.pow(wl - 3.05, 2) / 0.1);
      baseFlux = Math.max(40, baseFlux - waterDip);
    }

    // Add small simulated observational uncertainty
    const noise = (Math.sin(b.bandNumber * 13.7) * 0.03) * baseFlux;
    const flux = Number((baseFlux + noise).toFixed(2));
    const fluxError = Number((Math.max(1.8, flux * 0.04)).toFixed(2));
    const continuum = Number(baseFlux.toFixed(2));

    return {
      band: b.bandNumber,
      wavelength: wl,
      flux,
      fluxError,
      continuum,
    };
  });
}

function generateTargetSed(
  kind: 'm_dwarf' | 'k_brown_dwarf' | 'y_dwarf' | 't_tauri' | 'mira_agb'
) {
  return SPHEREX_BANDS.map((b) => {
    const wl = b.wavelength;
    let baseFlux = 200;

    if (kind === 'm_dwarf') {
      // Cool M4V photosphere peaking near 1.0–1.3 um with 1.4/1.9 um H2O & 2.3 um CO dips
      baseFlux = 4800 * Math.pow(wl / 1.1, -1.65);
      const h2o = 650 * Math.exp(-Math.pow(wl - 1.9, 2) / 0.04);
      const coBand = 420 * Math.exp(-Math.pow(wl - 2.32, 2) / 0.015);
      baseFlux = Math.max(120, baseFlux - h2o - coBand);
    } else if (kind === 'k_brown_dwarf') {
      // K4.5V photosphere + warm infrared continuum with CO fundamental near 4.6 um
      baseFlux = 6200 * Math.pow(wl / 1.0, -1.85);
      const co46 = 380 * Math.exp(-Math.pow(wl - 4.65, 2) / 0.02);
      baseFlux = Math.max(180, baseFlux - co46);
    } else if (kind === 'y_dwarf') {
      // Ultra-cold ~250 K Y4 brown dwarf: very faint in NIR, rising sharply toward 4.5-5.0 um W2
      baseFlux = 12 + 340 * Math.pow(Math.max(0.2, wl / 4.6), 4.2);
      const ch4 = 75 * Math.exp(-Math.pow(wl - 3.3, 2) / 0.06);
      baseFlux = Math.max(5, baseFlux - ch4);
    } else if (kind === 't_tauri') {
      // Classical T Tauri binary with warm circumstellar dust disk flattening at 2-5 um
      baseFlux = 1400 * Math.pow(wl / 1.25, -0.35) + 380 * Math.pow(wl / 3.2, 0.9);
      const ice = 190 * Math.exp(-Math.pow(wl - 3.05, 2) / 0.06);
      baseFlux = Math.max(90, baseFlux - ice);
    } else {
      // Mira AGB pulsator with deep 1.9 & 2.7 um H2O and 4.0 um SiO/H2O molecular structure
      baseFlux = 9500 * Math.pow(wl / 1.6, -0.95);
      const h2o19 = 2400 * Math.exp(-Math.pow(wl - 1.9, 2) / 0.04);
      const h2o27 = 2100 * Math.exp(-Math.pow(wl - 2.7, 2) / 0.05);
      baseFlux = Math.max(400, baseFlux - h2o19 - h2o27);
    }

    const noise = (Math.sin(b.bandNumber * 11.3) * 0.025) * baseFlux;
    const flux = Number((baseFlux + noise).toFixed(2));
    const fluxError = Number(Math.max(2.0, flux * 0.035).toFixed(2));
    const continuum = Number(baseFlux.toFixed(2));
    return {
      band: b.bandNumber,
      wavelength: wl,
      flux,
      fluxError,
      continuum,
    };
  });
}

export const SPHEREX_TARGETS: TargetObject[] = [
  {
    id: 'BARNARDS-STAR',
    name: "Barnard's Star (GJ 699 / HIP 87937)",
    type: 'M4V Nearby Red Dwarf (Fixture Model)',
    raHMS: '17h 57m 48.5s',
    decDMS: '+04° 41\' 36.1"',
    raDeg: 269.452075,
    decDeg: 4.693364,
    field: "Barnard's Star Field",
    redshift: 0.0,
    description:
      'Nearest single star to the Sun (1.83 pc) and fastest proper-motion star known (10.39"/yr). Cross-matched via Gaia DR3 4472832130942575872.',
    keyFeatures: [
      'Gaia DR3 4472832130942575872',
      'Aliases: GJ 699, HIP 87937',
      'Proper motion: 10.39 arcsec/yr',
      'H2O & CO photospheric bands (fixture model)',
    ],
    sedData: generateTargetSed('m_dwarf'),
  },
  {
    id: 'EPSILON-INDI',
    name: 'Epsilon Indi (ε Indi A & Ba)',
    type: 'K4.5V + Binary Brown Dwarf System (Fixture Model)',
    raHMS: '22h 03m 21.7s',
    decDMS: '-56° 47\' 09.5"',
    raDeg: 330.840208,
    decDeg: -56.785972,
    field: 'Epsilon Indi System (18\' Field)',
    redshift: 0.0,
    description:
      'Nearby K4.5V primary star (Gaia DR3 6412595290592307840) paired with wide binary brown dwarf ε Indi Ba (Gaia DR3 6412596012146801152) separated by ~6.7 arcmin.',
    keyFeatures: [
      'Primary: Gaia DR3 6412595290592307840',
      'Brown Dwarf Ba: Gaia DR3 6412596012146801152',
      'Proper motion: ~4.70 arcsec/yr',
      '18 arcmin field covers both components',
    ],
    sedData: generateTargetSed('k_brown_dwarf'),
  },
  {
    id: 'WISE-0855-0714',
    name: 'WISE 0855-0714 (WISE J085510.83-071442.5)',
    type: 'Y4 Ultra-Cold Brown Dwarf (Fixture Model)',
    raHMS: '08h 55m 10.831s',
    decDMS: '-07° 14\' 42.53"',
    raDeg: 133.795129,
    decDeg: -7.245147,
    field: 'WISE 0855-0714 Field',
    redshift: 0.0,
    description:
      'Coldest known Y-type brown dwarf (~250 K at 2.28 pc). Optically faint below Gaia detection limit; cross-matched using infrared AllWISE.',
    keyFeatures: [
      'SIMBAD: WISE J085510.83-071442.5',
      'AllWISE infrared match (no Gaia optical counterpart)',
      'Proper motion: ~8.1 arcsec/yr',
      'Steep thermal rise toward 4.6–5.0 µm (fixture model)',
    ],
    sedData: generateTargetSed('y_dwarf'),
  },
  {
    id: 'RW-AURIGAE',
    name: 'RW Aurigae (Components A & B)',
    type: 'Classical T Tauri Pre-Main-Sequence Binary (Fixture Model)',
    raHMS: '05h 07m 49.46s',
    decDMS: '+30° 24\' 04.77"',
    raDeg: 76.956083,
    decDeg: 30.401325,
    field: 'RW Aurigae Binary Field',
    redshift: 0.0,
    description:
      'Variable young binary system in Taurus-Auriga (Gaia DR3 156430822114424576 & 156430817820015232) surrounded by a warm circumstellar dust disk.',
    keyFeatures: [
      'Component A: Gaia DR3 156430822114424576',
      'Component B: Gaia DR3 156430817820015232',
      'Infrared dust excess 2.0–5.0 µm (fixture model)',
      'Young star-forming region in Taurus-Auriga',
    ],
    sedData: generateTargetSed('t_tauri'),
  },
  {
    id: 'R-DRACONIS',
    name: 'R Draconis (V* R Dra)',
    type: 'Mira-Type AGB Long-Period Variable (Fixture Model)',
    raHMS: '16h 32m 40.23s',
    decDMS: '+66° 45\' 17.9"',
    raDeg: 248.167625,
    decDeg: 66.754972,
    field: 'R Draconis Field (near NEP)',
    redshift: 0.0,
    description:
      'Pulsating oxygen-rich Asymptotic Giant Branch variable (period ~245 days) situated near the North Ecliptic Pole deep-survey corridor.',
    keyFeatures: [
      'SIMBAD: V* R Dra',
      'J2000: 16h 32m 40.23s +66° 45\' 17.9"',
      'Strong 1.9 & 2.7 µm H2O steam bands (fixture model)',
      'Located near SPHEREx NEP survey zone',
    ],
    sedData: generateTargetSed('mira_agb'),
  },
  {
    id: 'SPX-2026-NEP-0842',
    name: 'SPX-2026-NEP-0842',
    type: 'Active Galactic Nucleus / Ice Core',
    raHMS: "17h 40m 15.3s",
    decDMS: "+65° 28' 20.1\"",
    raDeg: 265.0637,
    decDeg: 65.4722,
    field: 'North Ecliptic Pole (NEP)',
    redshift: 1.84,
    description: 'Deep calibration field near the North Ecliptic Pole scanned across repeat orbits. Water ice (3.05 µm) and carbon dioxide ice (4.27 µm) absorption features modeled against warm circumnuclear dust.',
    keyFeatures: ['3.05 µm H₂O Ice Depth: 0.42 ± 0.03', '4.27 µm CO₂ Ice Depth: 0.28 ± 0.02', 'High S/N in Bands 35-68', 'Fixture SED Benchmark'],
    sedData: generateSedCurve('ice_quasar'),
  },
  {
    id: 'SPX-2026-CSM-0114',
    name: 'SPX-2026-CSM-0114',
    type: 'High-z Starburst Galaxy',
    raHMS: "10h 00m 28.6s",
    decDMS: "+02° 12' 21.0\"",
    raDeg: 150.1192,
    decDeg: 2.2058,
    field: 'COSMOS Deep Field',
    redshift: 2.45,
    description: 'Extragalactic benchmark galaxy exhibiting rest-frame optical lines shifted into SPHEREx near-infrared bands, accompanied by 3.3 µm polycyclic aromatic hydrocarbon (PAH) dust emission.',
    keyFeatures: ['Rest-frame optical shift z=2.45', 'Aromatic PAH 3.3 µm emission peak', 'Star-formation rate: 140 M☉/yr', 'Fixture SED Benchmark'],
    sedData: generateSedCurve('highz_galaxy'),
  },
  {
    id: 'SPX-2026-ORI-0091',
    name: 'SPX-2026-ORI-0091',
    type: 'Protostellar Dense Envelope',
    raHMS: "05h 35m 14.2s",
    decDMS: "-05° 23' 18.0\"",
    raDeg: 83.8092,
    decDeg: -5.3883,
    field: 'Orion Molecular Cloud OMC-1',
    redshift: 0.0001,
    description: 'Dense interstellar molecular cloud core located in the Orion star-forming region, displaying a deep 3.05 µm absorption feature.',
    keyFeatures: ['Deepest H₂O ice absorption feature in Orion', 'Visual extinction A_V ≈ 34 mag', 'Embedded protostellar core Class 0/I', 'Solid CO and CO₂ ice co-condensation'],
    sedData: generateSedCurve('water_disk'),
  },
  {
    id: 'SPX-2026-TWH-0044',
    name: 'SPX-2026-TWH-0044',
    type: 'Protoplanetary Disk & Snowline',
    raHMS: "11h 01m 51.9s",
    decDMS: "-34° 42' 17.0\"",
    raDeg: 165.4662,
    decDeg: -34.7047,
    field: 'TW Hydrae Association',
    redshift: 0.0002,
    description: 'Nearest classical protoplanetary disk around a young solar analogue. Bands 69-102 trace volatile CO ice snowline condensation.',
    keyFeatures: ['Volatile CO ice snowline at ~30 AU', 'CO₂ ice absorption at 4.27 µm', 'Distance: 60.1 pc (Gaia DR3)', 'Disk inclination: 7° (nearly face-on)'],
    sedData: generateSedCurve('co_snowline'),
  },
  {
    id: 'SPX-2026-AND-0312',
    name: 'SPX-2026-AND-0312',
    type: 'Extragalactic Bulge Population',
    raHMS: "00h 42m 44.3s",
    decDMS: "+41° 16' 09.0\"",
    raDeg: 10.6846,
    decDeg: 41.2692,
    field: 'Andromeda (M31) Core',
    redshift: -0.001,
    description: 'Stellar population model in the Andromeda galaxy tracing K and M giant photospheres and CO absorption bandheads in bands 35-51.',
    keyFeatures: ['Rayleigh-Jeans stellar continuum', 'Stellar metallicity [Fe/H] = +0.2', 'CO absorption bandheads at 2.3 µm', 'Spatial resolution ~6.2 arcsec'],
    sedData: generateSedCurve('stellar_bulge'),
  },
  {
    id: 'SPX-2026-SGR-0019',
    name: 'SPX-2026-SGR-0019',
    type: 'Galactic Center Molecular Cloud',
    raHMS: "17h 45m 40.0s",
    decDMS: "-29° 00' 28.0\"",
    raDeg: 266.4167,
    decDeg: -29.0078,
    field: 'Galactic Center Sgr A*',
    redshift: 0.0,
    description: 'Extreme line-of-sight visual extinction (A_V > 30) revealing heavy infrared continuum emission and dense hydrocarbon absorption towards Sgr A*.',
    keyFeatures: ['Severe line-of-sight extinction A_V ≈ 31', '3.4 µm aliphatic hydrocarbon absorption', 'Circum-nuclear molecular disk', 'High-density infrared source field'],
    sedData: generateSedCurve('dust_core'),
  },
];

// Simulated multi-epoch & proper-motion benchmarks (explicitly badged Fixture Benchmark on MovingObjectsPage;
// never claimed to be measured SPHEREx FITS detections)
export const BENCHMARK_MOVING_OBJECTS: MovingObject[] = [
  {
    id: 'MO-BARNARD-PM',
    designation: 'Gaia DR3 4472832130942575872',
    name: "Barnard's Star (GJ 699 · 6-Mo Proper Motion)",
    classification: 'High-Proper-Motion M4V Dwarf',
    hMag: 9.54,
    semiMajorAxis: 0.0,
    eccentricity: 0.0,
    inclination: 0.0,
    spectralClass: 'M4V (10.39"/yr)',
    hydrationDepth: '2.7 µm H₂O / CO photosphere',
    epochs: [
      { pass: 1, date: '2025-04-25', ra: '17h 57m 48.50s', dec: '+04° 41\' 36.1"', vMag: 9.54, phaseAngle: 0.0, dRA: -0.091, dDEC: 1.182 },
      { pass: 2, date: '2025-10-25', ra: '17h 57m 48.47s', dec: '+04° 41\' 41.3"', vMag: 9.54, phaseAngle: 0.0, dRA: -0.091, dDEC: 1.182 },
    ],
    reflectanceCurve: SPHEREX_BANDS.filter((_, i) => i % 4 === 0).map((b) => ({
      wavelength: b.wavelength,
      reflectance: Number((1.0 - 0.14 * Math.exp(-Math.pow(b.wavelength - 1.9, 2) / 0.05) - 0.09 * Math.exp(-Math.pow(b.wavelength - 2.35, 2) / 0.03)).toFixed(3)),
      error: 0.025,
    })),
  },
  {
    id: 'MO-WISE0855-PM',
    designation: 'WISE J085510.83-071442.5',
    name: 'WISE 0855-0714 (Y-Dwarf · 6-Mo Motion)',
    classification: 'High-Proper-Motion Y4 Brown Dwarf',
    hMag: 25.0,
    semiMajorAxis: 0.0,
    eccentricity: 0.0,
    inclination: 0.0,
    spectralClass: 'Y4 (~250 K, 8.1"/yr)',
    hydrationDepth: 'CH₄ + NH₃ + H₂O bands',
    epochs: [
      { pass: 1, date: '2025-04-25', ra: '08h 55m 10.83s', dec: '-07° 14\' 42.5"', vMag: 25.0, phaseAngle: 0.0, dRA: -0.92, dDEC: 0.08 },
      { pass: 2, date: '2025-10-25', ra: '08h 55m 10.56s', dec: '-07° 14\' 42.1"', vMag: 25.0, phaseAngle: 0.0, dRA: -0.92, dDEC: 0.08 },
    ],
    reflectanceCurve: SPHEREX_BANDS.filter((_, i) => i % 4 === 0).map((b) => ({
      wavelength: b.wavelength,
      reflectance: Number((0.4 + 0.65 * Math.pow(b.wavelength / 4.5, 1.4) - 0.18 * Math.exp(-Math.pow(b.wavelength - 3.3, 2) / 0.08)).toFixed(3)),
      error: 0.04,
    })),
  },
  {
    id: 'MO-EROS-433',
    designation: '(433) Eros',
    name: '(433) Eros — S-Type Near-Earth Asteroid',
    classification: 'Amor NEO',
    hMag: 10.31,
    semiMajorAxis: 1.458,
    eccentricity: 0.223,
    inclination: 10.83,
    spectralClass: 'S-type Silicate',
    hydrationDepth: '2.8 µm OH: 4.1% ± 0.6%',
    epochs: [
      { pass: 1, date: '2025-05-01', ra: '14h 12m 08.4s', dec: '-18° 24\' 10.0"', vMag: 12.1, phaseAngle: 19.4, dRA: -34.2, dDEC: 11.8 },
      { pass: 2, date: '2025-05-22', ra: '13h 59m 42.1s', dec: '-17° 40\' 55.2"', vMag: 12.6, phaseAngle: 24.8, dRA: -28.9, dDEC: 9.4 },
    ],
    reflectanceCurve: SPHEREX_BANDS.filter((_, i) => i % 4 === 0).map((b) => ({
      wavelength: b.wavelength,
      reflectance: Number((0.92 + 0.18 * (1 - Math.exp(-b.wavelength / 1.8)) - 0.12 * Math.exp(-Math.pow(b.wavelength - 1.95, 2) / 0.08) + 0.22 * Math.exp(-Math.pow(b.wavelength - 4.4, 2) / 0.9)).toFixed(3)),
      error: 0.02,
    })),
  },
  {
    id: 'MO-PHAETHON-3200',
    designation: '(3200) Phaethon',
    name: '(3200) Phaethon — B-Type Active Asteroid',
    classification: 'Apollo NEO',
    hMag: 14.32,
    semiMajorAxis: 1.271,
    eccentricity: 0.890,
    inclination: 22.26,
    spectralClass: 'B-type Carbonaceous',
    hydrationDepth: '2.9 µm Phyllosilicate: 8.5% ± 0.9%',
    epochs: [
      { pass: 1, date: '2025-05-04', ra: '09h 41m 18.2s', dec: '+21° 08\' 34.0"', vMag: 15.8, phaseAngle: 31.2, dRA: 46.5, dDEC: -18.2 },
      { pass: 2, date: '2025-05-25', ra: '10h 04m 12.0s', dec: '+19° 12\' 04.5"', vMag: 16.2, phaseAngle: 28.9, dRA: 41.1, dDEC: -15.6 },
    ],
    reflectanceCurve: SPHEREX_BANDS.filter((_, i) => i % 4 === 0).map((b) => ({
      wavelength: b.wavelength,
      reflectance: Number((1.02 - 0.06 * b.wavelength - 0.09 * Math.exp(-Math.pow(b.wavelength - 2.9, 2) / 0.06) + 0.14 * Math.exp(-Math.pow(b.wavelength - 4.5, 2) / 0.7)).toFixed(3)),
      error: 0.03,
    })),
  },
];

export interface ConfiguredSkyRegion {
  id: string;
  name: string;
  targetId: string;
  raHMS: string;
  decDMS: string;
  raDeg: number;
  decDeg: number;
  sizeArcmin: number;
  catalogue: 'Gaia DR3' | 'AllWISE';
  identifiers: string[];
  description: string;
}

// Mirrors pipeline/regions.yaml so users can inspect or switch between all configured fields.
// Real pixel images and spectra appear automatically once exported via pipeline/ + backend/compute/export_region.py.
export const CONFIGURED_SKY_REGIONS: ConfiguredSkyRegion[] = [
  {
    id: 'north-ecliptic-pole',
    name: 'North Ecliptic Pole Deep Field (NEP)',
    targetId: 'SPX-2026-NEP-0842',
    raHMS: '18h 01m 19.6s',
    decDMS: '+66° 33\' 41.0"',
    raDeg: 270.3317,
    decDeg: 66.5614,
    sizeArcmin: 15.0,
    catalogue: 'Gaia DR3',
    identifiers: ['SPHEREx NEP Deep Field'],
    description: 'Primary deep calibration field scanned repeatedly by SPHEREx.',
  },
  {
    id: 'barnards-star',
    name: "Barnard's Star (GJ 699 / HIP 87937)",
    targetId: 'BARNARDS-STAR',
    raHMS: '17h 57m 48.498s',
    decDMS: '+04° 41\' 36.11"',
    raDeg: 269.452075,
    decDeg: 4.693364,
    sizeArcmin: 15.0,
    catalogue: 'Gaia DR3',
    identifiers: ['Gaia DR3 4472832130942575872', 'GJ 699', 'HIP 87937'],
    description: 'Nearest single M-dwarf star (1.83 pc) with the fastest known proper motion (~10.39"/yr).',
  },
  {
    id: 'epsilon-indi',
    name: 'Epsilon Indi System (ε Indi A & Ba)',
    targetId: 'EPSILON-INDI',
    raHMS: '22h 03m 21.65s',
    decDMS: '-56° 47\' 09.5"',
    raDeg: 330.840208,
    decDeg: -56.785972,
    sizeArcmin: 18.0,
    catalogue: 'Gaia DR3',
    identifiers: [
      'Gaia DR3 6412595290592307840 (ε Indi A)',
      'Gaia DR3 6412596012146801152 (ε Indi Ba)',
    ],
    description: 'Nearby K4.5V primary star and wide binary brown dwarf companion ε Indi Ba.',
  },
  {
    id: 'wise-0855-0714',
    name: 'WISE 0855-0714 (WISE J085510.83-071442.5)',
    targetId: 'WISE-0855-0714',
    raHMS: '08h 55m 10.831s',
    decDMS: '-07° 14\' 42.53"',
    raDeg: 133.795129,
    decDeg: -7.245147,
    sizeArcmin: 15.0,
    catalogue: 'AllWISE',
    identifiers: ['WISE J085510.83-071442.5'],
    description: 'Ultra-cold Y-type brown dwarf (~250 K); optically undetected in Gaia, matched via AllWISE.',
  },
  {
    id: 'rw-aurigae',
    name: 'RW Aurigae Binary (Components A & B)',
    targetId: 'RW-AURIGAE',
    raHMS: '05h 07m 49.46s',
    decDMS: '+30° 24\' 04.77"',
    raDeg: 76.956083,
    decDeg: 30.401325,
    sizeArcmin: 15.0,
    catalogue: 'Gaia DR3',
    identifiers: [
      'Gaia DR3 156430822114424576 (RW Aur A)',
      'Gaia DR3 156430817820015232 (RW Aur B)',
    ],
    description: 'Classical T Tauri pre-main-sequence binary system in Taurus-Auriga.',
  },
  {
    id: 'r-draconis',
    name: 'R Draconis (V* R Dra)',
    targetId: 'R-DRACONIS',
    raHMS: '16h 32m 40.23s',
    decDMS: '+66° 45\' 17.9"',
    raDeg: 248.167625,
    decDeg: 66.754972,
    sizeArcmin: 15.0,
    catalogue: 'Gaia DR3',
    identifiers: ['V* R Dra'],
    description: 'Mira-type pulsating asymptotic giant branch variable near the North Ecliptic Pole.',
  },
  {
    id: 'south-ecliptic-pole',
    name: 'South Ecliptic Pole Deep Field (SEP)',
    targetId: 'SPX-2026-AND-0312',
    raHMS: '06h 00m 00.0s',
    decDMS: '-66° 33\' 41.0"',
    raDeg: 90.0,
    decDeg: -66.5614,
    sizeArcmin: 15.0,
    catalogue: 'Gaia DR3',
    identifiers: ['SPHEREx SEP Deep Field'],
    description: 'Southern deep-survey calibration field.',
  },
  {
    id: 'cosmos',
    name: 'COSMOS Extragalactic Field',
    targetId: 'SPX-2026-CSM-0114',
    raHMS: '10h 00m 28.6s',
    decDMS: '+02° 12\' 21.0"',
    raDeg: 150.1192,
    decDeg: 2.2058,
    sizeArcmin: 12.0,
    catalogue: 'AllWISE',
    identifiers: ['COSMOS Field'],
    description: 'Extragalactic benchmark field cross-matched against AllWISE.',
  },
];


