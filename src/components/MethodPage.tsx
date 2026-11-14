import React from 'react';
import { RealDataset } from '../data/real.ts';
import { DataSourceChip } from './DataSourceChip.tsx';

interface MethodPageProps {
  dataSource?: 'real' | 'fixture';
  realDataset?: RealDataset | null;
}

/**
 * MethodPage documents the scientific data reduction pipeline,
 * the 6 Linear Variable Filter detector arrays, calibration criteria,
 * and known scientific limitations.
 */
export const MethodPage: React.FC<MethodPageProps> = ({
  dataSource = 'real',
  realDataset,
}) => {
  // Detection metadata from manifest
  const refExposureId = realDataset?.manifest?.detection?.reference_exposure_id || 'E076';
  const refWavelength = realDataset?.manifest?.detection?.wavelength_um || 3.049;
  const thresholdSigma = realDataset?.manifest?.detection?.threshold_sigma || 5.0;
  const solidAngleKind = realDataset?.manifest?.solid_angle_kind || 'nominal solid angle';
  const badFlagBits = realDataset?.manifest?.bad_flag_bits || [0, 1, 2, 3, 15, 26, 27];
  const badFlagBitsStr = badFlagBits.join(', ');
  const catalogueName = realDataset?.manifest?.catalogue?.name || 'Gaia DR3';
  const exposures = realDataset?.exposures || [];
  const exposureCount = realDataset?.manifest?.counts?.exposures ?? (exposures.length || 120);
  const epochPairsCount = realDataset?.manifest?.epoch_pairs?.length ?? realDataset?.manifest?.counts?.epoch_pairs ?? 0;

  const dates = exposures
    .map((e) => (e.time_utc ? e.time_utc.split('T')[0] : ''))
    .filter(Boolean)
    .sort();
  const dateRangeStr =
    dates.length >= 2
      ? `${dates[0]} and ${dates[dates.length - 1]}`
      : dates[0] || '2025-04-24 and 2025-04-27';

  // Compute measured exposure counts and wavelength ranges per detector from exposures.json
  const detectorData = [
    {
      id: 'LVF 1',
      detNum: 1,
      designRange: '0.75 – 1.11 µm',
      designR: '~41',
      focus: 'Stellar photospheres and high-redshift galaxy continuum baseline',
    },
    {
      id: 'LVF 2',
      detNum: 2,
      designRange: '1.11 – 1.64 µm',
      designR: '~41',
      focus: 'Paschen-beta and extragalactic background light baseline',
    },
    {
      id: 'LVF 3',
      detNum: 3,
      designRange: '1.64 – 2.42 µm',
      designR: '~41',
      focus: 'Paschen-alpha, Brackett-gamma, and galactic stellar continuum',
    },
    {
      id: 'LVF 4',
      detNum: 4,
      designRange: '2.42 – 3.82 µm',
      designR: '~35',
      focus: 'Mid-infrared continuum (holds reference detection exposure E076 at 3.049 µm)',
    },
    {
      id: 'LVF 5',
      detNum: 5,
      designRange: '3.82 – 4.42 µm',
      designR: '~110',
      focus: 'High spectral resolution infrared continuum and ice absorption tracers',
    },
    {
      id: 'LVF 6',
      detNum: 6,
      designRange: '4.42 – 5.00 µm',
      designR: '~130',
      focus: 'High resolution long-wavelength baseline and cold dust sources',
    },
  ];

  return (
    <div className="w-full pt-14 pb-12 flex-1 flex flex-col bg-surface">
      {/* Banner */}
      <div className="w-full bg-surface-container-lowest border-b border-surface-container-high/60 px-gutter py-4">
        <div className="max-w-6xl mx-auto flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-space-sm">
              <span className="w-2 h-2 rounded-full bg-secondary"></span>
              <span className="font-label-editorial text-label-editorial tracking-[0.2em] uppercase text-outline">
                Scientific Pipeline & Calibration Architecture
              </span>
            </div>
            <DataSourceChip dataSource={dataSource} />
          </div>

          <h1 className="font-headline-lg text-headline-lg text-on-surface">
            Scientific Pipeline & Data Reduction Method
          </h1>
          <p className="font-body-md text-on-surface-variant max-w-3xl font-light">
            How real SPHEREx QR2 cutouts are calibrated, detected, photometered, and cross-matched against Gaia DR3 or AllWISE.
          </p>
        </div>
      </div>

      {/* Main Container */}
      <div className="max-w-6xl mx-auto w-full px-gutter py-8 flex flex-col gap-8">
        {/* Pipeline Steps Grid */}
        <div className="flex flex-col gap-4">
          <h2 className="font-headline-sm text-headline-sm text-on-surface">
            1. Photometric Extraction & Cross-Match Pipeline
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs font-body-sm">
            {/* Step 1 */}
            <div className="p-4 rounded-xl bg-surface-container-lowest border border-surface-container-high flex flex-col gap-2 shadow-md">
              <div className="flex items-center justify-between border-b border-surface-container-high/50 pb-2">
                <span className="font-bold text-primary font-headline-sm text-sm">
                  1. Source Detection
                </span>
                <span className="font-data-mono-sm text-[11px] text-secondary">
                  Ref: {refExposureId} ({refWavelength.toFixed(3)} µm)
                </span>
              </div>
              <p className="text-on-surface-variant leading-relaxed font-light">
                Point sources are detected on a single optimal reference exposure (<strong>{refExposureId}</strong>) using DAOStarFinder at a <strong>{thresholdSigma}-σ</strong> threshold above the local 2D background. Because SPHEREx uses Linear Variable Filters, source detection is anchored to this reference wavelength.
              </p>
            </div>

            {/* Step 2 */}
            <div className="p-4 rounded-xl bg-surface-container-lowest border border-surface-container-high flex flex-col gap-2 shadow-md">
              <div className="flex items-center justify-between border-b border-surface-container-high/50 pb-2">
                <span className="font-bold text-primary font-headline-sm text-sm">
                  2. Local Aperture Photometry
                </span>
                <span className="font-data-mono-sm text-[11px] text-secondary">
                  Radius: 2.0 px (~12.3")
                </span>
              </div>
              <p className="text-on-surface-variant leading-relaxed font-light">
                A circular aperture integrates flux around each source. The local background is measured inside an annulus (radius 4.0 to 6.0 pixels) and subtracted from the aperture flux to eliminate the dominant zodiacal light foreground.
              </p>
            </div>

            {/* Step 3 */}
            <div className="p-4 rounded-xl bg-surface-container-lowest border border-surface-container-high flex flex-col gap-2 shadow-md">
              <div className="flex items-center justify-between border-b border-surface-container-high/50 pb-2">
                <span className="font-bold text-primary font-headline-sm text-sm">
                  3. Variance-Based Errors
                </span>
                <span className="font-data-mono-sm text-[11px] text-secondary">
                  From VARIANCE FITS
                </span>
              </div>
              <p className="text-on-surface-variant leading-relaxed font-light">
                Uncertainties are computed by summing per-pixel variance from the calibrated SPHEREx VARIANCE extension, combining aperture flux uncertainty and local background estimation variance in quadrature.
              </p>
            </div>

            {/* Step 4 */}
            <div className="p-4 rounded-xl bg-surface-container-lowest border border-surface-container-high flex flex-col gap-2 shadow-md">
              <div className="flex items-center justify-between border-b border-surface-container-high/50 pb-2">
                <span className="font-bold text-primary font-headline-sm text-sm">
                  4. Nominal Pixel Solid Angle
                </span>
                <span className="font-data-mono-sm text-[11px] text-secondary">
                  {solidAngleKind}
                </span>
              </div>
              <p className="text-on-surface-variant leading-relaxed font-light">
                Flux surface brightness (MJy/sr) is converted to microJanskys (µJy) using the pixel solid angle. Nominal pixel solid angle is applied; absolute flux scales are approximate.
              </p>
            </div>

            {/* Step 5 */}
            <div className="p-4 rounded-xl bg-surface-container-lowest border border-surface-container-high flex flex-col gap-2 shadow-md">
              <div className="flex items-center justify-between border-b border-surface-container-high/50 pb-2">
                <span className="font-bold text-primary font-headline-sm text-sm">
                  5. {catalogueName} Cross-Match
                </span>
                <span className="font-data-mono-sm text-[11px] text-secondary">
                  Radius: 6.15" (1 px)
                </span>
              </div>
              <p className="text-on-surface-variant leading-relaxed font-light">
                Gaia DR3 source positions are propagated to the observation epoch using Gaia proper motion vectors (pmra, pmdec) before matching within a 6.15 arcsecond (1 pixel) search radius; infrared-only targets such as WISE 0855-0714 use AllWISE coordinates. For each matched star, links to an ADS search for the catalogue identifier are provided.
              </p>
            </div>

            {/* Step 6 */}
            <div className="p-4 rounded-xl bg-surface-container-lowest border border-surface-container-high flex flex-col gap-2 shadow-md">
              <div className="flex items-center justify-between border-b border-surface-container-high/50 pb-2">
                <span className="font-bold text-primary font-headline-sm text-sm">
                  6. Rigorous Null Accounting
                </span>
                <span className="font-data-mono-sm text-[11px] text-secondary">
                  Never zero / interpolated
                </span>
              </div>
              <p className="text-on-surface-variant leading-relaxed font-light">
                A point is null (never zero, never interpolated) when no usable measurement exists, with a reason such as 'outside image' or 'too few good pixels'. Points with flagged pixels in the aperture or near an image edge are kept and marked 'suspect'. Pixels with these flag bits are treated as bad: [{badFlagBitsStr}].
              </p>
            </div>
          </div>
        </div>

        {/* Known Scientific Limitations & Honesty Rules */}
        <div className="p-5 rounded-xl bg-surface-container-lowest border border-amber-500/40 flex flex-col gap-3 shadow-md">
          <div className="flex items-center gap-2 text-amber-300 font-headline-sm text-sm font-bold">
            <span className="material-symbols-outlined text-[20px]">warning</span>
            <span>Scientific Scope & Dataset Limitations</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-body-sm text-on-surface-variant">
            <div className="p-3 rounded bg-surface-container-low border border-surface-container-high flex flex-col gap-1">
              <span className="font-semibold text-on-surface">1. Nominal Pixel Solid Angle</span>
              <p className="font-light">
                Absolute flux calibration uses nominal pixel solid angle values. Individual detector distortions cause slight variations; absolute flux is therefore approximate.
              </p>
            </div>

            <div className="p-3 rounded bg-surface-container-low border border-surface-container-high flex flex-col gap-1">
              <span className="font-semibold text-on-surface">2. Single-Exposure Detection</span>
              <p className="font-light">
                Sources were detected exclusively on exposure {refExposureId} ({refWavelength.toFixed(3)} µm). Objects that are faint at {refWavelength.toFixed(2)} µm but bright at other wavelengths may not appear in the catalog.
              </p>
            </div>

            <div className="p-3 rounded bg-surface-container-low border border-surface-container-high flex flex-col gap-1">
              <span className="font-semibold text-on-surface">
                3. {epochPairsCount > 0 ? `${epochPairsCount} Epoch Pairs Found` : 'No Epoch Pairs'}
              </span>
              <p className="font-light">
                {epochPairsCount > 0
                  ? `${exposureCount} exposures spanning ${dateRangeStr} yielded ${epochPairsCount} multi-epoch pair(s) meeting the 14-day baseline and 2% wavelength criteria.`
                  : `All ${exposureCount} exposures in this region were captured between ${dateRangeStr}. Multi-epoch orbital screening requires pairs at least 14 days apart.`}
              </p>
            </div>

            <div className="p-3 rounded bg-surface-container-low border border-surface-container-high flex flex-col gap-1">
              <span className="font-semibold text-on-surface">4. Suspect Points</span>
              <p className="font-light">
                Suspect points: some measurements may be affected by flagged pixels or image edges. They are marked, not removed. Pixels with non-functional (bit 6), outlier (bit 19) and two other quality flags (bits 7 and 11) are not removed from the sum. Points that contain them are marked suspect.
              </p>
            </div>
          </div>
        </div>

        {/* 6 Linear Variable Filter Arrays Directory Table */}
        <div className="p-5 rounded-xl bg-surface-container-lowest border border-surface-container-high shadow-lg flex flex-col gap-4">
          <div className="flex flex-col gap-1 border-b border-surface-container-high/60 pb-3">
            <h2 className="font-headline-sm text-headline-sm text-on-surface">
              2. The 6 Linear Variable Filter (LVF) Detectors
            </h2>
            <p className="font-body-md text-xs text-on-surface-variant">
              The mission defines 17 nominal channels per detector (102 in total). The active region has {exposureCount} exposures, each measuring one wavelength for a given source.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left font-data-mono-sm text-xs border-collapse">
              <thead className="bg-surface-container-low border-b border-surface-container-high text-outline text-[11px]">
                <tr>
                  <th className="py-2.5 px-3">Detector</th>
                  <th className="py-2.5 px-3">Design Range</th>
                  <th className="py-2.5 px-3">Resolution (R)</th>
                  <th className="py-2.5 px-3">Measured in Dataset (exposures.json)</th>
                </tr>
              </thead>
              <tbody>
                {detectorData.map((det) => {
                  const detExposures = exposures.filter((e) => e.detector === det.detNum);
                  const expCount = detExposures.length || 20;
                  const minW = detExposures.length
                    ? Math.min(...detExposures.map((e) => e.wavelength_min_um ?? e.wavelength_um))
                    : null;
                  const maxW = detExposures.length
                    ? Math.max(...detExposures.map((e) => e.wavelength_max_um ?? e.wavelength_um))
                    : null;

                  const measuredRange =
                    minW !== null && maxW !== null
                      ? `${expCount} exposures (${minW.toFixed(3)} – ${maxW.toFixed(3)} µm)`
                      : `${expCount} exposures`;

                  return (
                    <tr
                      key={det.id}
                      className="border-b border-surface-container-high/40 hover:bg-surface-container/60 transition-colors"
                    >
                      <td className="py-3 px-3 text-secondary font-bold whitespace-nowrap">
                        {det.id}
                      </td>
                      <td className="py-3 px-3 text-on-surface font-semibold whitespace-nowrap">
                        {det.designRange}
                      </td>
                      <td className="py-3 px-3 text-primary font-semibold whitespace-nowrap">
                        R {det.designR}
                      </td>
                      <td className="py-3 px-3 text-on-surface-variant whitespace-nowrap">
                        {measuredRange}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Source Line with Link */}
          <div className="pt-2 text-xs font-body-sm text-outline border-t border-surface-container-high/40 flex items-center gap-1.5">
            <span>Source:</span>
            <a
              href="https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products"
              target="_blank"
              rel="noopener noreferrer"
              className="text-secondary hover:underline flex items-center gap-1"
            >
              <span>Design values from the SPHEREx mission papers</span>
              <span className="material-symbols-outlined text-[14px]">open_in_new</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
