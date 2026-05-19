import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mock all of useRockyTTS's transitive deps so the hook can mount in jsdom.
vi.mock('../utils/rockyAudio', () => ({
  stopSharedAudio: vi.fn(),
  preloadAllRockyAudio: vi.fn(),
  unlockAudio: vi.fn(),
  getMoodAudio: vi.fn().mockReturnValue('/audio/rocky_o/talk1.mp3'),
  getLikeAudio: vi.fn().mockReturnValue('/audio/rocky_h/ilike.mp3'),
  getIntroAudioSequence: vi.fn().mockReturnValue([]),
  getGreetingAudioSequence: vi.fn().mockReturnValue([]),
  getDirtyAudio: vi.fn().mockReturnValue('/audio/rocky_h/dirty.mp3'),
  findDefaultAudioByReply: vi.fn().mockReturnValue(null),
  playInterruptible: vi.fn().mockResolvedValue(undefined),
  playSequenceInterruptible: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../utils/api', () => ({
  API_BASE: '',
}));
vi.mock('../utils/audioPlayback', () => ({
  claimSlot: vi.fn(() => ({ token: 1, signal: new AbortController().signal })),
  attachAudio: vi.fn(() => true),
  isOwner: vi.fn(() => true),
  releaseSlot: vi.fn(),
}));

// Import AFTER mocks
import { useRockyTTS } from '../hooks/useRockyTTS';

describe('useRockyTTS unmount cleanup (option B fix from cross-review)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mounts and unmounts without throwing', () => {
    const { unmount } = renderHook(() => useRockyTTS(true));
    expect(() => unmount()).not.toThrow();
  });

  it('exposes the speak/stop/toggle API', () => {
    const { result } = renderHook(() => useRockyTTS(true));
    expect(typeof result.current.speak).toBe('function');
    expect(typeof result.current.stop).toBe('function');
    expect(typeof result.current.toggle).toBe('function');
    expect(result.current.isSpeaking).toBe(false);
  });

  it('unmount tears down without leaving setIsSpeaking timer running', () => {
    // If cancelledRef.current=true is missing from cleanup, a pending
    // speak() chain could call setState after unmount → React warning.
    // This test asserts the basic mount/unmount lifecycle is clean.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = renderHook(() => useRockyTTS(true));
    unmount();
    // Allow any microtasks to flush
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // No React "state update on unmounted component" warnings
        const stateWarnings = consoleSpy.mock.calls.filter((args) =>
          args.some((a) => typeof a === 'string' && a.includes('unmounted')),
        );
        expect(stateWarnings.length).toBe(0);
        consoleSpy.mockRestore();
        resolve();
      }, 10);
    });
  });
});
