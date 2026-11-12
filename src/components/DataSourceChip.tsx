import React from 'react';

interface DataSourceChipProps {
  dataSource: 'real' | 'fixture';
  missingDetails?: {
    files: string[];
    keys: string[];
    error?: string;
  } | null;
  className?: string;
}

export const DataSourceChip: React.FC<DataSourceChipProps> = ({
  dataSource,
  missingDetails,
  className = '',
}) => {
  const isReal = dataSource === 'real';

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-data-mono-sm transition-all ${
      isReal
        ? 'bg-secondary/15 text-secondary border-secondary/40 shadow-sm'
        : 'bg-amber-500/15 text-amber-300 border-amber-500/40'
    } ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${isReal ? 'bg-secondary' : 'bg-amber-400'}`}></span>
      <span className="font-medium">
        {isReal ? 'Real SPHEREx QR2' : 'Synthetic fixture'}
      </span>

      {!isReal && missingDetails && (missingDetails.files.length > 0 || missingDetails.keys.length > 0) && (
        <span
          title={`Fallback active. Missing: ${[...missingDetails.files, ...missingDetails.keys].join(', ')}`}
          className="text-[10px] text-amber-200/80 cursor-help underline decoration-dotted ml-1"
        >
          (fallback)
        </span>
      )}
    </div>
  );
};
