import { getIcon } from '../shared/db';
import { COLOR_HEX, type Container } from '../shared/types';

type IconData = Record<16 | 32, ImageData>;

// Keyed by id+iconVersion, so bumping iconVersion naturally misses the cache:
// no explicit invalidation path to forget.
const cache = new Map<string, Promise<IconData>>();

const SIZES = [16, 32] as const;

async function blobToImageData(blob: Blob, size: number): Promise<ImageData> {
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(size, size);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, size, size);
  bmp.close();
  return ctx.getImageData(0, 0, size, size);
}

// Fallback when no custom icon: colored disc + initial. Drawn in the SW with OffscreenCanvas,
// which supports text in workers in Chromium.
function letterIcon(letter: string, color: string, size: number): ImageData {
  const c = new OffscreenCanvas(size, size);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `600 ${Math.round(size * 0.6)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter.toUpperCase(), size / 2, size / 2 + size * 0.04);
  return ctx.getImageData(0, 0, size, size);
}

async function build(c: Container): Promise<IconData> {
  const icon = c.iconVersion > 0 ? await getIcon(c.id) : undefined;
  const entries = await Promise.all(
    SIZES.map(async (s) => [
      s,
      icon ? await blobToImageData(icon.sizes[s], s) : letterIcon(c.name[0] ?? '?', COLOR_HEX[c.color], s),
    ] as const),
  );
  return Object.fromEntries(entries) as IconData;
}

function iconFor(c: Container): Promise<IconData> {
  const key = `${c.id}:${c.iconVersion}:${c.color}:${c.name[0] ?? ''}`;
  let p = cache.get(key);
  if (!p) {
    p = build(c);
    // Failed decodes shouldn't be cached forever.
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

let defaultIcon: IconData | undefined;
function getDefaultIcon(): IconData {
  defaultIcon ??= { 16: letterIcon('G', '#5f6368', 16), 32: letterIcon('G', '#5f6368', 32) };
  return defaultIcon;
}

export async function paintDefaultAction(): Promise<void> {
  await chrome.action.setIcon({ imageData: getDefaultIcon() as never });
}

// Tab-scoped action state: the toolbar button shows the active tab's container.
export async function paintAction(tabId: number, c: Container | undefined): Promise<void> {
  try {
    if (!c) {
      await chrome.action.setIcon({ tabId, imageData: getDefaultIcon() as never });
      await chrome.action.setTitle({ tabId, title: 'Gloria Containers — no container' });
      return;
    }
    await chrome.action.setIcon({ tabId, imageData: (await iconFor(c)) as never });
    await chrome.action.setTitle({ tabId, title: `Container: ${c.name}` });
  } catch {
    /* tab closed mid-paint */
  }
}
