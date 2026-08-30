import type {
  CandidateEvidence,
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

interface GrammarAliasCandidate {
  readonly canonicalKey: string;
  readonly meaning: string;
  readonly alias: string;
  readonly specificity: number;
}

interface VocabularyCandidateAccumulator {
  readonly id: string;
  readonly analysisRunId: string;
  readonly kind: "vocabulary";
  readonly canonicalKey: string;
  readonly meaning: string;
  readonly confidence: number;
  readonly disposition: "pending";
  readonly evidence: CandidateEvidence[];
  readonly resolvedKnowledgePointId: null;
}

const canonicalPartOfSpeech = (token: NormalizedToken): string => token.partOfSpeech[0] ?? "unknown";

export const canonicalVocabularyKey = (token: NormalizedToken): string =>
  `vocabulary:${token.lemma.normalize("NFKC")}:${token.reading.normalize("NFKC")}:${canonicalPartOfSpeech(token)}`;

const grammarNameFromKey = (canonicalKey: string): string =>
  canonicalKey.startsWith("grammar:") ? canonicalKey.slice("grammar:".length) : "";

const grammarAliases = (canonicalKey: string, meaning: string): readonly GrammarAliasCandidate[] => {
  const formalName = grammarNameFromKey(canonicalKey).normalize("NFKC");
  if (!formalName) return [];
  const alternatives = formalName.split(/\s*(?:\/|・)\s*/u);
  return alternatives.flatMap((alternative) => {
    const hasAnnotation = /\([^)]*\)/u.test(alternative);
    const hasTemplateMarker = /[~〜]/u.test(alternative);
    const alias = alternative
      .replace(/\([^)]*\)/gu, "")
      .replace(/[~〜]/gu, "")
      .replace(/\s+/gu, "")
      .trim();
    if (!alias || /[A-Za-z0-9+\[\]［］]/u.test(alias)) return [];
    const exactLiteral = alternatives.length === 1 && !hasAnnotation && !hasTemplateMarker && alias === formalName;
    return [{
      canonicalKey,
      meaning,
      alias,
      specificity: exactLiteral ? 100 : 10 + Number(!hasAnnotation) * 2 + Number(!hasTemplateMarker),
    }];
  });
};

export const buildGrammarEvidenceMatchers = (
  catalog: readonly CanonicalKnowledgePoint[],
): readonly GrammarEvidenceMatcher[] => {
  const aliases = new Map<string, GrammarAliasCandidate[]>();
  for (const point of catalog) {
    if (point.kind !== "grammar") continue;
    for (const candidate of grammarAliases(point.canonicalKey, point.meaning)) {
      const existing = aliases.get(candidate.alias);
      if (existing) existing.push(candidate);
      else aliases.set(candidate.alias, [candidate]);
    }
  }
  const selectedAliases = [...aliases.values()].flatMap((candidates) => {
    const highestSpecificity = Math.max(...candidates.map((candidate) => candidate.specificity));
    const strongest = candidates.filter((candidate) => candidate.specificity === highestSpecificity);
    const canonicalKeys = new Set(strongest.map((candidate) => candidate.canonicalKey));
    if (canonicalKeys.size !== 1) return [];
    return [strongest[0]!];
  });
  const aliasesByInitial = new Map<string, GrammarAliasCandidate[]>();
  const aliasesByCanonicalKey = new Map<string, GrammarAliasCandidate[]>();
  for (const alias of selectedAliases) {
    const initialAliases = aliasesByInitial.get(alias.alias[0]!);
    if (initialAliases) initialAliases.push(alias);
    else aliasesByInitial.set(alias.alias[0]!, [alias]);
    const canonicalAliases = aliasesByCanonicalKey.get(alias.canonicalKey);
    if (canonicalAliases) canonicalAliases.push(alias);
    else aliasesByCanonicalKey.set(alias.canonicalKey, [alias]);
  }
  const cueMatchCache = new WeakMap<NormalizedCue, ReadonlyMap<string, readonly { start: number; end: number; surface: string }[]>>();
  const matchesForCue = (cue: NormalizedCue) => {
    const cached = cueMatchCache.get(cue);
    if (cached) return cached;
    const tokens = cue.tokens.filter((token) => !token.lineBreak);
    const tokenEnds = new Set(tokens.map((token) => token.span.end));
    const matches = new Map<string, { start: number; end: number; surface: string }[]>();
    for (const token of tokens) {
      for (const candidate of aliasesByInitial.get(cue.normalizedText[token.span.start] ?? "") ?? []) {
        const end = token.span.start + candidate.alias.length;
        if (!tokenEnds.has(end) || !cue.normalizedText.startsWith(candidate.alias, token.span.start)) continue;
        const existing = matches.get(candidate.canonicalKey);
        const match = { start: token.span.start, end, surface: cue.normalizedText.slice(token.span.start, end) };
        if (existing) existing.push(match);
        else matches.set(candidate.canonicalKey, [match]);
      }
    }
    cueMatchCache.set(cue, matches);
    return matches;
  };
  return [...aliasesByCanonicalKey.entries()].map(([canonicalKey, canonicalAliases]) => ({
    canonicalKey,
    meaning: canonicalAliases[0]!.meaning,
    match: (cue: NormalizedCue) => matchesForCue(cue).get(canonicalKey) ?? [],
  }));
};

