import React, { useId } from 'react';

/**
 * The Ararat logo.
 *
 * The geometry here is the same as public/icons/icon.svg — that file is what
 * scripts/generate-icons.mjs rasterises into the favicon, the PWA icons and the
 * Play listing artwork, so if a path changes it has to change in both places or
 * the app and its launcher icon stop agreeing.
 *
 * The mark is a diamond split at the waist: the gold mountain on top (main
 * summit, lesser summit notched into the right arm) and the teal shield below,
 * with the blade running down its centre.
 *
 *   <BrandLogo />                          — bare mark, 36px
 *   <BrandLogo tile />                     — mark on its navy tile
 *   <BrandLogo size={44} tile wordmark />  — the full lockup
 *
 * The mark is drawn for a dark ground: gold and teal on navy. On a light page
 * use `tile`, which supplies that ground, rather than dropping the bare mark
 * onto white where the gradients lose most of their contrast.
 */

/** viewBox slice holding just the mark, with no tile padding around it. */
const MARK_BOX = '73 46 366 423';

/**
 * The three shapes, shared with brandMarkSvg() below so the printed letterheads
 * and the on-screen logo can never drift apart.
 *
 * Mountain: outer contour to the summit and back down, then home along the
 * underside — the zig at 294/309/330 is the saddle that cuts the lesser peak
 * out of the right arm.
 *
 * Shield and blade each carry a second subpath that fill-rule evenodd subtracts
 * rather than paints: the hollow centre, and the slit at the blade's head. The
 * slit is cut rather than painted so it stays transparent — the mark has to sit
 * on navy, on its own tile, and on white alike.
 */
const MOUNTAIN = 'M83 224 L256 56 L429 224 L347 224 L330 210 L309 160 L294 181 L256 151 L167 224 Z';
const SHIELD   = 'M83 235 L429 235 L256 459 Z M158 275 L354 275 Q332 342 256 418 Q182 344 158 275 Z';
const BLADE    = 'M231 235 L281 235 L272 360 L256 453 L240 360 Z M252 235 L260 235 L260 276 L252 276 Z';

/** [id, x1, y1, x2, y2, ...stops] — userSpaceOnUse so the ramp runs across the
 *  whole mark instead of restarting inside each shape. */
const GRADIENTS = [
  ['gold',  96, 56, 424, 232, [[0, '#e8bf7d'], [0.5, '#cb964a'], [1, '#a96f2b']]],
  ['teal',  120, 452, 416, 244, [[0, '#177c74'], [0.45, '#1aa295'], [1, '#19c4b2']]],
  ['blade', 233, 235, 279, 452, [[0, '#14837c'], [1, '#15a99b']]],
];

const TILE_STOPS = [[0, '#122c4a'], [0.55, '#0c2037'], [1, '#081726']];

/** The wordmark as it is drawn in the logo: caps, geometric, widely tracked. */
export const WORDMARK_FONT = 'Futura, Century Gothic, Segoe UI, Arial, sans-serif';
/** The mark's own gold. Use GOLD_DEEP for the wordmark on a light ground —
 *  #cb964a only reaches 2.5:1 on white. */
export const GOLD = '#cb964a';
export const GOLD_DEEP = '#a96f2b';

/**
 * The same mark as an HTML string, for the documents the app prints through a
 * popup window (invoices, statements). Those are built as raw HTML, so they
 * cannot mount a React component — and an <img> pointing at /icons/icon.svg
 * would depend on a blank popup inheriting its opener's base URL, which is not
 * something to bet a printed invoice on.
 *
 * `uid` keeps the gradient ids unique if a document ever embeds two marks.
 */
