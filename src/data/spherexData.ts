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

export const SPHEREX_TARGETS: TargetObject[] = [
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
    description: 'High-density observation field near the North Ecliptic Pole scanned across 1,840 repeat orbits. Prominent water ice (3.05 µm) and carbon dioxide ice (4.27 µm) absorption features detected against warm circumnuclear dust.',
    keyFeatures: ['3.05 µm H₂O Ice Depth: 0.42 ± 0.03', '4.27 µm CO₂ Ice Depth: 0.28 ± 0.02', 'High S/N in Bands 35-68', 'Repeat Scans: 1,840 epochs'],
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
    description: 'Extragalactic deep benchmark galaxy exhibiting rest-frame optical lines shifted into SPHEREx near-infrared bands, accompanied by intense 3.3 µm polycyclic aromatic hydrocarbon (PAH) dust ring emission.',
    keyFeatures: ['Rest-frame optical shift z=2.45', 'Aromatic PAH 3.3 µm emission peak', 'Star-formation rate: 140 M☉/yr', 'Photometric redshift error σ_z/(1+z) < 0.02'],
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
    description: 'Nearest classical protoplanetary disk around a young solar analogue. High-resolution SPHEREx bands 69-102 reveal volatile CO ice snowline condensation and volatile carbon depletion in the planetary birth zone.',
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
    description: 'Calibrated spectrophotometry of the central stellar population in the Andromeda galaxy. Traces older K and M giant branch photospheres and carbon monoxide absorption bandheads in bands 35-51.',
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
    description: 'Extreme line-of-sight visual extinction (A_V > 30) revealing heavy infrared continuum emission and dense hydrocarbon and ice absorption towards the Milky Way circum-nuclear ring.',
    keyFeatures: ['Severe line-of-sight extinction A_V ≈ 31', '3.4 µm aliphatic hydrocarbon absorption', 'Circum-nuclear molecular disk', 'High-density infrared source field'],
    sedData: generateSedCurve('dust_core'),
  },
];

