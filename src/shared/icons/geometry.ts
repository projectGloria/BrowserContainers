// Pure geometry for the icon pipeline, kept DOM-free so it's unit-testable in Node.

export interface Crop {
  sx: number;
  sy: number;
  side: number;
}

// Center "cover" crop: largest centered square. A 1000x600 banner becomes the middle 600x600.
// Letterboxing (contain) would waste most of a 16px favicon on padding, so cover is the right default.
export function coverCrop(width: number, height: number): Crop {
  const side = Math.min(width, height);
  return {
    sx: Math.floor((width - side) / 2),
    sy: Math.floor((height - side) / 2),
    side,
  };
}

// Sizes to pass through when shrinking `from` -> `to`, halving each time.
// One-shot 1000->16 downscaling samples ~1 in 62 source pixels: moire and jaggies.
// Halving keeps every step a 2:1 box-ish filter, which is what mipmapping does on GPUs.
// The final step may be < 2:1 (e.g. 64 -> 48), which bilinear handles cleanly.
export function stepDownChain(from: number, to: number): number[] {
  if (to >= from) return [to];
  const chain: number[] = [];
  let cur = from;
  while (cur / 2 >= to) {
    cur = Math.floor(cur / 2);
    chain.push(cur);
  }
  if (chain.at(-1) !== to) chain.push(to);
  return chain;
}

// Intermediate working resolution: big enough for the 128px output to be crisp after one
// halving, small enough that an 8000x8000 upload doesn't allocate a 256MB canvas.
export const WORKING_SIZE = 256;