export const knownCanonicalKeysForLearner = (
  catalog: readonly CanonicalKnowledgePoint[],
  learner: readonly LearnerKnowledgeSnapshot[],
): ReadonlySet<string> => {
  const knownIds = new Set(learner
    .filter((progress) => progress.learningState === "known" || progress.learningState === "stable")
    .map((progress) => progress.knowledgePointId));
  return new Set(catalog.filter((point) => knownIds.has(point.id)).map((point) => point.canonicalKey));
};

const vocabularyCandidates = (cues: readonly NormalizedCue[]): MediaCandidate[] => {
  const candidates = new Map<string, VocabularyCandidateAccumulator>();
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
        existing.evidence.push(evidence);
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
): MediaCandidate[] => {
  const accumulated = new Map<string, { meaning: string; evidence: CandidateEvidence[] }>();
  for (const matcher of matchers) {
    const current = accumulated.get(matcher.canonicalKey) ?? { meaning: matcher.meaning, evidence: [] };
    const evidenceKeys = new Set(current.evidence.map((evidence) =>
      `${evidence.cueId}:${evidence.targetSpan.start}:${evidence.targetSpan.end}`));
    for (const cue of cues) {
      for (const match of matcher.match(cue)) {
        const evidenceKey = `${cue.id}:${match.start}:${match.end}`;
        if (evidenceKeys.has(evidenceKey)) continue;
        evidenceKeys.add(evidenceKey);
        current.evidence.push({
          cueId: cue.id,
          targetSpan: {
            start: match.start,
            end: match.end,
            offsetUnit: "utf16_code_units" as const,
            normalizationVersion: "adaptive_media_nfkc_v1" as const,
          },
          observedSurface: match.surface,
        });
      }
    }
    accumulated.set(matcher.canonicalKey, current);
  }
  const allEvidenceByCue = new Map<string, CandidateEvidence[]>();
  for (const evidence of [...accumulated.values()].flatMap((candidate) => candidate.evidence)) {
    const existing = allEvidenceByCue.get(evidence.cueId);
    if (existing) existing.push(evidence);
    else allEvidenceByCue.set(evidence.cueId, [evidence]);
  }
  return [...accumulated.entries()].flatMap(([canonicalKey, candidate]) => {
    const evidence = candidate.evidence.filter((current) => !(allEvidenceByCue.get(current.cueId) ?? []).some((other) =>
      other.targetSpan.start <= current.targetSpan.start &&
      other.targetSpan.end >= current.targetSpan.end &&
      other.targetSpan.end - other.targetSpan.start > current.targetSpan.end - current.targetSpan.start));
    if (evidence.length === 0) return [];
    return [{
      id: `candidate:${canonicalKey}`,
      analysisRunId: "local-deterministic-v1",
      kind: "grammar" as const,
      canonicalKey,
      meaning: candidate.meaning,
      confidence: 0.9,
      disposition: "pending" as const,
      evidence,
      resolvedKnowledgePointId: null,
    }];
  });
};

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
  const cuesById = new Map(cues.map((cue) => [cue.id, cue]));
  const detectedGrammar = grammarCandidates(cues, grammarMatchers);
  const grammarEvidenceByCue = new Map<string, CandidateEvidence[]>();
  for (const evidence of detectedGrammar.flatMap((candidate) => candidate.evidence)) {
    const existing = grammarEvidenceByCue.get(evidence.cueId);
    if (existing) existing.push(evidence);
    else grammarEvidenceByCue.set(evidence.cueId, [evidence]);
  }
  const detectedVocabulary = vocabularyCandidates(cues).flatMap((candidate) => {
    const evidence = candidate.evidence.filter((current) =>
      !(grammarEvidenceByCue.get(current.cueId) ?? []).some((grammar) =>
        grammar.targetSpan.start <= current.targetSpan.start && grammar.targetSpan.end >= current.targetSpan.end));
    return evidence.length === 0 ? [] : [{ ...candidate, evidence }];
  });
  const candidates = [...detectedVocabulary, ...detectedGrammar];
  const rejectedCandidateIds: string[] = [];
  const eligible = candidates.flatMap((candidate) => {
    const canonical = catalogByKey.get(candidate.canonicalKey);
    const progress = canonical ? learnerById.get(canonical.id) : null;
    if (progress?.learningState === "known" || progress?.learningState === "stable") {
      rejectedCandidateIds.push(candidate.id);
      return [];
    }
    if (candidate.confidence < 0.6 || candidate.evidence.some((evidence) => {
      const cue = cuesById.get(evidence.cueId);
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
      label: candidate.kind === "vocabulary"
        ? candidate.canonicalKey.split(":")[1] ?? candidate.meaning
        : grammarNameFromKey(candidate.canonicalKey),
      meaning: canonical?.meaning ?? candidate.meaning,
      occurrenceCount: candidate.evidence.length,
      confidence: candidate.confidence,
    })),
    rejectedCandidateIds,
  };
};
