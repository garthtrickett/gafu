import { z } from "zod";

export const FuriganaSegmentSchema = z.object({
  kanji: z.string().describe("The kanji characters or word block. For hiragana/katakana/punctuation, just put the characters here directly."),
  kana: z.string().optional().describe("The hiragana reading for the kanji characters. Leave undefined if the segment does not need furigana (e.g. is already hiragana, katakana, or punctuation).")
});

export const SentenceGenerationSchema = z.object({
  front: z.string().describe("A situational description of the moment BEFORE or AT the time of speaking (e.g. 'Realizing you forgot your wallet at the register, casually asking your friend to cover you.'). DO NOT provide a direct English translation of the Japanese sentence."),
  back: z.string().describe("The natural, conversational, colloquial Japanese translation of the context. Omit textbook fluff (e.g. avoid starting sentences with '私は' unless essential)."),
  furigana: z.array(FuriganaSegmentSchema).describe("The Japanese sentence split into segments with their corresponding furigana readings, for rich rendering on the frontend.")
});

export type FuriganaSegment = z.infer<typeof FuriganaSegmentSchema>;
export type SentenceGeneration = z.infer<typeof SentenceGenerationSchema>;

export const MediaRecommendationEvidenceSchema = z.object({
  cueId: z.string().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  observedSurface: z.string().min(1),
});

export const MediaRecommendationProposalSchema = z.object({
  kind: z.enum(["grammar", "vocabulary"]),
  canonicalKey: z.string().min(1),
  reading: z.string(),
  meaning: z.string().min(1),
  observedForms: z.array(z.string().min(1)).min(1).max(8),
  occurrenceCount: z.number().int().positive(),
  firstTimeSeconds: z.number().nonnegative(),
  prerequisiteCanonicalKeys: z.array(z.string().min(1)).max(8),
  confidence: z.number().min(0).max(1),
  reviewCostClass: z.enum(["light_vocabulary", "difficult_vocabulary", "grammar"]),
  evidence: z.array(MediaRecommendationEvidenceSchema).min(1).max(8),
});

export const MediaRecommendationResultSchema = z.object({
  proposals: z.array(MediaRecommendationProposalSchema).max(5),
});

export type MediaRecommendationProposal = z.infer<typeof MediaRecommendationProposalSchema>;
export type MediaRecommendationResult = z.infer<typeof MediaRecommendationResultSchema>;

