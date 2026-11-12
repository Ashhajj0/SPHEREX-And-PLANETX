import React, { useState } from 'react';
import { TargetObject, SpectralBand, SPHEREX_BANDS, SPHEREX_TARGETS } from '../data/spherexData.ts';

// 1. Settings Modal
interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  coordFormat: 'sexagesimal' | 'decimal';
  setCoordFormat: (fmt: 'sexagesimal' | 'decimal') => void;
  fluxUnit: 'uJy' | 'mJy' | 'abmag';
  setFluxUnit: (unit: 'uJy' | 'mJy' | 'abmag') => void;
  colormap: string;
  setColormap: (cmap: string) => void;
  localCache: boolean;
  setLocalCache: (val: boolean) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  coordFormat,
  setCoordFormat,
  fluxUnit,
  setFluxUnit,
  colormap,
  setColormap,
  localCache,
  setLocalCache,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-container-lowest/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-surface-container-low border border-surface-container-high rounded-xl p-5 shadow-2xl flex flex-col gap-4 text-on-surface">
        <div className="flex items-center justify-between border-b border-surface-container-high pb-2.5">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">settings</span>
            <span className="font-headline-sm text-sm font-bold uppercase tracking-wider">
              Explorer Settings & Calibration
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-outline hover:text-on-surface p-1 rounded hover:bg-surface-container-high/40 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Coordinate Format */}
        <div className="flex flex-col gap-1.5">
          <span className="font-label-editorial text-label-editorial text-outline uppercase tracking-wider">
            Astrometric Coordinate Notation
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setCoordFormat('sexagesimal')}
              className={`p-2 rounded text-xs font-data-mono-sm border transition-colors cursor-pointer ${
                coordFormat === 'sexagesimal'
                  ? 'bg-primary-container text-on-primary border-primary font-bold'
                  : 'bg-surface-container text-on-surface border-surface-container-high hover:border-outline'
              }`}
            >
              Sexagesimal (HMS / DMS)
            </button>
            <button
              onClick={() => setCoordFormat('decimal')}
              className={`p-2 rounded text-xs font-data-mono-sm border transition-colors cursor-pointer ${
                coordFormat === 'decimal'
                  ? 'bg-primary-container text-on-primary border-primary font-bold'
                  : 'bg-surface-container text-on-surface border-surface-container-high hover:border-outline'
              }`}
            >
              Decimal Degrees (deg)
            </button>
          </div>
        </div>

        {/* Flux Unit */}
        <div className="flex flex-col gap-1.5">
          <span className="font-label-editorial text-label-editorial text-outline uppercase tracking-wider">
            Photometric Flux Unit ($F_\nu$)
          </span>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'uJy', label: 'MicroJanskys (µJy)' },
              { id: 'mJy', label: 'MilliJanskys (mJy)' },
              { id: 'abmag', label: 'AB Magnitude' },
            ].map((u) => (
              <button
                key={u.id}
                onClick={() => setFluxUnit(u.id as any)}
                className={`p-2 rounded text-xs font-data-mono-sm border transition-colors cursor-pointer ${
                  fluxUnit === u.id
                    ? 'bg-secondary text-on-secondary border-secondary font-bold'
                    : 'bg-surface-container text-on-surface border-surface-container-high hover:border-outline'
                }`}
              >
                {u.label}
              </button>
            ))}
          </div>
        </div>

        {/* Colormap */}
        <div className="flex flex-col gap-1.5">
          <span className="font-label-editorial text-label-editorial text-outline uppercase tracking-wider">
            Default Infrared FITS Colormap
          </span>
          <select
            value={colormap}
            onChange={(e) => setColormap(e.target.value)}
            className="p-2 rounded bg-surface-container text-xs font-data-mono-sm border border-surface-container-high text-on-surface outline-none cursor-pointer"
          >
            <option value="false-color">Infrared False-Color (NASA Space)</option>
            <option value="viridis">Viridis Standard</option>
            <option value="magma">Magma High-Contrast</option>
            <option value="grayscale">Astronomical Grayscale (Inverted)</option>
          </select>
        </div>

        {/* Local Cache Toggle */}
        <div className="flex items-center justify-between p-3 rounded bg-surface-container border border-surface-container-high">
          <div className="flex flex-col">
            <span className="font-headline-sm text-xs text-on-surface">Mission QR2 Local Cache</span>
            <span className="font-data-mono-sm text-[11px] text-outline">
              Preload 102 continuous spectral band models
            </span>
          </div>
          <button
            onClick={() => setLocalCache(!localCache)}
            className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
              localCache ? 'bg-secondary' : 'bg-surface-container-high'
            }`}
          >
            <span
              className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-surface transition-transform ${
                localCache ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <button
          onClick={onClose}
          className="w-full py-2 rounded bg-primary-container hover:bg-primary text-on-primary font-body-sm text-xs font-medium transition-colors cursor-pointer"
        >
          Apply Calibration Settings
        </button>
      </div>
    </div>
  );
};

// 2. Profile / Observer Session Modal
interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTarget: TargetObject;
  onSelectTarget: (t: TargetObject) => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  currentTarget,
  onSelectTarget,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-container-lowest/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-surface-container-low border border-surface-container-high rounded-xl p-5 shadow-2xl flex flex-col gap-4 text-on-surface">
        <div className="flex items-center justify-between border-b border-surface-container-high pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center">
              <span className="material-symbols-outlined text-on-primary text-[16px]">person</span>
            </div>
            <span className="font-headline-sm text-sm font-bold uppercase tracking-wider">
              Observer Workspace
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-outline hover:text-on-surface p-1 rounded hover:bg-surface-container-high/40 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="p-3 rounded bg-surface-container border border-surface-container-high flex flex-col gap-1 font-data-mono-sm text-xs">
          <span className="text-secondary font-semibold">Caltech / IPAC IRSA Guest Session</span>
          <span className="text-outline text-[11px]">Observer ID: OBS-SPHEREX-2026-QR2</span>
          <span className="text-outline text-[11px]">Session Status: Connected</span>
        </div>

        <div className="flex flex-col gap-2">
          <span className="font-label-editorial text-label-editorial text-outline uppercase tracking-wider">
            Active Research Targets
          </span>
          <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
            {SPHEREX_TARGETS.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  onSelectTarget(t);
                  onClose();
                }}
                className={`p-2 rounded text-left border flex items-center justify-between transition-colors cursor-pointer ${
                  t.id === currentTarget.id
                    ? 'bg-surface-container-high border-secondary text-on-surface'
                    : 'bg-surface-container text-on-surface-variant hover:text-on-surface border-surface-container-high'
                }`}
              >
                <div className="flex flex-col">
                  <span className="font-headline-sm text-xs font-semibold">{t.name}</span>
                  <span className="font-data-mono-sm text-[10px] text-outline">{t.field}</span>
                </div>
                <span className="material-symbols-outlined text-[16px] text-outline">arrow_forward</span>
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-2 rounded bg-surface-container hover:bg-surface-container-high border border-outline-variant/40 text-on-surface font-body-sm text-xs transition-colors cursor-pointer"
        >
          Return to Console
        </button>
      </div>
    </div>
  );
};

// 3. Pinpoint Coordinates Modal
interface PinpointModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyCoords: (raHMS: string, decDMS: string) => void;
}

export const PinpointModal: React.FC<PinpointModalProps> = ({
  isOpen,
  onClose,
  onApplyCoords,
}) => {
  const [ra, setRa] = useState("17h 40m 15.3s");
  const [dec, setDec] = useState("+65° 28' 20.1\"");

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-container-lowest/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-surface-container-low border border-surface-container-high rounded-xl p-5 shadow-2xl flex flex-col gap-4 text-on-surface">
        <div className="flex items-center justify-between border-b border-surface-container-high pb-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-secondary text-[20px]">my_location</span>
            <span className="font-headline-sm text-sm font-bold uppercase tracking-wider">
              Target Center Pinpoint
            </span>
          </div>
          <button onClick={onClose} className="text-outline hover:text-on-surface p-1 cursor-pointer">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="flex flex-col gap-3 font-data-mono-sm text-xs">
          <div className="flex flex-col gap-1">
            <label className="text-outline">Right Ascension (RA J2000):</label>
            <input
              type="text"
              value={ra}
              onChange={(e) => setRa(e.target.value)}
              className="p-2 rounded bg-surface-container text-on-surface border border-surface-container-high outline-none focus:border-secondary"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-outline">Declination (DEC J2000):</label>
            <input
              type="text"
              value={dec}
              onChange={(e) => setDec(e.target.value)}
              className="p-2 rounded bg-surface-container text-on-surface border border-surface-container-high outline-none focus:border-secondary"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-surface-container-high">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs text-outline hover:text-on-surface cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onApplyCoords(ra, dec);
              onClose();
            }}
            className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-bold text-xs cursor-pointer hover:bg-secondary/90 transition-colors"
          >
            Center Sky
          </button>
        </div>
      </div>
    </div>
  );
};

// 4. Spectral Filter Popover
interface FilterPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectBand: (band: SpectralBand) => void;
}

export const FilterPopover: React.FC<FilterPopoverProps> = ({
  isOpen,
  onClose,
  onSelectBand,
}) => {
  if (!isOpen) return null;

  const keyTracerBands = [
    { band: 8, wl: 0.85, name: 'Ca II Triplet / Pa-ε', desc: 'Stellar gravity probe' },
    { band: 24, wl: 1.28, name: 'Paschen-β (1.28 µm)', desc: 'Interstellar hydrogen recombination' },
    { band: 38, wl: 2.42, name: 'Band 38 Reference', desc: 'QR2 Baseline photometric zero-point' },
    { band: 58, wl: 3.05, name: 'H₂O Water Ice Band', desc: 'Prebiotic interstellar icy grain mantle' },
    { band: 62, wl: 3.30, name: 'PAH Aromatic Dust', desc: 'Organic hydrocarbon ring emission' },
    { band: 75, wl: 4.27, name: 'CO₂ Carbon Dioxide Ice', desc: 'Volatile carbon planetary snowline' },
    { band: 89, wl: 4.67, name: 'CO Carbon Monoxide Ice', desc: 'Deep interstellar volatile freeze-out' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-container-lowest/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-surface-container-low border border-surface-container-high rounded-xl p-5 shadow-2xl flex flex-col gap-3 text-on-surface">
        <div className="flex items-center justify-between border-b border-surface-container-high pb-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-secondary text-[20px]">tune</span>
            <span className="font-headline-sm text-sm font-bold uppercase tracking-wider">
              Diagnostic Spectral Filter
            </span>
          </div>
          <button onClick={onClose} className="text-outline hover:text-on-surface p-1 cursor-pointer">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <p className="font-body-sm text-xs text-on-surface-variant font-light">
          Jump directly to key spectrophotometric diagnostic filters across the 0.75 to 5.0 µm window:
        </p>

        <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-1">
          {keyTracerBands.map((item) => (
            <button
              key={item.band}
              onClick={() => {
                const b = SPHEREX_BANDS.find((sb) => sb.bandNumber === item.band);
                if (b) {
                  onSelectBand(b);
                  onClose();
                }
              }}
              className="p-2.5 rounded bg-surface-container hover:bg-surface-container-high border border-surface-container-high hover:border-secondary transition-all text-left flex items-center justify-between cursor-pointer group"
            >
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-data-mono-sm text-xs font-bold text-secondary">
                    Band {item.band}
                  </span>
                  <span className="font-headline-sm text-xs font-semibold text-on-surface">
                    {item.name}
                  </span>
                </div>
                <span className="font-body-sm text-[11px] text-outline">{item.desc}</span>
              </div>
              <span className="font-data-mono-sm text-xs text-primary font-semibold">
                {item.wl.toFixed(2)} µm
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
