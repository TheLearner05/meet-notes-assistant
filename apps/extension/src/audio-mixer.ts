export interface AudioMixerOptions {
  tabStream: MediaStream;
  micStream?: MediaStream;
  createContext?: () => AudioContext;
}

export interface AudioMixer {
  mixedStream: MediaStream;
  audioContext: AudioContext;
  hasMicrophone: boolean;
  close(): Promise<void>;
}

export function createAudioMixer(options: AudioMixerOptions): AudioMixer {
  const createContext = options.createContext ?? (() => new AudioContext());
  const context = createContext();
  const destination = context.createMediaStreamDestination();

  // Route tab audio to the recording destination AND to the local speakers/headphones
  const tabSource = context.createMediaStreamSource(options.tabStream);
  tabSource.connect(destination);
  tabSource.connect(context.destination);

  let hasMicrophone = false;
  if (options.micStream && options.micStream.getAudioTracks().length > 0) {
    const micSource = context.createMediaStreamSource(options.micStream);
    // Connect microphone ONLY to the recording destination, NEVER to local speakers/headphones
    micSource.connect(destination);
    hasMicrophone = true;
  }

  void context.resume();

  return {
    mixedStream: destination.stream,
    audioContext: context,
    hasMicrophone,
    async close() {
      options.tabStream.getTracks().forEach((track) => track.stop());
      options.micStream?.getTracks().forEach((track) => track.stop());
      destination.stream.getTracks().forEach((track) => track.stop());
      if (context.state !== 'closed') {
        await context.close();
      }
    },
  };
}
