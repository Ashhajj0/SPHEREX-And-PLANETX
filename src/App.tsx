/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { Header } from './components/Header.tsx';
import { Footer, CursorStatus } from './components/Footer.tsx';
import { HomePage } from './components/HomePage.tsx';
import { ExplorerPage } from './components/ExplorerPage.tsx';
import { MovingObjectsPage } from './components/MovingObjectsPage.tsx';
import { MethodPage } from './components/MethodPage.tsx';
import { AboutPage } from './components/AboutPage.tsx';
import {
  SettingsModal,
  ProfileModal,
  PinpointModal,
  FilterPopover,
} from './components/Modals.tsx';
import {
  CONFIGURED_SKY_REGIONS,
  SPHEREX_TARGETS,
  SPHEREX_BANDS,
  TargetObject,
  SpectralBand,
} from './data/spherexData.ts';
import {
  loadAvailableRegions,
  loadRealData,
  ExportedRegionSummary,
  RealDataset,
  RealExposure,
  RealSource,
} from './data/real.ts';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('home');

  // Real data state
  const [dataSource, setDataSource] = useState<'real' | 'fixture'>('fixture');
  const [availableRegions, setAvailableRegions] = useState<ExportedRegionSummary[]>([]);
  const [activeRegionId, setActiveRegionId] = useState<string>('');
  const [realDataset, setRealDataset] = useState<RealDataset | null>(null);
  const [missingDetails, setMissingDetails] = useState<{
    files: string[];
    keys: string[];
    error?: string;
  } | null>(null);
  const [selectedRealExposure, setSelectedRealExposure] = useState<RealExposure | null>(null);
  const [selectedRealSource, setSelectedRealSource] = useState<RealSource | null>(null);
  const [showErrorBanner, setShowErrorBanner] = useState<boolean>(false);

  // Fallback synthetic state
  const [currentTarget, setCurrentTarget] = useState<TargetObject>(SPHEREX_TARGETS[0]);
  const [currentBand, setCurrentBand] = useState<SpectralBand>(
    SPHEREX_BANDS.find((b) => b.bandNumber === 38) || SPHEREX_BANDS[37]
  );
  const [localCache, setLocalCache] = useState<boolean>(true);
  const [coordFormat, setCoordFormat] = useState<'sexagesimal' | 'decimal'>('sexagesimal');
  const [fluxUnit, setFluxUnit] = useState<'uJy' | 'mJy' | 'abmag'>('uJy');
  const [colormap, setColormap] = useState<string>('infrared');

  // Live cursor status bar state
  const [cursorStatus, setCursorStatus] = useState<CursorStatus>({
    ra_deg: null,
    dec_deg: null,
    exposure_id: null,
    wavelength_um: null,
    detector: null,
    zoom: 1.0,
    dataSource: 'fixture',
    selectedSourceId: null,
    regionName: undefined,
  });

  // Modals state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isPinpointOpen, setIsPinpointOpen] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const applyLoadedDataset = (dataset: RealDataset) => {
    setDataSource('real');
    setRealDataset(dataset);
    setActiveRegionId(dataset.manifest.region.id);
    setMissingDetails(null);
    setShowErrorBanner(false);

    // Select brightest source automatically on load
    const sortedSources = [...dataset.sources].sort((a, b) => b.peak_snr - a.peak_snr);
    const brightest = sortedSources[0] || null;
    setSelectedRealSource(brightest);

    // Select reference exposure or first exposure
    const refId = dataset.manifest.detection?.reference_exposure_id;
    const refExp = dataset.exposures.find((e) => e.id === refId) || dataset.exposures[0] || null;
    setSelectedRealExposure(refExp);

    setCursorStatus((prev) => ({
      ...prev,
      dataSource: 'real',
      exposure_id: refExp?.id || null,
      wavelength_um: refExp?.wavelength_um || null,
      detector: refExp?.detector || null,
      selectedSourceId: brightest?.id || null,
      regionName: dataset.manifest.region.name,
    }));
  };

  // Load region index & default real data on mount
  useEffect(() => {
    let isMounted = true;

    loadAvailableRegions().then((regions) => {
      if (!isMounted) return;
      setAvailableRegions(regions);
    });

    loadRealData()
      .then((res) => {
        if (!isMounted) return;
        if (res.success && res.data) {
          applyLoadedDataset(res.data);
        } else {
          setDataSource('fixture');
          const details = {
            files: res.missingFiles,
            keys: res.missingKeys,
            error: res.errorMessage,
          };
          setMissingDetails(details);
          if (res.missingFiles.length > 0 || res.missingKeys.length > 0) {
            setShowErrorBanner(true);
          }
          setCursorStatus((prev) => ({
            ...prev,
            dataSource: 'fixture',
            ra_deg: SPHEREX_TARGETS[0].raDeg,
            dec_deg: SPHEREX_TARGETS[0].decDeg,
            exposure_id: `B${String(currentBand.bandNumber).padStart(3, '0')}`,
            wavelength_um: currentBand.wavelength,
            detector: Number(currentBand.detector.replace(/\D/g, '')) || 4,
            selectedSourceId: SPHEREX_TARGETS[0].id,
            regionName: SPHEREX_TARGETS[0].field || 'Synthetic Demo Field',
          }));
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        console.warn('[App] Real data load failed:', err);
        setDataSource('fixture');
        setMissingDetails({ files: ['/real/*'], keys: [], error: String(err) });
        setShowErrorBanner(true);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSelectFixtureRegion = (regionId: string, navigateToExplorer = true) => {
    const cfg = CONFIGURED_SKY_REGIONS.find((r) => r.id === regionId);
    const matchedTarget =
      SPHEREX_TARGETS.find((t) => t.id === cfg?.targetId || t.id === regionId) ||
      SPHEREX_TARGETS[0];

    setCurrentTarget(matchedTarget);
    setActiveRegionId(regionId);
    if (!realDataset) {
      setDataSource('fixture');
      setCursorStatus((prev) => ({
        ...prev,
        dataSource: 'fixture',
        ra_deg: matchedTarget.raDeg,
        dec_deg: matchedTarget.decDeg,
        exposure_id: `B${String(currentBand.bandNumber).padStart(3, '0')}`,
        wavelength_um: currentBand.wavelength,
        detector: Number(currentBand.detector.replace(/\D/g, '')) || 4,
        selectedSourceId: matchedTarget.id,
        regionName: cfg?.name || matchedTarget.field || matchedTarget.name,
      }));
    }
    if (navigateToExplorer) {
      setActiveTab('explorer');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleSelectRegion = async (regionId: string, navigateToExplorer = false) => {
    const isExported = availableRegions.some((r) => r.id === regionId);
    if (!isExported) {
      handleSelectFixtureRegion(regionId, navigateToExplorer);
      return;
    }
    const res = await loadRealData(regionId);
    if (res.success && res.data) {
      applyLoadedDataset(res.data);
      if (navigateToExplorer) {
        setActiveTab('explorer');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } else {
      handleSelectFixtureRegion(regionId, navigateToExplorer);
    }
  };

  const handleSelectTarget = (target: TargetObject) => {
    setCurrentTarget(target);
    if (!realDataset) {
      setCursorStatus((prev) => ({
        ...prev,
        dataSource: 'fixture',
        ra_deg: target.raDeg,
        dec_deg: target.decDeg,
        selectedSourceId: target.id,
        regionName: target.field || target.name,
      }));
    }
  };

  const handleSelectBand = (band: SpectralBand) => {
    setCurrentBand(band);
    if (!realDataset) {
      const detNum = Number(band.detector.replace(/\D/g, '')) || 1;
      setCursorStatus((prev) => ({
        ...prev,
        exposure_id: `B${String(band.bandNumber).padStart(3, '0')}`,
        wavelength_um: band.wavelength,
        detector: detNum,
      }));
    }
  };

  const handleSelectRealSource = (src: RealSource) => {
    setSelectedRealSource(src);
    setCursorStatus((prev) => ({
      ...prev,
      selectedSourceId: src.id,
      ra_deg: src.ra_deg,
      dec_deg: src.dec_deg,
    }));
  };

  const handleSelectRealExposure = (exp: RealExposure) => {
    setSelectedRealExposure(exp);
    setCursorStatus((prev) => ({
      ...prev,
      exposure_id: exp.id,
      wavelength_um: exp.wavelength_um,
      detector: exp.detector,
    }));
  };

  const handleCursorMove = (status: {
    ra_deg: number | null;
    dec_deg: number | null;
    exposure_id: string | null;
    wavelength_um: number | null;
    detector: number | null;
    zoom: number;
    selectedSourceId?: string | null;
  }) => {
    setCursorStatus((prev) => ({
      ...prev,
      ra_deg: status.ra_deg,
      dec_deg: status.dec_deg,
      exposure_id: status.exposure_id ?? prev.exposure_id,
      wavelength_um: status.wavelength_um ?? prev.wavelength_um,
      detector: status.detector ?? prev.detector,
      zoom: status.zoom,
      selectedSourceId: status.selectedSourceId ?? prev.selectedSourceId,
    }));
  };

  const handleEnterExplorer = () => {
    setActiveTab('explorer');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleApplyPinpointCoords = (raHMS: string, decDMS: string) => {
    const customTarget: TargetObject = {
      ...currentTarget,
      name: `Custom (${raHMS})`,
      raHMS,
      decDMS,
      field: 'Pinpoint Sky Center',
    };
    setCurrentTarget(customTarget);
    setActiveTab('explorer');
  };

  return (
    <div className="min-h-screen bg-surface text-on-surface flex flex-col font-body-md antialiased selection:bg-primary-container selection:text-on-primary-container">
      {/* Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        localCache={localCache}
        setLocalCache={setLocalCache}
        onOpenSettings={() => setIsSettingsOpen(true)}
        dataSource={dataSource}
        missingDetails={missingDetails}
      />

      {/* Floating Dismissable Error Panel if real data is missing or incomplete */}
      {showErrorBanner && missingDetails && (
        <div className="fixed top-16 right-4 z-50 max-w-sm p-3 rounded-lg bg-surface-container-low border border-amber-500/50 shadow-2xl text-xs font-data-mono-sm text-on-surface flex flex-col gap-1.5 animate-fadeIn">
          <div className="flex items-center justify-between text-amber-300 font-bold">
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">info</span>
              Synthetic Fallback Active
            </span>
            <button
              onClick={() => setShowErrorBanner(false)}
              className="text-outline hover:text-on-surface p-0.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </div>
          <p className="font-body-sm text-xs text-on-surface-variant font-light">
            Real SPHEREx QR2 files not found in <code className="text-secondary">web/public/real/</code>.
            Run <code className="text-primary">python -m backend.compute.export_region --all</code> to generate them.
          </p>
          {missingDetails.keys.length > 0 && (
            <div className="text-[10px] text-outline">
              Missing keys: {missingDetails.keys.join(', ')}
            </div>
          )}
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {activeTab === 'home' && (
          <HomePage
            dataSource={dataSource}
            realDataset={realDataset}
            availableRegions={availableRegions}
            activeRegionId={activeRegionId}
            onSelectRegion={(rid) => handleSelectRegion(rid, true)}
            onSelectFixtureRegion={(rid) => handleSelectFixtureRegion(rid, true)}
            missingDetails={missingDetails}
            onEnterExplorer={handleEnterExplorer}
            onNavigateTab={(tab) => {
              setActiveTab(tab);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onSelectRealSource={handleSelectRealSource}
            onSelectTarget={handleSelectTarget}
            onOpenPinpoint={() => setIsPinpointOpen(true)}
            onOpenFilterPopover={() => setIsFilterOpen(true)}
          />
        )}

        {activeTab === 'explorer' && (
          <ExplorerPage
            dataSource={dataSource}
            realDataset={realDataset}
            availableRegions={availableRegions}
            activeRegionId={activeRegionId}
            onSelectRegion={(rid) => handleSelectRegion(rid, false)}
            onSelectFixtureRegion={(rid) => handleSelectFixtureRegion(rid, false)}
            missingDetails={missingDetails}
            selectedRealExposure={selectedRealExposure}
            onSelectRealExposure={handleSelectRealExposure}
            selectedRealSource={selectedRealSource}
            onSelectRealSource={handleSelectRealSource}
            onCursorMove={handleCursorMove}
            currentTarget={currentTarget}
            onSelectTarget={handleSelectTarget}
            currentBand={currentBand}
            onSelectBand={handleSelectBand}
            coordFormat={coordFormat}
            fluxUnit={fluxUnit}
            colormap={colormap}
          />
        )}

        {activeTab === 'moving-objects' && (
          <MovingObjectsPage
            dataSource={dataSource}
            realDataset={realDataset}
          />
        )}

        {activeTab === 'method' && (
          <MethodPage
            dataSource={dataSource}
            realDataset={realDataset}
          />
        )}

        {activeTab === 'about' && (
          <AboutPage dataSource={dataSource} />
        )}
      </div>

      {/* Synchronized Telemetry Footer */}
      <Footer cursorStatus={cursorStatus} />

      {/* Dialog Modals */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        coordFormat={coordFormat}
        setCoordFormat={setCoordFormat}
        fluxUnit={fluxUnit}
        setFluxUnit={setFluxUnit}
        colormap={colormap}
        setColormap={setColormap}
        localCache={localCache}
        setLocalCache={setLocalCache}
      />

      <ProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        currentTarget={currentTarget}
        onSelectTarget={handleSelectTarget}
      />

      <PinpointModal
        isOpen={isPinpointOpen}
        onClose={() => setIsPinpointOpen(false)}
        onApplyCoords={handleApplyPinpointCoords}
      />

      <FilterPopover
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        onSelectBand={handleSelectBand}
      />
    </div>
  );
}
