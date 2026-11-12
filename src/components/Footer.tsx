import React from 'react';

export interface CursorStatus {
  ra_deg: number | null;
  dec_deg: number | null;
  exposure_id: string | null;
  wavelength_um: number | null;
  detector: number | null;
  zoom: number;
  dataSource: 'real' | 'fixture';
  selectedSourceId?: string | null;
  regionName?: string;
}

interface FooterProps {
  cursorStatus: CursorStatus;
}

export const Footer: React.FC<FooterProps> = ({ cursorStatus }) => {
  const {
    ra_deg,
    dec_deg,
    exposure_id,
    wavelength_um,
    detector,
    zoom,
    dataSource,
    selectedSourceId,
    regionName,
  } = cursorStatus;

  return (
    <footer className="fixed bottom-0 left-0 w-full z-40 bg-surface-container-lowest border-t border-surface-container-high/60 h-8 flex items-center">
      <div className="w-full px-gutter flex items-center justify-between text-outline font-data-mono-sm text-xs overflow-x-auto whitespace-nowrap">
        {/* Left: Dynamic Live Coordinates and Telescope State */}
        <div className="flex items-center gap-space-md">
          <span>
            RA <span className="text-on-surface font-semibold">{ra_deg !== null ? `${ra_deg.toFixed(4)}°` : '--'}</span> · DEC{' '}
            <span className="text-on-surface font-semibold">{dec_deg !== null ? `${dec_deg.toFixed(4)}°` : '--'}</span>
            {regionName && (
              <span className="text-outline-variant ml-1.5 hidden sm:inline">
                ({regionName})
              </span>
            )}
          </span>

          <span className="text-surface-container-highest">|</span>

          <span>
            Exposure: <span className="text-primary font-semibold">{exposure_id || '--'}</span>
            {wavelength_um !== null && (
              <span className="text-on-surface-variant ml-1">
                ({wavelength_um.toFixed(3)} µm)
              </span>
            )}
          </span>

          <span className="text-surface-container-highest">|</span>

          <span>
            Detector: <span className="text-on-surface">{detector !== null ? `LVF ${detector}` : '--'}</span>
          </span>

          {selectedSourceId && (
            <>
              <span className="text-surface-container-highest">|</span>
              <span>
                Source: <span className="text-secondary font-semibold">{selectedSourceId}</span>
              </span>
            </>
          )}

          <span className="text-surface-container-highest">|</span>

          <span>
            Zoom: <span className="text-on-surface">{zoom ? `${zoom.toFixed(1)}x` : '1.0x'}</span>
          </span>
        </div>

        {/* Right: Data Source and Mission DOI */}
        <div className="flex items-center gap-space-md">
          <a
            href="https://doi.org/10.26131/IRSA652"
            target="_blank"
            rel="noreferrer"
            className="text-outline-variant hover:text-outline transition-colors text-[11px]"
          >
            DOI: 10.26131/IRSA652
          </a>

          <div className="flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                dataSource === 'real' ? 'bg-secondary' : 'bg-amber-400'
              }`}
            ></span>
            <span
              className={`font-medium ${
                dataSource === 'real' ? 'text-secondary' : 'text-amber-300'
              }`}
            >
              {dataSource === 'real' ? 'Real SPHEREx QR2' : 'Synthetic fixture'}
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
};
