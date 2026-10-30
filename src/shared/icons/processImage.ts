import { ICON_SIZES, type IconSize } from '../types';
import { coverCrop, stepDownChain, WORKING_SIZE } from './geometry';

export const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_DIMENSION = 16384; // Chromium's canvas side limit; anything bigger can't be drawn anyway.

export class IconError extends Error {
  constructor(
    public readonly code: 'too-large' | 'not-image' | 'decode-failed' | 'too-many-pixels',
    message: string,
  ) {
    super(message);
  }
}

type Source = ImageBitmap | HTMLImageElement;

const isSvg = (f: Blob & { name?: string }) =>
  f.type === 'image/svg+xml' || /\.svg$/i.test(f.name ?? '');

// createImageBitmap(Blob) rejects SVG in Chromium (it has no intrinsic raster), so SVG goes
// through an <img> element. Only usable in DOM contexts (options page), which is where uploads happen.
async function decodeSvg(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // Safe to revoke after decode(): the decoded image is retained by the element, not the URL.
    URL.revokeObjectURL(url);
  }
}

async function decode(file: Blob): Promise<{ src: Source; w: number; h: number }> {
  try {
    if (isSvg(file)) {
      const img = await decodeSvg(file);
      // viewBox-only SVGs report 0x0; treat them as square so the crop math stays sane.
      const w = img.naturalWidth || WORKING_SIZE;
      const h = img.naturalHeight || WORKING_SIZE;
      return { src: img, w, h };
    }
    // Animated GIF/WebP/APNG: createImageBitmap takes the first frame, which is what we want.
    const bmp = await createImageBitmap(file);
    return { src: bmp, w: bmp.width, h: bmp.height };
  } catch {
    throw new IconError(
      'decode-failed',
      'This browser could not decode that image (HEIC/TIFF are not supported by Chromium).',
    );
  }
}

function draw(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, out: number) {
  const canvas = new OffscreenCanvas(out, out);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new IconError('decode-failed', '2D canvas unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, out, out);
  return canvas;
}

// Shrink through a halving chain so each draw is at most ~2:1 (see geometry.stepDownChain).
function shrink(base: OffscreenCanvas, to: number): OffscreenCanvas {
  let cur = base;
  for (const size of stepDownChain(base.width, to)) {
    cur = draw(cur, 0, 0, cur.width, cur.height, size);
  }
  return cur;
}

/**
 * Any image -> square PNGs at 16/32/48/128.
 * The original is never stored: a 1000x1000 upload becomes ~4 small PNGs (usually < 30KB total).
 */
export async function processImage(file: File): Promise<Record<IconSize, Blob>> {
  if (file.size > MAX_INPUT_BYTES) {
    throw new IconError('too-large', `Image is ${(file.size / 1e6).toFixed(1)}MB; max is 25MB.`);
  }
  if (file.type && !file.type.startsWith('image/')) {
    throw new IconError('not-image', `"${file.type}" is not an image.`);
  }

  const { src, w, h } = await decode(file);
  try {
    if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
      throw new IconError('too-many-pixels', `Image is ${w}x${h}; max side is ${MAX_DIMENSION}px.`);
    }
    const { sx, sy, side } = coverCrop(w, h);

    // Crop + first resize. For bitmaps, let createImageBitmap do it with resizeQuality:'high',
    // which Chromium implements with a proper multi-tap filter (better than one drawImage).
    // Never upscale tiny inputs past their own size here; upscaling happens per-output below.
    const workSide = Math.min(side, WORKING_SIZE);
    let base: OffscreenCanvas;
    if (src instanceof ImageBitmap) {
      const cropped = await createImageBitmap(src, sx, sy, side, side, {
        resizeWidth: workSide,
        resizeHeight: workSide,
        resizeQuality: 'high',
      });
      base = draw(cropped, 0, 0, workSide, workSide, workSide);
      cropped.close();
    } else {
      // SVG is vector: rasterize straight at working size, no quality loss.
      base = draw(src, sx, sy, side, side, WORKING_SIZE);
    }

    const out = {} as Record<IconSize, Blob>;
    for (const size of ICON_SIZES) {
      const canvas = shrink(base, size);
      out[size] = await canvas.convertToBlob({ type: 'image/png' });
    }
    return out;
  } finally {
    // ImageBitmaps hold decoded pixels outside the JS heap; close() frees them immediately
    // instead of waiting for GC (matters for a 25MB JPEG decoded to ~100MB RGBA).
    if (src instanceof ImageBitmap) src.close();
  }
}
