/**
 * LOGO UPLOAD PREPARATION
 *
 * Whatever a business uploads — a 4 MB phone photo of its signboard, a web
 * SVG, a WEBP from its designer — every document renderer here can embed
 * exactly two formats (jsPDF reads PNG and JPEG, and nothing else). So the
 * file is redrawn in the browser before it is stored:
 *
 *   • scaled to at most LOGO_MAX_EDGE px on its long side. A logo prints about
 *     2 cm tall; 512 px is well past print resolution for that, and it keeps
 *     every receipt PDF small. Bitmaps are never scaled UP; an SVG is drawn at
 *     full size, since it has no pixels to lose.
 *   • stripped of fully transparent margins, which most exported logos carry
 *     and which would otherwise shrink the mark inside its space on the page.
 *   • saved as PNG, which keeps transparency — or, for an opaque image too big
 *     as PNG (a photograph), as JPEG on white.
 *
 * Browser-only: it needs a canvas. The pure pieces (validation, the
 * transparent-margin scan, sizing) are exported for tests.
 */

export const LOGO_MAX_EDGE = 512;
export const LOGO_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Stay under the bucket's 1 MB limit with room to spare. */
export const LOGO_MAX_STORED_BYTES = 900 * 1024;

export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';
const ACCEPTED = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml']);

/** A reason the file cannot be used, or '' when it can. */
export const logoFileProblem = (file) => {
  if (!file) return 'Choose an image file.';
  if (!ACCEPTED.has(String(file.type || '').toLowerCase())) {
    return 'Use a PNG, JPEG, WEBP or SVG image.';
  }
  if (file.size > LOGO_MAX_UPLOAD_BYTES) return 'That image is larger than 5 MB. Choose a smaller file.';
  if (file.size === 0) return 'That file is empty.';
  return '';
};

/**
 * The size to draw at: the long edge capped at `maxEdge`. Bitmaps keep their
 * own size when already smaller; `upscale` (for SVG) fills the cap instead.
 */
export const targetSize = (width, height, { maxEdge = LOGO_MAX_EDGE, upscale = false } = {}) => {
  // An SVG with no intrinsic size reports 0×0; draw it into the full square
  // and let the transparent-margin trim find the mark.
  const w = Math.max(1, Math.round(Number(width) || 0) || maxEdge);
  const h = Math.max(1, Math.round(Number(height) || 0) || maxEdge);
  const long = Math.max(w, h);
  const scale = upscale ? maxEdge / long : Math.min(1, maxEdge / long);
  return {
    width:  Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
};

/**
 * The bounding box of every pixel that is not (nearly) fully transparent, in
 * an RGBA buffer. Null when the image is entirely transparent. `alphaFloor`
 * ignores the faint halo anti-aliasing leaves around an exported mark.
 */
export const opaqueBounds = (data, width, height, { alphaFloor = 8 } = {}) => {
  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (data[row + x * 4 + 3] > alphaFloor) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return null;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
};

/** True when any pixel is less than fully opaque. */
export const hasTransparency = (data) => {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
};

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('That file could not be read as an image.'));
  img.src = src;
});

const canvasToBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
  canvas.toBlob(
    (blob) => (blob ? resolve(blob) : reject(new Error('The image could not be converted.'))),
    type,
    quality,
  );
});

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('The image could not be read back.'));
  reader.readAsDataURL(blob);
});

const makeCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/**
 * Turn an uploaded file into the stored logo.
 *
 * Resolves to { blob, width, height, extension, contentType, image }, where
 * `image` is the result as a letterhead logo — { src: data URL, width, height,
 * format } — so the preview can show exactly what will be stored before it is
 * saved, through the same renderers the documents use.
 */
export const prepareLogo = async (file) => {
  const problem = logoFileProblem(file);
  if (problem) throw new Error(problem);

  const isSvg = String(file.type).toLowerCase() === 'image/svg+xml';
  const source = URL.createObjectURL(file);
  try {
    const img = await loadImage(source);
    const { width, height } = targetSize(img.naturalWidth, img.naturalHeight, { upscale: isSvg });

    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot prepare images. Try another browser.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);

    // Trim transparent margins so the mark fills its space on the page.
    let out = canvas;
    let pixels = null;
    try {
      pixels = ctx.getImageData(0, 0, width, height).data;
    } catch {
      pixels = null;        // a tainted canvas cannot be read; keep it whole
    }
    const transparent = pixels ? hasTransparency(pixels) : false;
    if (pixels && transparent) {
      const box = opaqueBounds(pixels, width, height);
      if (!box) throw new Error('That image is completely transparent.');
      if (box.width < width || box.height < height) {
        out = makeCanvas(box.width, box.height);
        out.getContext('2d').drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
      }
    }

    let blob = await canvasToBlob(out, 'image/png');
    let extension = 'png';
    let contentType = 'image/png';

    // A photograph as PNG can outgrow the bucket. With no transparency to
    // keep, JPEG on white holds it at a fraction of the size.
    if (blob.size > LOGO_MAX_STORED_BYTES && !transparent) {
      const flat = makeCanvas(out.width, out.height);
      const fctx = flat.getContext('2d');
      fctx.fillStyle = '#ffffff';
      fctx.fillRect(0, 0, flat.width, flat.height);
      fctx.drawImage(out, 0, 0);
      blob = await canvasToBlob(flat, 'image/jpeg', 0.9);
      extension = 'jpg';
      contentType = 'image/jpeg';
    }
    if (blob.size > LOGO_MAX_STORED_BYTES) {
      throw new Error('That image is too detailed to use as a logo. Try a simpler PNG.');
    }

    return {
      blob,
      width: out.width,
      height: out.height,
      extension,
      contentType,
      image: {
        src: await blobToDataUrl(blob),
        width: out.width,
        height: out.height,
        format: extension === 'jpg' ? 'JPEG' : 'PNG',
      },
    };
  } finally {
    URL.revokeObjectURL(source);
  }
};

export default prepareLogo;
