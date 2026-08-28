// This file bridges Kanel-generated types to the rest of the application.
// The database is the single source of truth; run "bun run db:generate" to regenerate these.
export type { default as Database } from "./generated/Database";
export type { default as UserTable, User, NewUser, UserUpdate, UserId } from "./generated/public/User";
export type { default as PlatformAdminTable, PlatformAdmin, NewPlatformAdmin, PlatformAdminUpdate, PlatformAdminId } from "./generated/public/PlatformAdmin";
export type { default as DeckTable, Deck, NewDeck, DeckUpdate, DeckId } from "./generated/public/Deck";
export type { default as SrsCardTable, SrsCard, NewSrsCard, SrsCardUpdate, SrsCardId } from "./generated/public/SrsCard";
export type { default as KnowledgePointTable, KnowledgePoint, NewKnowledgePoint, KnowledgePointUpdate, KnowledgePointId } from "./generated/public/KnowledgePoint";
export type { default as GrammarPointTable, GrammarPoint, NewGrammarPoint, GrammarPointUpdate } from "./generated/public/GrammarPoint";
// Compatibility alias while grammar-specific callers move to the shared identity.
export type { KnowledgePointId as GrammarPointId } from "./generated/public/KnowledgePoint";
export type { default as VocabularyPointTable, VocabularyPoint, NewVocabularyPoint, VocabularyPointUpdate } from "./generated/public/VocabularyPoint";
export type { default as IntroductionAdmissionTable, IntroductionAdmission, NewIntroductionAdmission, IntroductionAdmissionUpdate, IntroductionAdmissionId } from "./generated/public/IntroductionAdmission";
export type { default as MediaAnalysisRunTable, MediaAnalysisRun, NewMediaAnalysisRun, MediaAnalysisRunUpdate, MediaAnalysisRunId } from "./generated/public/MediaAnalysisRun";
export type { default as MediaCandidateTable, MediaCandidate, NewMediaCandidate, MediaCandidateUpdate, MediaCandidateId } from "./generated/public/MediaCandidate";
export type { default as LearnerProgressEventTable, LearnerProgressEvent, NewLearnerProgressEvent, LearnerProgressEventUpdate, LearnerProgressEventId } from "./generated/public/LearnerProgressEvent";
export type { default as MediaEncounterTable, MediaEncounter, NewMediaEncounter, MediaEncounterUpdate, MediaEncounterId } from "./generated/public/MediaEncounter";
export type { default as MediaCheckoutTable, MediaCheckout, NewMediaCheckout, MediaCheckoutUpdate, MediaCheckoutId } from "./generated/public/MediaCheckout";
export type { default as GeneratedExerciseTable, GeneratedExercise, NewGeneratedExercise, GeneratedExerciseUpdate, GeneratedExerciseId } from "./generated/public/GeneratedExercise";
export type { default as RetrievalEvidenceTable, RetrievalEvidence, NewRetrievalEvidence, RetrievalEvidenceUpdate, RetrievalEvidenceId } from "./generated/public/RetrievalEvidence";
export type { default as TtsDailyUsageTable, TtsDailyUsage, NewTtsDailyUsage, TtsDailyUsageUpdate } from "./generated/public/TtsDailyUsage";
export type { default as UserPreferenceTable, UserPreference, NewUserPreference, UserPreferenceUpdate } from "./generated/public/UserPreference";
export type { default as SyncEpochTable, SyncEpoch, NewSyncEpoch, SyncEpochUpdate, SyncEpochId } from "./generated/public/SyncEpoch";