export const brandMarkSvg = ({ size = 46, tile = true, uid = 'doc' } = {}) => {
  const gradients = GRADIENTS.map(([id, x1, y1, x2, y2, stops]) =>
    `<linearGradient id="${id}-${uid}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">`
    + stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')
    + '</linearGradient>').join('');

  const tileGradient = tile
    ? `<linearGradient id="bg-${uid}" x1="0" y1="0" x2="1" y2="1">`
      + TILE_STOPS.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')
      + '</linearGradient>'
    : '';

  return `<svg width="${size}" height="${size}" viewBox="${tile ? '0 0 512 512' : MARK_BOX}"`
    + ` xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Ararat">`
    + `<defs>${tileGradient}${gradients}</defs>`
    + (tile ? `<rect width="512" height="512" rx="112" fill="url(#bg-${uid})"/>` : '')
    + `<path fill="url(#gold-${uid})" d="${MOUNTAIN}"/>`
    + `<path fill="url(#teal-${uid})" fill-rule="evenodd" d="${SHIELD}"/>`
    + `<path fill="url(#blade-${uid})" fill-rule="evenodd" d="${BLADE}"/>`
    + '</svg>';
};

const BrandLogo = ({
  size      = 36,
  tile      = false,
  wordmark  = false,
  tagline   = null,
  /** Colour of the ARARAT wordmark. Defaults to the logo's own gold. */
  wordmarkColor = null,
  taglineColor  = '#c08f47',
  className = '',
  style     = {},
  title     = 'Ararat',
}) => {
  // Gradients live in the document, not the component, so two logos on one page
  // would otherwise share (and fight over) the same ids.
  const uid = useId().replace(/:/g, '');
  const ref = (id) => `url(#ar-${id}-${uid})`;

  const mark = (
    <svg
      width={size}
      height={size}
      viewBox={tile ? '0 0 512 512' : MARK_BOX}
      role="img"
      aria-label={title}
      style={{ flexShrink: 0, display: 'block' }}
    >
      <defs>
        {tile && (
          <linearGradient id={`ar-bg-${uid}`} x1="0" y1="0" x2="1" y2="1">
            {TILE_STOPS.map(([offset, color]) => (
              <stop key={offset} offset={offset} stopColor={color} />
            ))}
          </linearGradient>
        )}
        {GRADIENTS.map(([id, x1, y1, x2, y2, stops]) => (
          <linearGradient
            key={id}
            id={`ar-${id}-${uid}`}
            gradientUnits="userSpaceOnUse"
            x1={x1} y1={y1} x2={x2} y2={y2}
          >
            {stops.map(([offset, color]) => <stop key={offset} offset={offset} stopColor={color} />)}
          </linearGradient>
        ))}
      </defs>

      {tile && <rect width="512" height="512" rx="112" fill={ref('bg')} />}

      <path fill={ref('gold')} d={MOUNTAIN} />
      <path fill={ref('teal')} fillRule="evenodd" d={SHIELD} />
      <path fill={ref('blade')} fillRule="evenodd" d={BLADE} />
    </svg>
  );

  if (!wordmark) {
    return className || Object.keys(style).length
      ? <span className={className} style={{ display: 'inline-flex', ...style }}>{mark}</span>
      : mark;
  }

  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(size * 0.3), ...style }}
    >
      {mark}
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span
          style={{
            // The wordmark is set in caps and widely tracked, the way it is
            // drawn in the logo itself.
            fontFamily:    WORDMARK_FONT,
            fontWeight:    600,
            fontSize:      Math.round(size * 0.48),
            letterSpacing: '0.22em',
            lineHeight:    1.05,
            // Tracking adds the gap after the last letter too, which throws the
            // lockup off centre; pulling it back restores the optical balance.
            marginRight:   '-0.22em',
            color:         wordmarkColor || GOLD,
            whiteSpace:    'nowrap',
          }}
        >
          ARARAT
        </span>
        {tagline && (
          <span
            style={{
              fontFamily:    'Open Sans, Segoe UI, Arial, sans-serif',
              fontSize:      Math.max(9, Math.round(size * 0.23)),
              letterSpacing: '0.04em',
              lineHeight:    1.3,
              marginTop:     2,
              color:         taglineColor,
              whiteSpace:    'nowrap',
              overflow:      'hidden',
              textOverflow:  'ellipsis',
            }}
          >
            {tagline}
          </span>
        )}
      </span>
    </span>
  );
};

export default BrandLogo;
