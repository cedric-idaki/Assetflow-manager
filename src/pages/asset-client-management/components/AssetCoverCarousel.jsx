import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const imgSrc = (im) => (im ? (im.url || im.preview) : null);

/**
 * Image cover with a built-in carousel (prev/next arrows, counter, dots).
 * Pass overlay badges (year, status, location) as `children`.
 */
const AssetCoverCarousel = ({ images = [], alt = '', fallbackIcon = 'Box', heightClass = 'h-44', children }) => {
  const imgs  = (images || []).filter(im => imgSrc(im));
  const [i, setI] = useState(0);
  const has   = imgs.length > 0;
  const multi = imgs.length > 1;
  const idx   = Math.min(i, Math.max(0, imgs.length - 1));

  const go = (e, dir) => {
    e.stopPropagation();
    e.preventDefault();
    setI(p => (p + dir + imgs.length) % imgs.length);
  };

  return (
    <div className={`relative ${heightClass} bg-muted overflow-hidden`}>
      {has ? (
        <img src={imgSrc(imgs[idx])} alt={alt} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/40">
          <Icon name={fallbackIcon} size={40} color="var(--color-muted-foreground)" />
        </div>
      )}

      {multi && (
        <>
          <button
            onClick={(e) => go(e, -1)}
            aria-label="Previous photo"
            className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/45 hover:bg-black/65 text-white flex items-center justify-center transition-colors"
          >
            <Icon name="ChevronLeft" size={16} color="white" />
          </button>
          <button
            onClick={(e) => go(e, 1)}
            aria-label="Next photo"
            className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/45 hover:bg-black/65 text-white flex items-center justify-center transition-colors"
          >
            <Icon name="ChevronRight" size={16} color="white" />
          </button>
          <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full bg-black/55 text-white text-xs font-medium">
            {idx + 1}/{imgs.length}
          </span>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
            {imgs.map((_, k) => (
              <span key={k} className={`w-1.5 h-1.5 rounded-full transition-colors ${k === idx ? 'bg-white' : 'bg-white/50'}`} />
            ))}
          </div>
        </>
      )}

      {children}
    </div>
  );
};

export default AssetCoverCarousel;
