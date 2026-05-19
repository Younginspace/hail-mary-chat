import { describe, it, expect } from 'vitest';

describe('vitest harness smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });

  it('jsdom env has window', () => {
    expect(typeof window).toBe('object');
    expect(typeof document).toBe('object');
  });

  it('HTMLMediaElement is stubbed', () => {
    const audio = new Audio();
    expect(typeof audio.play).toBe('function');
    expect(typeof audio.pause).toBe('function');
  });
});
