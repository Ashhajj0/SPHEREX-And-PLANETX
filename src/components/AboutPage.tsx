import React, { useState } from 'react';
import { DataSourceChip } from './DataSourceChip.tsx';

interface AboutPageProps {
  dataSource?: 'real' | 'fixture';
}

export const AboutPage: React.FC<AboutPageProps> = ({ dataSource = 'real' }) => {
  const [copiedCitation, setCopiedCitation] = useState(false);

  const bibtex = `@article{spherex_qr2_2026,
  author = {SPHEREx Science Team and Caltech/IPAC IRSA},
  title = {SPHEREx All-Sky Infrared Spectrophotometric Survey: Quick Release 2 (QR2)},
  journal = {Caltech / IPAC Infrared Science Archive},
  year = {2026},
  doi = {10.26131/IRSA652},
  url = {https://doi.org/10.26131/IRSA652}
}`;

  const handleCopyCitation = () => {
    navigator.clipboard.writeText(bibtex);
    setCopiedCitation(true);
    setTimeout(() => setCopiedCitation(false), 2500);
  };

  return (
    <div className="w-full pt-14 pb-12 flex-1 flex flex-col bg-surface">
      {/* Banner */}
      <div className="w-full bg-surface-container-lowest border-b border-surface-container-high/60 px-gutter py-4">
        <div className="max-w-6xl mx-auto flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-space-sm">
              <span className="w-2 h-2 rounded-full bg-secondary"></span>
              <span className="font-label-editorial text-label-editorial tracking-[0.2em] uppercase text-outline">
                Project Information & Open Science
              </span>
            </div>
            <DataSourceChip dataSource={dataSource} />
          </div>

          <h1 className="font-headline-lg text-headline-lg text-on-surface">
            About the SPHEREx Explorer
          </h1>
          <p className="font-body-md text-on-surface-variant max-w-3xl font-light">
            Interactive exploration of public NASA SPHEREx spectrophotometric survey cutouts.
          </p>
        </div>
      </div>

      {/* Main Container */}
      <div className="max-w-6xl mx-auto w-full px-gutter py-8 flex flex-col gap-8">
        {/* Project & Team Placeholder */}
        <div className="p-5 rounded-xl bg-surface-container-lowest border border-surface-container-high shadow-lg flex flex-col gap-3">
          <h2 className="font-headline-sm text-base font-bold text-on-surface">
            Team & Project Overview
          </h2>
          <p className="font-body-sm text-xs text-on-surface-variant leading-relaxed">
            This tool provides interactive spectrophotometric analysis for astronomical researchers, educators, and the open-science community exploring calibrated SPHEREx Quick Release 2 (QR2) datasets.
          </p>
          <div className="p-3 rounded bg-surface-container-low border border-surface-container-high text-xs font-data-mono-sm text-outline">
            SPHEREx Explorer Team · Independent Research & Open Source Contributors
          </div>
        </div>

        {/* Primary Data Sources */}
        <div className="flex flex-col gap-4">
          <h2 className="font-headline-sm text-headline-sm text-on-surface">
            Authoritative Data Sources
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs font-body-sm">
            <div className="p-4 rounded-xl bg-surface-container-lowest border border-surface-container-high flex flex-col gap-2 shadow-md">
              <span className="font-bold text-on-surface">SPHEREx QR2</span>
              <p className="text-on-surface-variant font-light">
                Caltech / IPAC Infrared Science Archive (IRSA) SIA v2 image cutouts and WCS wavelength lookup tables.
              </p>
              <a
                href="https://doi.org/10.26131/IRSA652"
                target="_blank"
                rel="noreferrer"
                className="text-secondary font-data-mono-sm text-[11px] underline mt-auto"
              >
                DOI: 10.26131/IRSA652
              </a>
            </div>

            <div className="p-4 rounded-xl bg-surface-container-lowest border border-surface-container-high flex flex-col gap-2 shadow-md">
              <span className="font-bold text-on-surface">Gaia DR3</span>
              <p className="text-on-surface-variant font-light">
                European Space Agency (ESA) Gaia Data Release 3 astrometric reference catalog used for source cross-matching.
              </p>
              <span className="text-outline font-data-mono-sm text-[11px] mt-auto">
                Epoch J2016.0 proper motion
              </span>
            </div>

            <div className="p-4 rounded-xl bg-surface-container-lowest border border-surface-container-high flex flex-col gap-2 shadow-md">
              <span className="font-bold text-on-surface">NASA ADS</span>
              <p className="text-on-surface-variant font-light">
                NASA Astrophysics Data System bibliographic references generated for matched astronomical identifiers.
              </p>
              <a
                href="https://ui.adsabs.harvard.edu"
                target="_blank"
                rel="noreferrer"
                className="text-primary font-data-mono-sm text-[11px] underline mt-auto"
              >
                ui.adsabs.harvard.edu
              </a>
            </div>

            <div className="p-4 rounded-xl bg-surface-container-lowest border border-surface-container-high flex flex-col gap-2 shadow-md">
              <span className="font-bold text-on-surface">IRSA SIA2 & TAP</span>
              <p className="text-on-surface-variant font-light">
                IVOA-compliant Simple Image Access (SIA v2) and Table Access Protocol (TAP) services.
              </p>
              <span className="text-outline font-data-mono-sm text-[11px] mt-auto">
                spherex_qr2 collection
              </span>
            </div>
          </div>
        </div>

        {/* License & AI Use Transparency Note */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Open Source License */}
          <div className="p-4 rounded-xl bg-surface-container-lowest border border-surface-container-high flex flex-col gap-2 shadow-md">
            <span className="font-headline-sm text-sm font-bold text-on-surface">
              Open Source License (Apache-2.0)
            </span>
            <p className="font-body-sm text-xs text-on-surface-variant leading-relaxed font-light">
              This application and Python data pipeline are released under the Apache License, Version 2.0.
              Permitted for academic research, education, and commercial use with attribution.
            </p>
            <div className="mt-auto pt-2">
              <span className="px-2 py-0.5 rounded bg-surface-container text-[11px] font-data-mono-sm text-outline border border-surface-container-high">
                SPDX-License-Identifier: Apache-2.0
              </span>
            </div>
          </div>

          {/* AI-Use Note */}
          <div className="p-4 rounded-xl bg-surface-container-lowest border border-surface-container-high flex flex-col gap-2 shadow-md">
            <span className="font-headline-sm text-sm font-bold text-on-surface">
              AI Tools & Engineering Statement
            </span>
            <p className="font-body-sm text-xs text-on-surface-variant leading-relaxed font-light">
              AI coding tools assisted in structuring React web components, coordinate projections, and export scripts.
              All scientific reduction formulas, aperture photometry algorithms, WCS transforms, and crossmatch verification rules were author-designed, validated with tests, and anchored to official IPAC IRSA documentation.
            </p>
          </div>
        </div>

        {/* QR2 Release Citation */}
        <div className="p-5 rounded-xl bg-surface-container-lowest border border-surface-container-high shadow-lg flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-surface-container-high/60 pb-2">
            <span className="font-headline-sm text-sm font-bold text-on-surface">
              Citing SPHEREx Quick Release 2 Data
            </span>
            <button
              onClick={handleCopyCitation}
              className="px-3 py-1 rounded bg-primary-container hover:bg-primary text-on-primary text-xs font-data-mono-sm transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">content_copy</span>
              <span>{copiedCitation ? 'Copied BibTeX!' : 'Copy BibTeX'}</span>
            </button>
          </div>

          <pre className="p-3 rounded bg-surface-container-low text-[11px] font-data-mono-sm text-on-surface-variant overflow-x-auto border border-surface-container-high">
            {bibtex}
          </pre>
        </div>
      </div>
    </div>
  );
};
