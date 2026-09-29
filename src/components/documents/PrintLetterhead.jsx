import React from 'react';
import { useLetterhead } from '../../hooks/useLetterhead';
import { letterheadLines } from '../../utils/letterhead';

/**
 * The business's letterhead for screens that print themselves with
 * window.print(): invisible on screen, and the first thing on the paper.
 *
 * Drop it at the top of the region a screen prints. It renders nothing until
 * the letterhead has loaded, and nothing at all for an account that has no
 * tenant (the platform operator).
 */
const PrintLetterhead = ({ className = '' }) => {
  const { letterhead } = useLetterhead();
  if (!letterhead?.name) return null;

  return (
    <div className={`hidden print:flex items-center gap-4 border-b-2 border-black pb-3 mb-4 text-black ${className}`}>
      {letterhead.logo && (
        <img src={letterhead.logo.src} alt="" className="h-16 w-auto max-w-[160px] object-contain" />
      )}
      <div className="min-w-0">
        <div className="text-xl font-bold leading-tight">{letterhead.name}</div>
        {letterhead.motto && <div className="text-xs italic text-gray-600">{letterhead.motto}</div>}
        {letterheadLines(letterhead).map((line) => (
          <div key={line} className="text-xs text-gray-700">{line}</div>
        ))}
      </div>
    </div>
  );
};

export default PrintLetterhead;
