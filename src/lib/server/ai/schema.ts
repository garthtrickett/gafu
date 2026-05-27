import { z } from "zod";

export const FuriganaSegmentSchema = z.object({
  kanji: z.string().describe("The kanji characters or word block. For hiragana/katakana/punctuation, just put the characters here directly."),
  kana: z.string().optional().describe("The hiragana reading for the kanji characters. Leave undefined if the segment does not need furigana (e.g. is already hiragana, katakana, or punctuation).")
});

export const SentenceGenerationSchema = z.object({
  front: z.string().describe("A micro-targeted, clear English situational context primer to prepare the learner's brain. e.g. 'At a bar, casually asking the bartender for another beer.'"),
  back: z.string().describe("The natural, conversational, colloquial Japanese translation of the context. Omit textbook fluff (e.g. avoid starting sentences with '私は' unless essential)."),
  furigana: z.array(FuriganaSegmentSchema).describe("The Japanese sentence split into segments with their corresponding furigana readings, for rich rendering on the frontend.")
});

export type FuriganaSegment = z.infer<typeof FuriganaSegmentSchema>;
export type SentenceGeneration = z.infer<typeof SentenceGenerationSchema>;


