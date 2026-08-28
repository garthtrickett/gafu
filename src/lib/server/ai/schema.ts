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

export const LearningFuriganaSegmentSchema = z.object({
  text: z.string().min(1),
  reading: z.string().optional(),
});

export const PrimerContentSchema = z.object({
  form: z.string().min(1),
  reading: z.string(),
  senseOrFunction: z.string().min(1),
  formation: z.string().min(1),
  exampleContext: z.string().min(1),
  exampleSentence: z.string().min(1),
  exampleTargetStart: z.number().int().nonnegative(),
  exampleTargetEnd: z.number().int().positive(),
  furigana: z.array(LearningFuriganaSegmentSchema),
  retrievalPrompt: z.string().min(1),
  retrievalAnswer: z.string().min(1),
  listeningMission: z.string().min(1),
});

export const LearningExerciseContentSchema = z.object({
  targetCanonicalKey: z.string().min(1),
  context: z.string().min(1),
  japaneseSentence: z.string().min(1),
  targetStart: z.number().int().nonnegative(),
  targetEnd: z.number().int().positive(),
  answer: z.string().min(1),
  explanation: z.string().min(1),
  furigana: z.array(LearningFuriganaSegmentSchema),
  modality: z.enum(["text_recognition", "listening_recognition", "production"]),
  variationTags: z.array(z.string().min(1)).min(2).max(12),
  variationProfile: z.object({
    situation: z.string().min(1),
    surroundingVocabulary: z.array(z.string().min(1)).max(12),
    conjugation: z.string().min(1),
    politeness: z.enum(["casual", "polite", "neutral"]),
    register: z.string().min(1),
    speakerIntention: z.string().min(1),
    polarity: z.enum(["positive", "negative"]),
    questionForm: z.boolean(),
  }),
  qualityChecks: z.object({
    intendedSenseOrFunction: z.literal(true),
    unambiguousAnswer: z.literal(true),
    naturalJapanese: z.literal(true),
    registerMatches: z.literal(true),
  }),
  prerequisiteCanonicalKeys: z.array(z.string().min(1)).max(20),
  confidence: z.number().min(0).max(1),
});

export type PrimerContent = z.infer<typeof PrimerContentSchema>;
export type LearningExerciseContent = z.infer<typeof LearningExerciseContentSchema>;
