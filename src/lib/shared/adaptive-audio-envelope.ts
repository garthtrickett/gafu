const ENVELOPE_SAMPLE_RATE_HZ = 10;

const percentile = (sorted: readonly number[], fraction: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * fraction)))] ?? 0;

export const pcm16ToEnvelope = (samples: Int16Array, inputSampleRate = 1000): Float64Array => {
  const samplesPerFrame = Math.max(1, Math.round(inputSampleRate / ENVELOPE_SAMPLE_RATE_HZ));
  const frameCount = Math.floor(samples.length / samplesPerFrame);
  const raw = new Float64Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let squares = 0;
    const start = frame * samplesPerFrame;
    for (let sample = 0; sample < samplesPerFrame; sample += 1) {
      const value = (samples[start + sample] ?? 0) / 32768;
      squares += value * value;
    }
    raw[frame] = Math.log1p(Math.sqrt(squares / samplesPerFrame) * 100);
  }
  const smoothed = Array.from(raw, (_, index) => {
    let sum = 0;
    let count = 0;
    for (let neighbor = Math.max(0, index - 1); neighbor <= Math.min(raw.length - 1, index + 1); neighbor += 1) {
      sum += raw[neighbor] ?? 0;
      count += 1;
    }
    return sum / count;
  });
  const sorted = [...smoothed].sort((left, right) => left - right);
  const floor = percentile(sorted, 0.15);
  const ceiling = percentile(sorted, 0.9);
  const range = Math.max(0.0001, ceiling - floor);
  return Float64Array.from(smoothed, (value) => Math.min(1, Math.max(0, (value - floor) / range)));
};

export const pcm16LittleEndianBytesToEnvelope = (
  bytes: Uint8Array,
  inputSampleRate = 1000,
): Float64Array => {
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const samples = new Int16Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = view.getInt16(index * 2, true);
  }
  return pcm16ToEnvelope(samples, inputSampleRate);
};
