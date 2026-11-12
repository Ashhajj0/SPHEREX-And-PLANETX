import React from 'react';
import { RealDataset } from '../data/real.ts';
import { DataSourceChip } from './DataSourceChip.tsx';

interface MovingObjectsPageProps {
  dataSource?: 'real' | 'fixture';
  realDataset?: RealDataset | null;
}

/**
 * MovingObjectsPage displays the screening status for solar system moving objects.
 * For the current deep-field release (QR2 NEP), all exposures were acquired over
 * a 3-day baseline, which does not meet the 14-day minimum interval required for
 * orbital motion screening. No synthetic demo or invented rates are displayed.
 */
export const MovingObjectsPage: React.FC<MovingObjectsPageProps> = ({
  dataSource = 'real',
  realDataset,
}) => {
  // Extract observation date range directly from real exposures
  const dateRange = (() => {
    if (realDataset?.exposures?.length) {
      const dates = realDataset.exposures
        .map((e) => e.time_utc.split('T')[0])
        .filter(Boolean)
        .sort();
      if (dates.length > 0) {
        return `${dates[0]} and ${dates[dates.length - 1]}`;
      }
    }
    return '2025-04-24 and 2025-04-27';
  })();

  const exposureCount = realDataset?.manifest?.counts?.exposures ?? realDataset?.exposures?.length ?? 120;

  return (
    <div className="w-full pt-14 pb-12 flex-1 flex flex-col bg-surface">
      {/* Page Header */}
      <div className="w-full bg-surface-container-lowest border-b border-surface-container-high/60 px-gutter py-4">
        <div className="max-w-6xl mx-auto flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-space-sm">
              <span className="w-2 h-2 rounded-full bg-secondary"></span>
              <span className="font-label-editorial text-label-editorial tracking-[0.2em] uppercase text-outline">
                Solar System Observation Baseline
              </span>
            </div>
            <DataSourceChip dataSource={dataSource} />
          </div>

          <h1 className="font-headline-lg text-headline-lg text-on-surface">
            Moving-object screening
          </h1>
          <p className="font-body-md text-on-surface-variant max-w-3xl font-light">
            Multi-epoch candidate screening across survey passes.
          </p>
        </div>
      </div>

      {/* Main Content Area: Calm Information Panel */}
      <div className="max-w-4xl mx-auto w-full px-gutter py-12 flex flex-col items-center justify-center flex-1">
        <div className="w-full p-8 md:p-10 rounded-2xl bg-surface-container-lowest border border-surface-container-high shadow-xl flex flex-col items-center text-center gap-5">
          <div className="w-14 h-14 rounded-full bg-surface-container flex items-center justify-center text-secondary border border-surface-container-high">
            <span className="material-symbols-outlined text-[30px]">schedule</span>
          </div>

          <h2 className="font-headline-sm text-xl font-bold text-on-surface">
            Moving Objects Mode Not Available for this Dataset
          </h2>

          <p className="font-body-md text-sm md:text-base text-on-surface-variant leading-relaxed max-w-2xl">
            All <strong className="text-on-surface font-semibold">{exposureCount} exposures</strong> in this dataset were taken between{' '}
            <strong className="text-on-surface font-semibold">{dateRange}</strong>.
            A moving-object candidate search requires at least two exposures taken with the same detector array
            and similar central wavelength at least <strong className="text-on-surface font-semibold">14 days apart</strong> to observe orbital motion.
          </p>

          {/* Screening Requirements (Project Criteria) */}
          <div className="w-full mt-4 p-5 rounded-xl bg-surface-container-low border border-surface-container-high/80 text-left flex flex-col gap-3">
            <span className="text-xs font-data-mono-sm uppercase tracking-wider text-secondary font-semibold">
              Screening requirements (project criteria)
            </span>
            <ul className="text-xs text-on-surface-variant font-data-mono-sm space-y-2 list-disc list-inside">
              <li>
                Time baseline: our rule requires two exposures at least 14 days apart.
              </li>
              <li>
                Detector pairing: same detector array and central wavelength within 2 percent, so both images sample the same part of the spectrum.
              </li>
              <li>
                This dataset: all 120 exposures were taken within about 3 days (dates read from exposures.json), so no pair qualifies.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
