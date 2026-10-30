import { describe, expect, it } from 'vitest';
import { coverCrop, stepDownChain } from './geometry';

describe('coverCrop', () => {
  it('keeps squares intact', () => {
    expect(coverCrop(1000, 1000)).toEqual({ sx: 0, sy: 0, side: 1000 });
  });
  it('centers landscape crops', () => {
    expect(coverCrop(1000, 600)).toEqual({ sx: 200, sy: 0, side: 600 });
  });
  it('centers portrait crops', () => {
    expect(coverCrop(300, 901)).toEqual({ sx: 0, sy: 300, side: 300 });
  });
});

describe('stepDownChain', () => {
  it('halves until the last step', () => {
    expect(stepDownChain(256, 16)).toEqual([128, 64, 32, 16]);
  });
  it('ends with a sub-2x step for non power-of-two targets', () => {
    expect(stepDownChain(256, 48)).toEqual([128, 64, 48]);
  });
  it('upscales tiny inputs in a single step', () => {
    expect(stepDownChain(20, 128)).toEqual([128]);
  });
  it('is a single step when already within 2x', () => {
    expect(stepDownChain(200, 128)).toEqual([128]);
  });
});
