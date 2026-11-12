import React, { useState } from 'react';
import { DataSourceChip } from './DataSourceChip.tsx';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  localCache: boolean;
  setLocalCache: (val: boolean) => void;
  onOpenSettings: () => void;
  onOpenProfile?: () => void;
  dataSource: 'real' | 'fixture';
  missingDetails?: {
    files: string[];
    keys: string[];
    error?: string;
  } | null;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  localCache,
  setLocalCache,
  onOpenSettings,
  dataSource,
  missingDetails,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { id: 'home', label: 'Home' },
    { id: 'explorer', label: 'Explorer' },
    { id: 'moving-objects', label: 'Moving Objects' },
    { id: 'method', label: 'Method' },
    { id: 'about', label: 'About' },
  ];

  return (
    <header className="fixed top-0 left-0 w-full z-50 bg-surface-container-lowest/90 backdrop-blur-md border-b border-surface-container-high/60">
      <div className="h-14 w-full px-gutter flex items-center justify-between">
        {/* Brand & Nav */}
        <div className="flex items-center gap-space-lg">
          <button
            onClick={() => setActiveTab('home')}
            className="flex items-baseline gap-space-sm text-left focus:outline-none group cursor-pointer"
          >
            <span className="font-headline-sm text-headline-sm uppercase tracking-wider text-on-surface group-hover:text-primary transition-colors">
              SPHEREx Explorer
            </span>
            <span className="font-data-mono-sm text-data-mono-sm uppercase text-secondary px-space-xs py-0.5 rounded bg-surface-container border border-surface-container-high">
              QR2
            </span>
          </button>

          <div className="h-4 w-[1px] bg-outline-variant/30 hidden md:block"></div>

          <nav className="hidden md:flex items-center gap-space-lg h-14" data-active-classes="text-on-surface border-b-2 border-primary">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`h-full flex items-center px-1 font-label-editorial uppercase tracking-widest transition-colors cursor-pointer outline-none focus:outline-none focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 ${
                    isActive
                      ? 'text-on-surface border-b-2 border-primary font-bold'
                      : 'text-label-editorial text-on-surface-variant hover:text-on-surface border-b-2 border-transparent'
                  }`}
                  data-path={item.id}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right Status & Tools */}
        <div className="flex items-center gap-space-md">
          {/* Local Cache Toggle */}
          <button
            type="button"
            onClick={() => setLocalCache(!localCache)}
            title={localCache ? 'Local QR2 cache active (fast offline access)' : 'Direct IPAC live query active'}
            className="flex items-center gap-space-xs px-space-sm py-1 rounded bg-surface-container-low border border-surface-container-high hover:border-secondary/50 transition-colors cursor-pointer"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${localCache ? 'bg-secondary animate-pulse' : 'bg-outline'}`}></span>
            <span className="font-data-mono-sm text-data-mono-sm text-on-surface-variant">
              {localCache ? 'Local Cache' : 'Live Sync'}
            </span>
          </button>

          <DataSourceChip dataSource={dataSource} missingDetails={missingDetails} />

          <button
            onClick={onOpenSettings}
            className="text-on-surface-variant hover:text-on-surface transition-colors flex items-center justify-center p-1 rounded hover:bg-surface-container-high/40 cursor-pointer"
            type="button"
            title="Explorer Settings & Calibration"
          >
            <span className="material-symbols-outlined text-[18px]">settings</span>
          </button>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden text-on-surface-variant hover:text-on-surface p-1"
            type="button"
            aria-label="Toggle Navigation Menu"
          >
            <span className="material-symbols-outlined text-[20px]">
              {mobileMenuOpen ? 'close' : 'menu'}
            </span>
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-surface-container-lowest/95 border-b border-surface-container-high px-gutter py-3 flex flex-col gap-2">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id);
                setMobileMenuOpen(false);
              }}
              className={`text-left py-2 px-3 rounded font-label-editorial uppercase tracking-wider text-sm ${
                activeTab === item.id
                  ? 'bg-surface-container text-primary font-medium'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/30'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </header>
  );
};
