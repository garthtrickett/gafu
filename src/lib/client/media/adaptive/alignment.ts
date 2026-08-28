import type { TimingTransform } from "../../../shared/adaptive-media.ts";

const SAMPLE_RATE = 10;

const percentile = (sorted: readonly number[], fraction: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * fraction)))] ?? 0;

export const pcm16ToEnvelope = (samples: Int16Array, inputSampleRate = 1000): Float64Array => {
  const samplesPerFrame = Math.max(1, Math.round(inputSampleRate / SAMPLE_RATE));
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

const prefixSums = (values: ArrayLike<number>): Float64Array => {
  const prefix = new Float64Array(values.length + 1);
  for (let index = 0; index < values.length; index += 1) prefix[index + 1] = (prefix[index] ?? 0) + (values[index] ?? 0);
  return prefix;
};

const average = (prefix: Float64Array, startSeconds: number, endSeconds: number): number => {
  const maxIndex = prefix.length - 1;
  const start = Math.min(maxIndex, Math.max(0, Math.floor(startSeconds * SAMPLE_RATE)));
  const end = Math.min(maxIndex, Math.max(start + 1, Math.ceil(endSeconds * SAMPLE_RATE)));
  return ((prefix[end] ?? 0) - (prefix[start] ?? 0)) / Math.max(1, end - start);
};

interface TimedCue { readonly start: number; readonly end: number }
interface Candidate { readonly scale: number; readonly offset: number; readonly score: number }

const candidateScore = (
  prefix: Float64Array,
  duration: number,
  cues: readonly TimedCue[],
  scale: number,
  offset: number,
): number => {
  let score = 0;
  let totalWeight = 0;
  let included = 0;
  for (const cue of cues) {
    const start = cue.start * scale + offset;
    const end = cue.end * scale + offset;
    if (end <= 0 || start >= duration || end - start < 0.2) continue;
    const clippedStart = Math.max(0, start);
    const clippedEnd = Math.min(duration, end);
    const weight = Math.sqrt(Math.min(6, clippedEnd - clippedStart));
    const inside = average(prefix, clippedStart + 0.05, clippedEnd - 0.05);
    const before = average(prefix, clippedStart - 0.55, clippedStart - 0.08);
    const after = average(prefix, clippedEnd + 0.08, clippedEnd + 0.55);
    const onset = average(prefix, clippedStart, clippedStart + 0.35) - average(prefix, clippedStart - 0.4, clippedStart);
    const release = average(prefix, clippedEnd - 0.35, clippedEnd) - average(prefix, clippedEnd, clippedEnd + 0.4);
    score += (inside - 0.27 * ((before + after) / 2) + 0.16 * onset + 0.08 * release) * weight;
    totalWeight += weight;
    included += 1;
  }
  const coverage = included / Math.max(1, cues.length);
  if (coverage < 0.75 || totalWeight === 0) return Number.NEGATIVE_INFINITY;
  return score / totalWeight - (1 - coverage) * 0.4;
};

const sampledCues = (cues: readonly TimedCue[]): TimedCue[] => {
  const useful = cues.filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start && cue.end - cue.start <= 12);
  if (useful.length <= 320) return useful;
  return Array.from({ length: 320 }, (_, index) => useful[Math.floor(index * useful.length / 320)]!);
};

export interface AlignmentResult {
  readonly transform: TimingTransform;
  readonly confidence: number;
  readonly score: number;
  readonly duration: number;
  readonly cuesAnalyzed: number;
}

export const alignSubtitles = (envelope: ArrayLike<number>, rawCues: readonly TimedCue[]): AlignmentResult => {
  const cues = sampledCues(rawCues);
  if (envelope.length < 100 || cues.length < 8) throw new Error("Not enough audio or subtitle dialogue to align reliably.");
  const prefix = prefixSums(envelope);
  const duration = envelope.length / SAMPLE_RATE;
  const coarse: Candidate[] = [];
  const scales = new Set([1, 24 / 25, 25 / 24, 23.976 / 24, 24 / 23.976]);
  for (let scale = 0.96; scale <= 1.0421; scale += 0.002) scales.add(Number(scale.toFixed(6)));
  for (const scale of scales) {
    for (let offset = -180; offset <= 180; offset += 0.5) coarse.push({ scale, offset, score: candidateScore(prefix, duration, cues, scale, offset) });
  }
  coarse.sort((left, right) => right.score - left.score);
  let best = coarse[0]!;
  const seeds = coarse.filter((candidate, index, list) => index < 20 &&
    !list.slice(0, index).some((other) => Math.abs(other.offset - candidate.offset) < 2 && Math.abs(other.scale - candidate.scale) < 0.003)).slice(0, 4);
  for (const seed of seeds) {
    for (let scale = seed.scale - 0.002; scale <= seed.scale + 0.00201; scale += 0.00025) {
      for (let offset = seed.offset - 0.75; offset <= seed.offset + 0.7501; offset += 0.05) {
        const candidate = { scale, offset, score: candidateScore(prefix, duration, cues, scale, offset) };
        if (candidate.score > best.score) best = candidate;
      }
    }
  }
  const finiteScores = coarse.map((candidate) => candidate.score).filter(Number.isFinite).sort((left, right) => left - right);
  const baseline = percentile(finiteScores, 0.5);
  const runnerUp = coarse.find((candidate) => Math.abs(candidate.offset - best.offset) > 2 || Math.abs(candidate.scale - best.scale) > 0.003) ?? coarse[1];
  const confidence = Math.min(1, Math.max(0, (best.score - baseline) / 0.12) * 0.75 +
    Math.max(0, (best.score - (runnerUp?.score ?? baseline)) / 0.025) * 0.25);
  const scale = Math.round(best.scale * 1_000_000) / 1_000_000;
  const offsetSeconds = Math.round(best.offset * 100) / 100;
  return {
    transform: { id: `alignment:${scale}:${offsetSeconds}`, version: "timing_transform_v1", scale, offsetSeconds },
    confidence: Math.round(confidence * 1000) / 1000,
    score: best.score,
    duration,
    cuesAnalyzed: cues.length,
  };
};
