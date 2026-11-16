import { describe, expect, it, vi } from 'vitest';
import { createAudioMixer } from './audio-mixer.js';

describe('createAudioMixer', () => {
  it('connects tab audio to destination and headphones playback', () => {
    const tabConnect = vi.fn();
    const destinationStream = { id: 'mixed-stream', getTracks: vi.fn(() => []) } as unknown as MediaStream;
    const contextDestination = { id: 'headphones' };
    const mediaStreamDestination = { destination: 'rec', stream: destinationStream };

    const tabSource = { connect: tabConnect };
    const tabTrack = { stop: vi.fn() };
    const tabStream = { getTracks: vi.fn(() => [tabTrack]) } as unknown as MediaStream;

    const context = {
      destination: contextDestination,
      createMediaStreamSource: vi.fn((stream) => (stream === tabStream ? tabSource : null)),
      createMediaStreamDestination: vi.fn(() => mediaStreamDestination),
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      state: 'running',
    };

    const mixer = createAudioMixer({
      tabStream,
      createContext: () => context as unknown as AudioContext,
    });

    expect(mixer.mixedStream).toBe(destinationStream);
    expect(mixer.hasMicrophone).toBe(false);
    expect(context.createMediaStreamSource).toHaveBeenCalledWith(tabStream);
    expect(tabConnect).toHaveBeenCalledWith(mediaStreamDestination);
    expect(tabConnect).toHaveBeenCalledWith(contextDestination);
  });

  it('connects microphone audio only to the recording destination, avoiding headphone echo', () => {
    const tabConnect = vi.fn();
    const micConnect = vi.fn();
    const destinationStream = { id: 'mixed-stream', getTracks: vi.fn(() => []) } as unknown as MediaStream;
    const contextDestination = { id: 'headphones' };
    const mediaStreamDestination = { destination: 'rec', stream: destinationStream };

    const tabSource = { connect: tabConnect };
    const micSource = { connect: micConnect };

    const tabTrack = { stop: vi.fn() };
    const micTrack = { stop: vi.fn() };
    const tabStream = { getTracks: vi.fn(() => [tabTrack]) } as unknown as MediaStream;
    const micStream = {
      getAudioTracks: vi.fn(() => [micTrack]),
      getTracks: vi.fn(() => [micTrack]),
    } as unknown as MediaStream;

    const context = {
      destination: contextDestination,
      createMediaStreamSource: vi.fn((stream) => {
        if (stream === tabStream) return tabSource;
        if (stream === micStream) return micSource;
        return null;
      }),
      createMediaStreamDestination: vi.fn(() => mediaStreamDestination),
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      state: 'running',
    };

    const mixer = createAudioMixer({
      tabStream,
      micStream,
      createContext: () => context as unknown as AudioContext,
    });

    expect(mixer.hasMicrophone).toBe(true);
    // Tab connects to recording destination AND headphones
    expect(tabConnect).toHaveBeenCalledWith(mediaStreamDestination);
    expect(tabConnect).toHaveBeenCalledWith(contextDestination);

    // Mic connects ONLY to recording destination, NEVER to headphones
    expect(micConnect).toHaveBeenCalledWith(mediaStreamDestination);
    expect(micConnect).not.toHaveBeenCalledWith(contextDestination);
  });

  it('stops all tracks and closes audio context on close()', async () => {
    const tabTrack = { stop: vi.fn() };
    const micTrack = { stop: vi.fn() };
    const mixedTrack = { stop: vi.fn() };

    const tabStream = { getTracks: vi.fn(() => [tabTrack]) } as unknown as MediaStream;
    const micStream = {
      getAudioTracks: vi.fn(() => [micTrack]),
      getTracks: vi.fn(() => [micTrack]),
    } as unknown as MediaStream;
    const destinationStream = {
      id: 'mixed-stream',
      getTracks: vi.fn(() => [mixedTrack]),
    } as unknown as MediaStream;

    const context = {
      destination: {},
      createMediaStreamSource: vi.fn(() => ({ connect: vi.fn() })),
      createMediaStreamDestination: vi.fn(() => ({ stream: destinationStream })),
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      state: 'running',
    };

    const mixer = createAudioMixer({
      tabStream,
      micStream,
      createContext: () => context as unknown as AudioContext,
    });

    await mixer.close();

    expect(tabTrack.stop).toHaveBeenCalled();
    expect(micTrack.stop).toHaveBeenCalled();
    expect(mixedTrack.stop).toHaveBeenCalled();
    expect(context.close).toHaveBeenCalled();
  });
});
