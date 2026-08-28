import type {
  MediaCandidate,
  NormalizedCue,
  NormalizedToken,
} from "../../../shared/adaptive-media.ts";

export interface CanonicalKnowledgePoint {
  readonly id: string;
  readonly kind: "grammar" | "vocabulary";
  readonly canonicalKey: string;
  readonly meaning: string;
  readonly difficulty: number;
}

export interface LearnerKnowledgeSnapshot {
  readonly knowledgePointId: string;
  readonly learningState: "introduced" | "primed" | "encountered" | "learning" | "stable" | "known";
  readonly participationStatus: "active" | "archived";
}

export interface GrammarEvidenceMatcher {
  readonly canonicalKey: string;
  readonly meaning: string;
  readonly match: (cue: NormalizedCue) => readonly { start: number; end: number; surface: string }[];
}

const canonicalPartOfSpeech = (token: NormalizedToken): string => token.partOfSpeech[0] ?? "unknown";

export const canonicalVocabularyKey = (token: NormalizedToken): string =>
  `vocabulary:${token.lemma.normalize("NFKC")}:${token.reading.normalize("NFKC")}:${canonicalPartOfSpeech(token)}`;

const vocabularyCandidates = (cues: readonly NormalizedCue[]): MediaCandidate[] => {
  const candidates = new Map<string, MediaCandidate>();
  for (const cue of cues) {
    for (const token of cue.tokens) {
      if (token.punctuation || token.lineBreak || token.lemma.trim().length === 0) continue;
      const canonicalKey = canonicalVocabularyKey(token);
      const existing = candidates.get(canonicalKey);
      const evidence = {
        cueId: cue.id,
        targetSpan: token.span,
        observedSurface: token.surface,
      };
      if (existing) {
        candidates.set(canonicalKey, { ...existing, evidence: [...existing.evidence, evidence] });
      } else {
        candidates.set(canonicalKey, {
          id: `candidate:${canonicalKey}`,
          analysisRunId: "local-deterministic-v1",
          kind: "vocabulary",
          canonicalKey,
          meaning: token.lemma,
          confidence: token.partOfSpeech[0] === "未知語" ? 0.35 : 0.9,
          disposition: "pending",
          evidence: [evidence],
          resolvedKnowledgePointId: null,
        });
      }
    }
  }
  return [...candidates.values()];
};

const grammarCandidates = (
  cues: readonly NormalizedCue[],
  matchers: readonly GrammarEvidenceMatcher[],
): MediaCandidate[] => matchers.flatMap((matcher) => {
  const evidence = cues.flatMap((cue) => matcher.match(cue).map((match) => ({
    cueId: cue.id,
    targetSpan: {
      start: match.start,
      end: match.end,
      offsetUnit: "utf16_code_units" as const,
      normalizationVersion: "adaptive_media_nfkc_v1" as const,
    },
    observedSurface: match.surface,
  })));
  return evidence.length === 0 ? [] : [{
    id: `candidate:${matcher.canonicalKey}`,
    analysisRunId: "local-deterministic-v1",
    kind: "grammar" as const,
    canonicalKey: matcher.canonicalKey,
    meaning: matcher.meaning,
    confidence: 0.9,
    disposition: "pending" as const,
    evidence,
    resolvedKnowledgePointId: null,
  }];
});

export interface EpisodeSyllabusItem {
  readonly candidateId: string;
  readonly knowledgePointId: string | null;
  readonly kind: "grammar" | "vocabulary";
  readonly label: string;
  readonly meaning: string;
  readonly occurrenceCount: number;
  readonly confidence: number;
}

export interface EpisodeSyllabus {
  readonly items: readonly EpisodeSyllabusItem[];
  readonly rejectedCandidateIds: readonly string[];
}

export const buildEpisodeSyllabus = (
  cues: readonly NormalizedCue[],
  catalog: readonly CanonicalKnowledgePoint[],
  learner: readonly LearnerKnowledgeSnapshot[],
  grammarMatchers: readonly GrammarEvidenceMatcher[] = [],
  maximum = 3,
): EpisodeSyllabus => {
  const catalogByKey = new Map(catalog.map((point) => [point.canonicalKey, point]));
  const learnerById = new Map(learner.map((progress) => [progress.knowledgePointId, progress]));
  const candidates = [...vocabularyCandidates(cues), ...grammarCandidates(cues, grammarMatchers)];
  const rejectedCandidateIds: string[] = [];
  const eligible = candidates.flatMap((candidate) => {
    const canonical = catalogByKey.get(candidate.canonicalKey);
    const progress = canonical ? learnerById.get(canonical.id) : null;
    if (progress?.learningState === "known" || progress?.learningState === "stable") {
      rejectedCandidateIds.push(candidate.id);
      return [];
    }
    if (candidate.confidence < 0.6 || candidate.evidence.some((evidence) => {
      const cue = cues.find((entry) => entry.id === evidence.cueId);
      return !cue || cue.normalizedText.slice(evidence.targetSpan.start, evidence.targetSpan.end) !== evidence.observedSurface;
    })) {
      rejectedCandidateIds.push(candidate.id);
      return [];
    }
    return [{ candidate, canonical }];
  });
  eligible.sort((left, right) => {
    const frequency = right.candidate.evidence.length - left.candidate.evidence.length;
    if (frequency !== 0) return frequency;
    const knownDefinition = Number(Boolean(right.canonical)) - Number(Boolean(left.canonical));
    if (knownDefinition !== 0) return knownDefinition;
    return left.candidate.canonicalKey.localeCompare(right.candidate.canonicalKey);
  });
  return {
    items: eligible.slice(0, Math.max(0, Math.min(3, maximum))).map(({ candidate, canonical }) => ({
      candidateId: candidate.id,
      knowledgePointId: canonical?.id ?? null,
      kind: candidate.kind,
      label: candidate.kind === "vocabulary" ? candidate.canonicalKey.split(":")[1] ?? candidate.meaning : candidate.canonicalKey,
      meaning: canonical?.meaning ?? candidate.meaning,
      occurrenceCount: candidate.evidence.length,
      confidence: candidate.confidence,
    })),
    rejectedCandidateIds,
  };
};
