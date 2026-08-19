export function preserveLocalPlayback(stream: MediaStream, createContext: () => AudioContext = () => new AudioContext()): AudioContext {
  const output = createContext();
  const source = output.createMediaStreamSource(stream);
  source.connect(output.destination);
  void output.resume();
  return output;
}
