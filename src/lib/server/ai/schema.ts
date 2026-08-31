import { z } from "zod";

export const FuriganaSegmentSchema = z.object({
  kanji: z.string().describe("The kanji characters or word block. For hiragana/katakana/punctuation, just put the characters here directly."),
  kana: z.string().optional().describe("The hiragana reading for the kanji characters. Leave undefined if the segment does not need furigana (e.g. is already hiragana, katakana, or punctuation).")
});

export const SentenceGenerationSchema = z.object({
  front: z.string().describe("The surrounding situation immediately BEFORE the learner speaks: setting, observable trigger, relationship, and register. Do not state, translate, or paraphrase the meaning of the Japanese utterance."),
  back: z.string().describe("The natural, conversational Japanese utterance the learner says NEXT in the described situation. It is a response within the scene, not a translation of the scene description. Omit textbook fluff (e.g. avoid starting sentences with '私は' unless essential)."),
  furigana: z.array(FuriganaSegmentSchema).describe("The Japanese sentence split into segments with their corresponding furigana readings, for rich rendering on the frontend.")
});

export type FuriganaSegment = z.infer<typeof FuriganaSegmentSchema>;
export type SentenceGeneration = z.infer<typeof SentenceGenerationSchema>;

export const DailySessionQueueItemSchema = z.object({
  grammar_point_id: z.string().min(1).max(100),
  formal_name: z.string().min(1).max(200),
  repetitions: z.number().int().nonnegative(),
  ease_factor: z.number().finite().positive(),
});

export const DailySessionGenerationRequestSchema = z.object({
  mode: z.enum(["standard", "cram"]),
  queue: z.array(DailySessionQueueItemSchema).min(1).max(15),
  vocabulary_pool: z.array(z.string().min(1).max(100)).min(1).max(2_000),
});

export const DailySessionDraftCardSchema = z.object({
  grammar_point_id: z.string().min(1).max(100),
  english_context: z.string().min(1).max(1_000).describe("A second-person scene immediately before the learner speaks. Include the setting, observable trigger, social relationship, and expected register, but do not state or paraphrase the Japanese sentence's meaning."),
  japanese_sentence: z.string().min(1).max(500).describe("The natural Japanese utterance the learner says next in the scene. This is not a translation of english_context."),
  audio_url: z.null(),
  explanation: z.string().min(1).max(2_000),
});

export const DailySessionGenerationDraftSchema = z.object({
  cards: z.array(DailySessionDraftCardSchema).min(1).max(15),
});

export const DailySessionProviderCardSchema = DailySessionDraftCardSchema.extend({
  context_quality: z.object({
    describes_situation_before_utterance: z.literal(true),
    stops_before_learner_speaks: z.literal(true),
    omits_utterance_meaning: z.literal(true),
    is_not_translation_or_paraphrase: z.literal(true),
  }).describe("Verify these checks after comparing english_context with japanese_sentence. Revise the context before returning the card unless every check is true."),
});

export const DailySessionProviderGenerationSchema = z.object({
  cards: z.array(DailySessionProviderCardSchema).min(1).max(15),
});

export const DailySessionCardSchema = DailySessionDraftCardSchema.extend({
  furigana: z.array(FuriganaSegmentSchema).min(1).max(500),
});

export const DailySessionGenerationSchema = z.object({
  cards: z.array(DailySessionCardSchema).min(1).max(15),
});

export type DailySessionGenerationRequest = z.infer<
  typeof DailySessionGenerationRequestSchema
>;
export type DailySessionGenerationDraft = z.infer<
  typeof DailySessionGenerationDraftSchema
>;
export type DailySessionGeneration = z.infer<
  typeof DailySessionGenerationSchema
>;

export const MediaRecommendationEvidenceSchema = z.object({
  cueId: z.string().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  observedSurface: z.string().min(1),
});

export const MediaRecommendationProposalSchema = z.object({
  kind: z.enum(["grammar", "vocabulary"]),
  canonicalKey: z.string().min(1).describe("A stable key beginning with the matching kind and a colon, for example vocabulary:歩く or grammar:〜ておく."),
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
