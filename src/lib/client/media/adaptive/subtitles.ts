import { Effect } from "effect";
import {
  NORMALIZED_CUE_VERSION,
  type NormalizedCue,
  type TimingTransform,
} from "../../../shared/adaptive-media.ts";

const ASS_TAGS = /\{[^}]*\}/g;
const HTML_TAGS = /<[^>]*>/g;

export type SubtitleFormat = "srt" | "ass" | "ssa";

export const normalizeCueText = (text: string): string => text
  .replace(ASS_TAGS, "")
  .replace(/\\N/gi, "\n")
  .replace(/\\n/g, "\n")
  .replace(/\\h/g, " ")
  .replace(HTML_TAGS, "")
  .replace(/\r\n?/g, "\n")
  .normalize("NFKC")
  .trim();

export const parseSrtTime = (value: string): number => {
  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!match) return Number.NaN;
  const [, hours = "0", minutes = "0", seconds = "0", milliseconds = "0"] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(milliseconds.padEnd(3, "0")) / 1000;
};

export const parseAssTime = (value: string): number => {
  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})[.](\d{1,2})$/);
  if (!match) return Number.NaN;
  const [, hours = "0", minutes = "0", seconds = "0", centiseconds = "0"] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(centiseconds.padEnd(2, "0")) / 100;
};

const cue = (
  format: SubtitleFormat,
  fingerprint: string,
  sourceCueOrdinal: number,
  start: number,
  end: number,
  text: string,
): NormalizedCue | null => {
  const normalizedText = normalizeCueText(text);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || normalizedText.length === 0) return null;
  return {
    id: `cue-v1:${fingerprint}:${format}:${sourceCueOrdinal}`,
    subtitleTrackFingerprint: fingerprint,
    sourceCueOrdinal,
    sourceStartSeconds: start,
    sourceEndSeconds: end,
    normalizedText,
    normalizationVersion: NORMALIZED_CUE_VERSION,
    tokens: [],
  };
};

export const parseSrt = (source: string, fingerprint: string): NormalizedCue[] => {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  return normalized.split(/\n{2,}/).flatMap((block, sourceCueOrdinal) => {
    const lines = block.split("\n");
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) return [];
    const [rawStart = "", rawEndWithSettings = ""] = lines[timingIndex]!.split(/\s*-->\s*/);
    const parsed = cue(
      "srt",
      fingerprint,
      sourceCueOrdinal,
      parseSrtTime(rawStart),
      parseSrtTime(rawEndWithSettings.split(/\s+/)[0] ?? ""),
      lines.slice(timingIndex + 1).join("\n"),
    );
    return parsed ? [parsed] : [];
  }).sort((left, right) => left.sourceStartSeconds - right.sourceStartSeconds);
};

export const parseAss = (source: string, fingerprint: string, format: "ass" | "ssa" = "ass"): NormalizedCue[] => {
  const lines = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  let inEvents = false;
  let fields = ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"];
  const cues: NormalizedCue[] = [];
  let sourceCueOrdinal = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[events\]$/i.test(trimmed)) { inEvents = true; continue; }
    if (/^\[.+\]$/.test(trimmed)) { inEvents = false; continue; }
    if (!inEvents) continue;
    const formatMatch = trimmed.match(/^Format:\s*(.+)$/i);
    if (formatMatch?.[1]) {
      fields = formatMatch[1].split(",").map((field) => field.trim().toLowerCase());
      continue;
    }
    const dialogueMatch = line.match(/^Dialogue:\s*(.*)$/i);
    if (!dialogueMatch?.[1]) continue;
    const ordinal = sourceCueOrdinal++;
    const values = dialogueMatch[1].split(",");
    if (values.length < fields.length) continue;
    const row = Object.fromEntries(fields.map((field, index) => [
      field,
      index === fields.length - 1 ? values.slice(index).join(",") : values[index] ?? "",
    ]));
    const parsed = cue(
      format,
      fingerprint,
      ordinal,
      parseAssTime(row.start ?? ""),
      parseAssTime(row.end ?? ""),
      row.text ?? "",
    );
    if (parsed) cues.push(parsed);
  }
  return cues.sort((left, right) => left.sourceStartSeconds - right.sourceStartSeconds);
};

export const subtitleFormatFromName = (name: string): SubtitleFormat | null => {
  const extension = name.toLowerCase().split(".").at(-1);
  return extension === "srt" || extension === "ass" || extension === "ssa" ? extension : null;
};

export const parseSubtitleTrack = (
  name: string,
  source: string,
  fingerprint: string,
): NormalizedCue[] => {
  const format = subtitleFormatFromName(name);
  if (format === "srt") return parseSrt(source, fingerprint);
  if (format === "ass" || format === "ssa") return parseAss(source, fingerprint, format);
  return [];
};

const bytesToHex = (bytes: Uint8Array): string => [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");

export const fingerprintSubtitleBytes = (bytes: Uint8Array) => Effect.tryPromise({
  try: () => crypto.subtle.digest("SHA-256", bytes as BufferSource).then((digest) => `sha256:${bytesToHex(new Uint8Array(digest))}`),
  catch: (cause) => new Error(`Could not fingerprint subtitle bytes: ${String(cause)}`),
});

export const findActiveCues = (
  cues: readonly NormalizedCue[],
  playbackSeconds: number,
  transform: TimingTransform,
): NormalizedCue[] => {
  const sourceTime = (playbackSeconds - transform.offsetSeconds) / transform.scale;
  return cues.filter((entry) => entry.sourceStartSeconds <= sourceTime && entry.sourceEndSeconds >= sourceTime);
};
