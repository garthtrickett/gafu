import { Effect } from "effect";
import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { clientLog } from "../lib/client/clientLog.ts";
import { runClientPromise } from "../lib/client/runtime.ts";
import { knowledgePointCatalogStore, knowledgePointStore } from "../lib/client/stores/knowledgePointStore.ts";
import type { NormalizedCue, NormalizedToken, TimingTransform } from "../lib/shared/adaptive-media.ts";
import { alignSubtitles } from "../lib/client/media/adaptive/alignment.ts";
import { decodeSpeechEnvelope } from "../lib/client/media/adaptive/audio-analysis.ts";
import { localAudioRepairAdapter } from "../lib/client/media/adaptive/audio-repair.ts";
import { LocalMediaSession } from "../lib/client/media/adaptive/local-media.ts";
import { CueLifecycleTracker, PlaybackClock } from "../lib/client/media/adaptive/playback.ts";
import { buildSourceExclusionSignatures, getOrCreateSourceSignatureKey, persistSourceExclusionSignatures } from "../lib/client/media/adaptive/source-signature-store.ts";
import { buildEpisodeSyllabus, type EpisodeSyllabus } from "../lib/client/media/adaptive/syllabus.ts";
import { findActiveCues, fingerprintSubtitleBytes, parseSubtitleTrack } from "../lib/client/media/adaptive/subtitles.ts";
import { tokenizeSubtitleCuesCooperatively } from "../lib/client/media/adaptive/tokenizer.ts";
import { tokenState } from "../lib/client/stores/authStore.ts";
import { isLoopbackHostname } from "../lib/shared/local-media-helper.ts";
import type { LearningExerciseContent, PrimerContent } from "../lib/server/ai/schema.ts";
import {
  requestMediaRecommendations,
  selectMediaAnalysisExcerpts,
  submitMediaCandidateAction,
  validateMediaRecommendations,
  type ActionableMediaRecommendation,
  type MediaCandidateAction,
} from "../lib/client/media/adaptive/recommendations.ts";
import {
  fetchPendingMediaCheckouts,
  deleteAllAdaptiveMediaData,
  fetchNextValidatedExercise,
  generateValidateAndStoreExercise,
  requestLearningContent,
  requestExerciseWithCachedFallback,
  submitAlternativeCheckout,
  submitLearningEvent,
  validateGeneratedSentence,
  type PendingMediaCheckout,
} from "../lib/client/media/adaptive/learning-content.ts";

const SOURCE_TIMING: TimingTransform = { id: "source", version: "timing_transform_v1", scale: 1, offsetSeconds: 0 };

interface AcceptedTarget {
  readonly candidateId: string;
  readonly knowledgePointId: string;
  readonly canonicalKey: string;
  readonly cueIds: readonly string[];
  readonly subtitleTrackFingerprint: string;
  readonly primed: boolean;
}

@customElement("watch-view")
export class WatchView extends LitElement {
  @query("video") private video?: HTMLVideoElement;
  @query("[data-video-stage]") private videoStage?: HTMLElement;
  @query("audio[data-repaired-audio]") private repairedAudio?: HTMLAudioElement;
  @state() private videoUrl = "";
  @state() private videoName = "";
  @state() private repairedAudioUrl = "";
  @state() private repairedAudioActive = false;
  @state() private repairingAudio = false;
  @state() private audioRepairProgress = 0;
  @state() private audioRepairStatus = "";
  @state() private repairedAudioMuted = false;
  @state() private repairedAudioVolume = 1;
  @state() private subtitleName = "";
  @state() private cues: readonly NormalizedCue[] = [];
  @state() private activeCues: readonly NormalizedCue[] = [];
  @state() private transform: TimingTransform = SOURCE_TIMING;
  @state() private status = "Choose a local video and subtitle track.";
  @state() private furigana = true;
  @state() private spacing = 0.1;
  @state() private subtitleSize = 7.5;
  @state() private syllabus: EpisodeSyllabus = { items: [], rejectedCandidateIds: [] };
  @state() private analysisConsent = false;
  @state() private aiRecommendations: readonly ActionableMediaRecommendation[] = [];
  @state() private aiStatus = "Optional AI analysis is off.";
  @state() private candidateStatuses: Readonly<Record<string, string>> = {};
  @state() private laterAccepted: Readonly<Record<string, boolean>> = {};
  @state() private acceptedTargets: readonly AcceptedTarget[] = [];
  @state() private pendingCheckouts: readonly PendingMediaCheckout[] = [];
  @state() private primer: { readonly target: AcceptedTarget; readonly content: PrimerContent; readonly revealed: boolean } | null = null;
  @state() private checkout: {
    readonly item: PendingMediaCheckout;
    readonly exerciseId: string;
    readonly content: LearningExerciseContent;
    readonly cached: boolean;
    readonly openedAt: number;
    readonly revealed: boolean;
  } | null = null;
  @state() private learningStatus = "";
  @state() private markersEnabled = true;
  private canonicalKeys: ReadonlySet<string> = new Set();
  private analysisRunId = "";
  private subtitleTrackFingerprint = "";
  private audioRepairVersion = 0;
  private readonly media = new LocalMediaSession();
  private readonly lifecycle = new CueLifecycleTracker();

  protected override createRenderRoot() { return this; }

  override connectedCallback() {
    super.connectedCallback();
    document.addEventListener("keydown", this.onKeyDown);
    this.refreshPendingCheckouts();
  }

  override disconnectedCallback() {
    document.removeEventListener("keydown", this.onKeyDown);
    const token = tokenState.value;
    if (token) for (const target of this.acceptedTargets.filter((item) => item.primed)) {
      void runClientPromise(submitLearningEvent(token, {
        knowledgePointId: target.knowledgePointId,
        candidateId: target.candidateId,
        event: "media_abandoned",
        idempotencyKey: `abandon:${target.candidateId}`,
      }).pipe(Effect.catchAll(() => Effect.void)));
    }
    this.video?.pause();
    this.repairedAudio?.pause();
    this.media.releaseAll();
    this.lifecycle.reset();
    super.disconnectedCallback();
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.matches("input, button, select, textarea")) return;
    if (event.code === "Space") {
      event.preventDefault();
      this.togglePlayback();
    }
    if ((event.code === "ArrowLeft" || event.code === "ArrowRight") && this.video) {
      event.preventDefault();
      this.video.currentTime = Math.max(0, Math.min(this.video.duration || Number.POSITIVE_INFINITY,
        this.video.currentTime + (event.code === "ArrowLeft" ? -5 : 5)));
      this.syncRepairedAudio(true);
      this.updateCues();
    }
  };

  private loadVideo(file: File) {
    this.resetRepairedAudio();
    const handle = this.media.replace("video", file);
    this.videoUrl = handle.objectUrl;
    this.videoName = file.name;
    this.status = "Video ready. Playback remains entirely local.";
  }

  private resetRepairedAudio() {
    this.audioRepairVersion += 1;
    this.repairedAudio?.pause();
    this.media.release("repaired-audio");
    this.repairedAudioUrl = "";
    this.repairedAudioActive = false;
    this.repairingAudio = false;
    this.audioRepairProgress = 0;
    this.audioRepairStatus = "";
    this.repairedAudioMuted = false;
    if (this.video) this.video.muted = false;
  }

  private waitForRepairedAudioMetadata(audio: HTMLAudioElement): Effect.Effect<void, Error> {
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) return Effect.void;
    return Effect.async((resume) => {
      const cleanup = () => {
        audio.removeEventListener("loadedmetadata", loaded);
        audio.removeEventListener("error", failed);
      };
      const loaded = () => {
        cleanup();
        resume(Effect.void);
      };
      const failed = () => {
        cleanup();
        resume(Effect.fail(new Error("Firefox could not open the repaired Opus audio track.")));
      };
      audio.addEventListener("loadedmetadata", loaded, { once: true });
      audio.addEventListener("error", failed, { once: true });
      audio.load();
      return Effect.sync(cleanup);
    });
  }

  private repairFirefoxAudio() {
    const file = this.media.get("video")?.file;
    if (!file || this.repairingAudio || this.repairedAudioActive) return;
    this.repairingAudio = true;
    this.audioRepairProgress = 0;
    this.audioRepairStatus = "Starting local audio repair…";
    this.video?.pause();
    const repairVersion = ++this.audioRepairVersion;
    const program = Effect.gen(this, function* () {
      const audioBlob = yield* localAudioRepairAdapter.repair(file, ({ progress, message }) => {
        if (repairVersion !== this.audioRepairVersion) return;
        this.audioRepairProgress = progress;
        this.audioRepairStatus = message;
      });
      if (repairVersion !== this.audioRepairVersion) {
        yield* clientLog("info", "[WatchView] Discarded repaired audio after the selected video changed.");
        return;
      }
      const repairedFile = new File([audioBlob], `${file.name.replace(/\.[^.]+$/u, "")}.firefox.ogg`, {
        type: "audio/ogg",
      });
      const handle = this.media.replace("repaired-audio", repairedFile);
      yield* Effect.sync(() => { this.repairedAudioUrl = handle.objectUrl; });
      yield* Effect.tryPromise({
        try: () => this.updateComplete,
        catch: (cause) => new Error(`Could not prepare repaired audio playback: ${String(cause)}`),
      });
      if (repairVersion !== this.audioRepairVersion) return;
      if (!this.repairedAudio || !this.video) {
        return yield* Effect.fail(new Error("The repaired audio player was not available."));
      }
      this.repairedAudio.volume = this.repairedAudioVolume;
      this.repairedAudio.muted = this.repairedAudioMuted;
      this.repairedAudio.playbackRate = this.video.playbackRate;
      yield* this.waitForRepairedAudioMetadata(this.repairedAudio);
      if (repairVersion !== this.audioRepairVersion) return;
      yield* Effect.sync(() => {
        this.repairedAudioActive = true;
        this.repairingAudio = false;
        this.audioRepairProgress = 1;
        this.audioRepairStatus = "Firefox-compatible audio is ready. Press play.";
        this.video!.muted = true;
        this.syncRepairedAudio(true);
        this.updateCues();
      });
      yield* clientLog("info", "[WatchView] Firefox audio repair activated.", {
        repairedByteCount: repairedFile.size,
      });
    }).pipe(Effect.catchAll((error) => Effect.gen(this, function* () {
      if (repairVersion !== this.audioRepairVersion) {
        yield* clientLog("info", "[WatchView] Ignored an obsolete audio repair failure after the selected video changed.");
        return;
      }
      yield* clientLog("error", "[WatchView] Firefox audio repair failed.", {
        reason: error.message,
      });
      yield* Effect.sync(() => {
        this.resetRepairedAudio();
        this.audioRepairStatus = `Audio repair failed: ${error.message}`;
        this.status = "Original video playback is still available.";
      });
    })));
    void runClientPromise(program);
  }

  private loadSubtitles(file: File) {
    this.status = "Preparing subtitles locally…";
    const program = Effect.gen(this, function* () {
      yield* clientLog("info", "[WatchView] Subtitle preparation started.", { byteCount: file.size });
      const bytes = new Uint8Array(yield* Effect.tryPromise({
        try: () => file.arrayBuffer(),
        catch: (cause) => new Error(`Could not read subtitle file: ${String(cause)}`),
      }));
      const fingerprint = yield* fingerprintSubtitleBytes(bytes);
      const parsed = parseSubtitleTrack(file.name, new TextDecoder().decode(bytes), fingerprint);
      yield* clientLog("info", "[WatchView] Parsed local subtitle cues.", { cueCount: parsed.length });
      const enriched = yield* tokenizeSubtitleCuesCooperatively(parsed);
      yield* clientLog("info", "[WatchView] Tokenized local subtitle cues.", { cueCount: enriched.length });
      const sourceSignatureKey = yield* getOrCreateSourceSignatureKey();
      const sourceSignatures = yield* buildSourceExclusionSignatures(enriched, sourceSignatureKey);
      if (enriched[0]) yield* persistSourceExclusionSignatures(enriched[0].subtitleTrackFingerprint, sourceSignatures);
      // Semantic embeddings are intentionally lazy: exercise validation enriches these
      // signatures only when it needs a near-copy check, avoiding a full-track model run here.
      yield* clientLog("info", "[WatchView] Stored exact and lexical source signatures.", {
        exactSignatureCount: sourceSignatures.exact.size,
        lexicalSignatureCount: sourceSignatures.lexical.length,
      });
      yield* knowledgePointCatalogStore.load();
      yield* knowledgePointStore.load();
      const catalog = knowledgePointCatalogStore.state.peek().map((point) => point.kind === "vocabulary" ? ({
        id: point.id,
        kind: "vocabulary" as const,
        canonicalKey: point.canonical_key,
        meaning: point.meaning,
        difficulty: 5,
      }) : ({
        id: point.id,
        kind: "grammar" as const,
        canonicalKey: `grammar:${point.formal_name}`,
        meaning: point.base_meaning,
        difficulty: 5,
      }));
      const learner = knowledgePointStore.state.peek().map((progress) => ({
        knowledgePointId: progress.id,
        learningState: progress.learningState ?? ((progress.stability ?? 0) >= 21 ? "stable" as const : "learning" as const),
        participationStatus: progress.participationStatus ?? "active" as const,
      }));
      yield* clientLog("info", "[WatchView] Loaded knowledge state for subtitles.", {
        catalogCount: catalog.length,
        learnerProgressCount: learner.length,
      });
      const syllabus = buildEpisodeSyllabus(enriched, catalog, learner);
      yield* clientLog("info", "[WatchView] Built subtitle syllabus.", {
        syllabusItemCount: syllabus.items.length,
        rejectedCandidateCount: syllabus.rejectedCandidateIds.length,
      });
      yield* Effect.sync(() => {
        this.cues = enriched;
        this.subtitleName = file.name;
        this.transform = SOURCE_TIMING;
        this.syllabus = syllabus;
        this.aiRecommendations = [];
        this.candidateStatuses = {};
        this.laterAccepted = {};
        this.aiStatus = "Optional AI analysis is off.";
        this.subtitleTrackFingerprint = fingerprint;
        this.canonicalKeys = new Set(catalog.map((point) => point.canonicalKey));
        this.status = enriched.length === 0
          ? "No valid timed cues were found; video playback is still available."
          : `${enriched.length} timed cues prepared locally.`;
        this.updateCues();
      });
    }).pipe(Effect.catchAll((error) => Effect.gen(this, function* () {
      yield* clientLog("error", "[WatchView] Subtitle preparation failed.");
      yield* Effect.sync(() => { this.status = error.message; });
    })));
    void runClientPromise(program);
  }

  private acceptFiles(files: FileList | readonly File[]) {
    for (const file of Array.from(files)) {
      const extension = file.name.toLowerCase().split(".").at(-1);
      if (extension === "srt" || extension === "ass" || extension === "ssa") this.loadSubtitles(file);
      else if (extension === "mkv" || extension === "mp4" || extension === "webm" || file.type.startsWith("video/")) this.loadVideo(file);
      else this.status = "Unsupported local file. Choose MKV, MP4, WebM, ASS, SSA, or SRT.";
    }
  }

  private updateCues = () => {
    if (!this.video) return;
    this.syncRepairedAudio();
    const playbackSeconds = new PlaybackClock(
      this.video,
      this.repairedAudio ?? this.video,
      this.repairedAudioActive,
    ).currentTime();
    this.activeCues = findActiveCues(this.cues, playbackSeconds, this.transform);
    for (const event of this.lifecycle.update(this.cues, playbackSeconds, this.transform)) {
      this.dispatchEvent(new CustomEvent("gafu-media-cue", { detail: event, bubbles: true, composed: true }));
      if (event.type === "cue-enter") this.recordAcceptedEncounter(event.cueId, event.playbackSeconds);
    }
  };

  private syncRepairedAudio(force = false) {
    if (!this.repairedAudioActive || !this.repairedAudio || !this.video) return;
    const difference = Math.abs(this.repairedAudio.currentTime - this.video.currentTime);
    if (force || difference > 0.3) this.repairedAudio.currentTime = this.video.currentTime;
  }

  private readonly onVideoPlay = () => {
    if (!this.repairedAudioActive || !this.repairedAudio) return;
    this.syncRepairedAudio(true);
    void runClientPromise(Effect.tryPromise({
      try: () => this.repairedAudio!.play(),
      catch: (cause) => new Error(`Firefox could not start repaired audio: ${String(cause)}`),
    }).pipe(Effect.catchAll((error) => Effect.gen(this, function* () {
      yield* clientLog("error", "[WatchView] Repaired audio playback failed.", { reason: error.message });
      yield* Effect.sync(() => {
        this.video?.pause();
        this.status = error.message;
      });
    }))));
  };

  private readonly onVideoPause = () => { this.repairedAudio?.pause(); };
  private readonly onVideoSeeking = () => { this.syncRepairedAudio(true); };
  private readonly onVideoRateChange = () => {
    if (this.repairedAudio && this.video) this.repairedAudio.playbackRate = this.video.playbackRate;
  };
  private readonly onVideoVolumeChange = () => {
    if (!this.repairedAudioActive || !this.repairedAudio || !this.video) return;
    this.repairedAudioVolume = this.video.volume;
    this.repairedAudio.volume = this.video.volume;
    if (!this.video.muted) this.video.muted = true;
  };
  private readonly onVideoEnded = () => {
    this.repairedAudio?.pause();
    this.refreshPendingCheckouts();
  };

  private toggleRepairedAudioMute() {
    if (!this.repairedAudio) return;
    this.repairedAudioMuted = !this.repairedAudioMuted;
    this.repairedAudio.muted = this.repairedAudioMuted;
  }

  private setRepairedAudioVolume(event: Event) {
    const volume = Number((event.target as HTMLInputElement).value);
    this.repairedAudioVolume = volume;
    this.repairedAudioMuted = false;
    if (this.repairedAudio) {
      this.repairedAudio.volume = volume;
      this.repairedAudio.muted = false;
    }
  }

  private refreshPendingCheckouts() {
    const token = tokenState.value;
    if (!token) return;
    void runClientPromise(fetchPendingMediaCheckouts(token).pipe(
      Effect.tap((items) => Effect.sync(() => {
        this.pendingCheckouts = items;
        const restored = items.flatMap((item): AcceptedTarget[] =>
          item.candidateId && item.subtitleTrackFingerprint && (item.learningState === "primed" || item.learningState === "encountered")
            ? [{
                candidateId: item.candidateId,
                knowledgePointId: item.knowledgePointId,
                canonicalKey: item.canonicalKey,
                cueIds: item.cueIds,
                subtitleTrackFingerprint: item.subtitleTrackFingerprint,
                primed: true,
              }]
            : []
        );
        const existingIds = new Set(this.acceptedTargets.map((target) => target.candidateId));
        this.acceptedTargets = [...this.acceptedTargets, ...restored.filter((target) => !existingIds.has(target.candidateId))];
      })),
      Effect.catchAll(() => Effect.void),
    ));
  }

  private recordAcceptedEncounter(cueId: string, playbackSeconds: number) {
    const token = tokenState.value;
    if (!token) return;
    for (const target of this.acceptedTargets.filter((item) => item.primed && item.cueIds.includes(cueId))) {
      void runClientPromise(submitLearningEvent(token, {
        knowledgePointId: target.knowledgePointId,
        candidateId: target.candidateId,
        event: "cue_reached",
        idempotencyKey: `encounter:${target.candidateId}:${cueId}`,
        encounter: { cueId, timingTransformId: this.transform.id, effectivePlaybackSeconds: playbackSeconds },
      }).pipe(Effect.catchAll(() => Effect.void)));
    }
  }

  private togglePlayback() {
    if (!this.videoUrl || !this.video) return;
    const playback = this.video.paused ? Effect.tryPromise({
      try: () => this.video!.play(),
      catch: () => new Error("This browser cannot play the selected local codec."),
    }) : Effect.sync(() => this.video!.pause());
    void runClientPromise(playback.pipe(Effect.catchAll((error) => Effect.sync(() => { this.status = error.message; }))));
  }

  private enterFullscreen() {
    if (!this.videoUrl || !this.videoStage) return;
    const fullscreen = Effect.tryPromise({
      try: () => this.videoStage!.requestFullscreen(),
      catch: (cause) => new Error(`Fullscreen could not start: ${String(cause)}`),
    });
    void runClientPromise(fullscreen.pipe(Effect.catchAll((error) => Effect.gen(this, function* () {
      yield* clientLog("error", "[WatchView] Video stage fullscreen request failed.", { reason: error.message });
      yield* Effect.sync(() => { this.status = error.message; });
    }))));
  }

  private autoAlign() {
    const file = this.media.get("video")?.file;
    if (!file || this.cues.length < 8) return;
    this.status = "Analyzing speech timing locally…";
    const program = Effect.gen(this, function* () {
      yield* clientLog("info", "[WatchView] Automatic subtitle alignment started.", {
        cueCount: this.cues.length,
        byteCount: file.size,
      });
      const envelope = yield* decodeSpeechEnvelope(file);
      const result = yield* Effect.try({
        try: () => alignSubtitles(envelope, this.cues.map((cue) => ({ start: cue.sourceStartSeconds, end: cue.sourceEndSeconds }))),
        catch: (cause) => cause instanceof Error ? cause : new Error(`Subtitle timing analysis failed: ${String(cause)}`),
      });
      yield* Effect.sync(() => {
        if (result.confidence >= 0.32) {
          this.transform = result.transform;
          this.status = `Alignment applied at ${Math.round(result.confidence * 100)}% confidence.`;
        } else {
          this.transform = SOURCE_TIMING;
          this.status = "Automatic alignment confidence was low; original timing is preserved.";
        }
        this.updateCues();
      });
      yield* clientLog(result.confidence >= 0.32 ? "info" : "warn", "[WatchView] Automatic subtitle alignment completed.", {
        confidence: result.confidence,
        scale: result.transform.scale,
        offsetSeconds: result.transform.offsetSeconds,
        cuesAnalyzed: result.cuesAnalyzed,
      });
    }).pipe(Effect.catchAll((error) => Effect.gen(this, function* () {
      yield* clientLog("error", "[WatchView] Automatic subtitle alignment failed.", {
        reason: error.message,
      });
      yield* Effect.sync(() => {
        this.transform = SOURCE_TIMING;
        this.status = `${error.message} You can still use the manual offset.`;
      });
    })));
    void runClientPromise(program);
  }

  private analyzeRecommendations() {
    const token = tokenState.value;
    const excerpts = selectMediaAnalysisExcerpts(this.cues);
    if (!token) {
      this.aiStatus = "Sign in again before requesting optional AI analysis.";
      return;
    }
    this.aiStatus = "Analyzing a bounded, consented subtitle sample…";
    const analysisRunId = crypto.randomUUID();
    this.analysisRunId = analysisRunId;
    const program = Effect.gen(this, function* () {
      const result = yield* requestMediaRecommendations(token, analysisRunId, this.analysisConsent, excerpts);
      const validated = validateMediaRecommendations(result, this.cues, this.canonicalKeys)
        .map((recommendation) => ({ ...recommendation, candidateId: crypto.randomUUID() }));
      yield* Effect.sync(() => {
        this.aiRecommendations = validated;
        this.aiStatus = validated.length === 0
          ? "No strong, locally validated AI recommendations were found."
          : `${validated.length} AI recommendation${validated.length === 1 ? "" : "s"} passed local evidence checks.`;
      });
    }).pipe(Effect.catchAll((error) => Effect.sync(() => {
      this.aiStatus = error.message;
    })));
    void runClientPromise(program);
  }

  private isLaterRecommendation(recommendation: ActionableMediaRecommendation): boolean {
    const duration = this.video?.duration;
    const earlyWindow = Number.isFinite(duration) && duration && duration > 0 ? Math.min(600, duration * 0.4) : 600;
    return recommendation.firstTimeSeconds > earlyWindow;
  }

  private actOnRecommendation(recommendation: ActionableMediaRecommendation, action: MediaCandidateAction | "reduce" | "replace") {
    if (action === "reduce") {
      this.aiRecommendations = this.aiRecommendations.filter((item) => item.candidateId !== recommendation.candidateId);
      return;
    }
    const token = tokenState.value;
    if (!token || !this.analysisRunId || !this.subtitleTrackFingerprint) {
      this.aiStatus = "Candidate action is unavailable until analysis is complete and you are signed in.";
      return;
    }
    const serverAction = action === "replace" ? "rejected" : action;
    const program = Effect.gen(this, function* () {
      const result = yield* submitMediaCandidateAction(
        token,
        serverAction,
        recommendation,
        this.analysisRunId,
        this.subtitleTrackFingerprint,
      );
      yield* Effect.sync(() => {
        this.candidateStatuses = { ...this.candidateStatuses, [recommendation.candidateId]: result.reason };
        if (action === "replace" || action === "rejected" || action === "not_useful" || action === "already_known") {
          this.aiRecommendations = this.aiRecommendations.filter((item) => item.candidateId !== recommendation.candidateId);
        }
        if (action === "accept" && !result.accepted) {
          this.aiStatus = `No new target was admitted (${result.reason.replaceAll("_", " ")}); use this episode for reinforcement.`;
        }
        if (action === "accept" && result.accepted && result.knowledgePointId) {
          const target: AcceptedTarget = {
            candidateId: recommendation.candidateId,
            knowledgePointId: result.knowledgePointId,
            canonicalKey: recommendation.canonicalKey,
            cueIds: recommendation.evidence.map((evidence) => evidence.cueId),
            subtitleTrackFingerprint: this.subtitleTrackFingerprint,
            primed: false,
          };
          this.acceptedTargets = [...this.acceptedTargets, target];
          this.startPrimer(target);
        }
      });
    }).pipe(Effect.catchAll((error) => Effect.sync(() => { this.aiStatus = error.message; })));
    void runClientPromise(program);
  }

  private startPrimer(target: AcceptedTarget) {
    const token = tokenState.value;
    if (!token) return;
    this.learningStatus = `Preparing a source-distinct primer for ${target.canonicalKey}…`;
    const program = Effect.gen(this, function* () {
      yield* submitLearningEvent(token, {
        knowledgePointId: target.knowledgePointId,
        candidateId: target.candidateId,
        event: "primer_started",
        idempotencyKey: `primer-start:${target.candidateId}`,
      });
      const content = yield* requestLearningContent(token, target.knowledgePointId, "primer");
      yield* validateGeneratedSentence(
        content.exampleSentence,
        content.exampleTargetStart,
        content.exampleTargetEnd,
        this.cues,
        target.subtitleTrackFingerprint,
      );
      yield* Effect.sync(() => {
        this.primer = { target, content, revealed: false };
        this.learningStatus = "Primer passed local source-exclusion validation.";
      });
    }).pipe(Effect.catchAll((error) => Effect.sync(() => { this.learningStatus = error.message; })));
    void runClientPromise(program);
  }

  private completePrimer() {
    const token = tokenState.value;
    if (!token || !this.primer) return;
    const target = this.primer.target;
    const program = Effect.gen(this, function* () {
      yield* submitLearningEvent(token, {
        knowledgePointId: target.knowledgePointId,
        candidateId: target.candidateId,
        event: "primer_retrieval_completed",
        idempotencyKey: `primer-complete:${target.candidateId}`,
      });
      yield* Effect.sync(() => {
        this.acceptedTargets = this.acceptedTargets.map((item) =>
          item.candidateId === target.candidateId ? { ...item, primed: true } : item
        );
        this.primer = null;
        this.learningStatus = `${target.canonicalKey} is primed; watch normally and listen for it.`;
      });
      const pending = yield* fetchPendingMediaCheckouts(token);
      yield* Effect.sync(() => { this.pendingCheckouts = pending; });
    }).pipe(Effect.catchAll((error) => Effect.sync(() => { this.learningStatus = error.message; })));
    void runClientPromise(program);
  }

  private speakPrimer() {
    if (!this.primer || !("speechSynthesis" in globalThis)) return;
    const utterance = new SpeechSynthesisUtterance(this.primer.content.exampleSentence);
    utterance.lang = "ja-JP";
    speechSynthesis.speak(utterance);
  }

  private openCheckout(item: PendingMediaCheckout) {
    const token = tokenState.value;
    if (!token) return;
    this.learningStatus = `Generating a fresh checkout for ${item.canonicalKey}…`;
    const program = Effect.gen(this, function* () {
      const canValidateSource = Boolean(
        item.subtitleTrackFingerprint
        && item.subtitleTrackFingerprint === this.subtitleTrackFingerprint
        && this.cues.length > 0,
      );
      const selected = canValidateSource
        ? yield* requestExerciseWithCachedFallback(
          token, item.knowledgePointId, "checkout", this.cues, item.subtitleTrackFingerprint!,
        )
        : { exercise: yield* fetchNextValidatedExercise(token, item.knowledgePointId), cached: true as const };
      yield* Effect.sync(() => {
        this.checkout = {
          item,
          exerciseId: selected.exercise.id,
          content: selected.exercise.content,
          cached: selected.cached,
          openedAt: Date.now(),
          revealed: false,
        };
        this.learningStatus = selected.cached
          ? "AI generation was unavailable; using a cached exercise validated on a source-capable device."
          : "Checkout passed local source and exercise-bank validation.";
      });
    }).pipe(Effect.catchAll((error) => Effect.sync(() => { this.learningStatus = error.message; })));
    void runClientPromise(program);
  }

  private gradeCheckout(recalled: boolean) {
    const token = tokenState.value;
    if (!token || !this.checkout) return;
    const item = this.checkout.item;
    const exerciseId = this.checkout.exerciseId;
    const responseTimeMs = Math.max(0, Date.now() - this.checkout.openedAt);
    void runClientPromise(submitLearningEvent(token, {
      knowledgePointId: item.knowledgePointId,
      candidateId: item.candidateId,
      event: recalled ? "checkout_recalled" : "checkout_missed",
      idempotencyKey: `checkout:${item.id}`,
      exerciseId,
      responseTimeMs,
    }).pipe(
      Effect.tap(() => Effect.gen(this, function* () {
        yield* Effect.sync(() => {
          this.pendingCheckouts = this.pendingCheckouts.filter((entry) => entry.id !== item.id);
          this.checkout = null;
          this.learningStatus = recalled
            ? "Recalled; long intervals stay capped until a second varied context succeeds."
            : "Not recalled; a shorter follow-up is scheduled.";
        });
        if (item.subtitleTrackFingerprint === this.subtitleTrackFingerprint && this.cues.length > 0) {
          yield* generateValidateAndStoreExercise(
            token, item.knowledgePointId, "review", this.cues, this.subtitleTrackFingerprint,
          ).pipe(Effect.catchAll(() => Effect.void));
        }
      })),
      Effect.catchAll((error) => Effect.sync(() => { this.learningStatus = error.message; })),
    ));
  }

  private alternativeCheckout(outcome: "already_known" | "wrongly_analyzed" | "not_useful") {
    const token = tokenState.value;
    if (!token || !this.checkout) return;
    const item = this.checkout.item;
    void runClientPromise(submitAlternativeCheckout(token, item, outcome).pipe(
      Effect.tap(() => Effect.sync(() => {
        this.pendingCheckouts = this.pendingCheckouts.filter((entry) => entry.id !== item.id);
        this.checkout = null;
        this.learningStatus = outcome.replaceAll("_", " ");
      })),
      Effect.catchAll((error) => Effect.sync(() => { this.learningStatus = error.message; })),
    ));
  }

  private cueHasMarker(cueId: string): boolean {
    return this.markersEnabled && this.acceptedTargets.some((target) => target.primed && target.cueIds.includes(cueId));
  }

  private deleteAdaptiveData() {
    const token = tokenState.value;
    if (!token || !globalThis.confirm("Delete synced adaptive-media provenance, checkouts, exercises, and this browser's private source signatures? Knowledge-point review progress is kept.")) return;
    void runClientPromise(deleteAllAdaptiveMediaData(token).pipe(
      Effect.tap(() => Effect.sync(() => {
        this.acceptedTargets = [];
        this.pendingCheckouts = [];
        this.checkout = null;
        this.primer = null;
        this.learningStatus = "Adaptive-media data was deleted. Existing point-level review progress was kept.";
      })),
      Effect.catchAll((error) => Effect.sync(() => { this.learningStatus = error.message; })),
    ));
  }

  private renderToken(token: NormalizedToken) {
    return html`<span data-subtitle-token style=${`margin-right:${token.punctuation ? 0 : this.spacing}em`}>${this.furigana && token.reading ? html`<span data-subtitle-reading>${token.reading}</span>` : ""}<span data-subtitle-surface>${token.surface}</span></span>`;
  }

  private renderCue(cue: NormalizedCue) {
    const lines: NormalizedToken[][] = [[]];
    for (const token of cue.tokens) {
      if (token.lineBreak) lines.push([]);
      else lines.at(-1)!.push(token);
    }
    return lines.map((line) => html`<div data-subtitle-line>${line.map((token) => this.renderToken(token))}</div>`);
  }

  override render() {
    const isMatroska = this.videoName.toLowerCase().endsWith(".mkv");
    const localAudioRepairAvailable = isLoopbackHostname(window.location.hostname);
    return html`
      <section class="mx-auto max-w-6xl space-y-5" data-private-media-boundary
        @dragover=${(event: DragEvent) => event.preventDefault()}
        @drop=${(event: DragEvent) => { event.preventDefault(); if (event.dataTransfer?.files) this.acceptFiles(event.dataTransfer.files); }}>
        <header class="flex flex-wrap items-end justify-between gap-4">
          <div><p class="text-xs font-semibold uppercase tracking-widest text-emerald-400">Watch · local media</p><h1 class="text-3xl font-bold">Adaptive Japanese playback</h1></div>
          <p class="rounded border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">Video and audio never leave this machine.</p>
        </header>
        <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div class="space-y-3">
            <div data-video-stage class="relative aspect-video overflow-hidden rounded-xl border border-zinc-700 bg-black">
              ${this.videoUrl ? html`<video class="h-full w-full object-contain" .src=${this.videoUrl} playsinline controls
                @play=${this.onVideoPlay} @pause=${this.onVideoPause} @seeking=${this.onVideoSeeking}
                @ratechange=${this.onVideoRateChange} @volumechange=${this.onVideoVolumeChange}
                @timeupdate=${this.updateCues} @ended=${this.onVideoEnded}></video>` : html`<div class="grid h-full place-items-center text-zinc-500">Choose or drop an MKV, MP4, or WebM file</div>`}
              ${this.repairedAudioUrl ? html`<audio data-repaired-audio hidden .src=${this.repairedAudioUrl} preload="auto" @timeupdate=${this.updateCues}></audio>` : ""}
              <div data-subtitle-overlay class="pointer-events-none absolute inset-x-[4%] bottom-[9%] z-10 text-center font-semibold text-white [text-shadow:0_2px_5px_#000,0_0_2px_#000]" style=${`font-size:clamp(36px,${this.subtitleSize}cqw,180px)`}>
                ${this.activeCues.map((cue) => html`<div data-subtitle-cue class=${this.cueHasMarker(cue.id) ? "border-l-4 border-emerald-400 pl-2" : ""}>${this.renderCue(cue)}</div>`)}
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-800 p-3">
              <button class="rounded bg-emerald-600 px-4 py-2 font-semibold" @click=${this.togglePlayback}>Play / pause</button>
              <label class="cursor-pointer rounded border border-zinc-600 px-3 py-2">Video<input hidden type="file" accept=".mkv,.mp4,.webm,video/*" @change=${(event: Event) => { const file = (event.target as HTMLInputElement).files?.[0]; if (file) this.loadVideo(file); }}></label>
              <label class="cursor-pointer rounded border border-zinc-600 px-3 py-2">Subtitles<input hidden type="file" accept=".ass,.ssa,.srt" @change=${(event: Event) => { const file = (event.target as HTMLInputElement).files?.[0]; if (file) this.loadSubtitles(file); }}></label>
              <button class="rounded border border-zinc-600 px-3 py-2 disabled:opacity-40" ?disabled=${!this.videoUrl || this.cues.length < 8} @click=${this.autoAlign}>Auto-align locally</button>
              <button data-fullscreen-button class="rounded border border-zinc-600 px-3 py-2 disabled:opacity-40" ?disabled=${!this.videoUrl} @click=${this.enterFullscreen}>Fullscreen</button>
            </div>
            <p class="text-sm text-zinc-400" role="status">${this.status}</p>
          </div>
          <aside class="space-y-4 rounded-xl border border-zinc-700 bg-zinc-800 p-4">
            <div><h2 class="font-semibold">Local files</h2><p class="truncate text-sm text-zinc-400">${this.videoName || "No video"}</p><p class="truncate text-sm text-zinc-400">${this.subtitleName || "No subtitles"}</p></div>
            <label class="flex justify-between">Furigana <input type="checkbox" .checked=${this.furigana} @change=${(event: Event) => { this.furigana = (event.target as HTMLInputElement).checked; }}></label>
            <label class="flex justify-between">Encounter markers <input type="checkbox" .checked=${this.markersEnabled} @change=${(event: Event) => { this.markersEnabled = (event.target as HTMLInputElement).checked; }}></label>
            <label class="block text-sm">Word spacing<input class="w-full" type="range" min="0" max="0.5" step="0.025" .value=${String(this.spacing)} @input=${(event: Event) => { this.spacing = Number((event.target as HTMLInputElement).value); }}></label>
            <label class="block text-sm">Subtitle size<input class="w-full" type="range" min="4" max="14" step="0.5" .value=${String(this.subtitleSize)} @input=${(event: Event) => { this.subtitleSize = Number((event.target as HTMLInputElement).value); }}></label>
            <label class="block text-sm">Manual offset (${this.transform.offsetSeconds.toFixed(1)}s)<input class="w-full" type="range" min="-10" max="10" step="0.1" .value=${String(this.transform.offsetSeconds)} @input=${(event: Event) => { this.transform = { id: "manual", version: "timing_transform_v1", scale: 1, offsetSeconds: Number((event.target as HTMLInputElement).value) }; this.updateCues(); }}></label>
            ${isMatroska ? html`
              <div class="space-y-2 border-t border-amber-900 pt-3">
                <div><h2 class="font-semibold text-amber-300">Silent MKV in Firefox?</h2><p class="text-xs text-zinc-400">Convert only the first audio track to Opus on this machine; the original video remains untouched.</p></div>
                <button class="w-full rounded bg-amber-700 px-3 py-2 text-sm font-semibold disabled:opacity-40"
                  ?disabled=${this.repairingAudio || this.repairedAudioActive || !localAudioRepairAvailable}
                  @click=${this.repairFirefoxAudio}>${this.repairedAudioActive ? "Audio fixed ✓" : this.repairingAudio ? "Repairing audio…" : "Fix audio in Firefox"}</button>
                ${this.repairingAudio ? html`<progress class="w-full" max="1" .value=${this.audioRepairProgress}></progress>` : ""}
                ${this.repairedAudioActive ? html`<div class="flex items-center gap-2 text-xs"><button class="rounded border border-zinc-600 px-2 py-1" @click=${this.toggleRepairedAudioMute}>${this.repairedAudioMuted ? "Unmute repaired audio" : "Mute repaired audio"}</button><input class="min-w-0 flex-1" aria-label="Repaired audio volume" type="range" min="0" max="1" step="0.05" .value=${String(this.repairedAudioVolume)} @input=${this.setRepairedAudioVolume}></div>` : ""}
                <p class="text-xs ${this.repairedAudioActive ? "text-emerald-300" : "text-zinc-400"}" role="status">${this.audioRepairStatus || (localAudioRepairAvailable ? "Requires FFmpeg on your PATH." : "Run Gafu locally to use the same-machine repair helper.")}</p>
              </div>
            ` : ""}
            <div class="border-t border-zinc-700 pt-3"><h2 class="font-semibold">Episode syllabus</h2><p class="mb-2 text-xs text-zinc-500">Up to three targets; dialogue is not shown here.</p>${this.aiRecommendations.length ? this.aiRecommendations.slice(0, 3).map((item) => { const later = this.isLaterRecommendation(item); return html`<div class="mb-2 space-y-2 rounded bg-zinc-900 p-2"><strong>${item.canonicalKey}</strong><p class="text-xs text-zinc-400">${item.reading ? `${item.reading} · ` : ""}${item.meaning} · about ${Math.round(item.firstTimeSeconds / 60)} min · ${item.occurrenceCount} encounters · ${Math.round(item.confidence * 100)}% confidence</p>${later ? html`<label class="flex gap-2 text-xs text-amber-300"><input type="checkbox" .checked=${Boolean(this.laterAccepted[item.candidateId])} @change=${(event: Event) => { this.laterAccepted = { ...this.laterAccepted, [item.candidateId]: (event.target as HTMLInputElement).checked }; }}> This target appears outside the early window; teach it anyway.</label>` : ""}<div class="flex flex-wrap gap-1 text-xs"><button class="rounded bg-emerald-700 px-2 py-1 disabled:opacity-40" ?disabled=${later && !this.laterAccepted[item.candidateId]} @click=${() => this.actOnRecommendation(item, "accept")}>Accept</button><button class="rounded border border-zinc-600 px-2 py-1" @click=${() => this.actOnRecommendation(item, "replace")}>Replace</button><button class="rounded border border-zinc-600 px-2 py-1" @click=${() => this.actOnRecommendation(item, "reduce")}>Reduce</button><button class="rounded border border-zinc-600 px-2 py-1" @click=${() => this.actOnRecommendation(item, "already_known")}>Already known</button><button class="rounded border border-zinc-600 px-2 py-1" @click=${() => this.actOnRecommendation(item, "not_useful")}>Not useful</button></div>${this.candidateStatuses[item.candidateId] ? html`<p class="text-xs text-emerald-300">${this.candidateStatuses[item.candidateId]}</p>` : ""}</div>`; }) : this.syllabus.items.length ? this.syllabus.items.map((item) => html`<div class="mb-2 rounded bg-zinc-900 p-2"><strong>${item.label}</strong><p class="text-xs text-zinc-400">${item.kind} · ${item.occurrenceCount} encounters</p></div>`) : html`<p class="text-sm text-zinc-500">Load subtitles to analyze candidates.</p>`}</div>
            <div class="space-y-2 border-t border-zinc-700 pt-3">
              <label class="flex gap-2 text-xs"><input type="checkbox" .checked=${this.analysisConsent} @change=${(event: Event) => { this.analysisConsent = (event.target as HTMLInputElement).checked; }}> Send at most 12 shortlisted subtitle excerpts for optional AI recommendations. Video and audio are never sent to remote services. Gafu does not store raw excerpts in its database; the configured AI provider's retention policy still applies.</label>
              <button class="rounded border border-zinc-600 px-3 py-2 text-sm disabled:opacity-40" ?disabled=${!this.analysisConsent || this.cues.length === 0} @click=${this.analyzeRecommendations}>Analyze consented excerpts</button>
              <button class="rounded border border-rose-900 px-3 py-2 text-xs text-rose-300" @click=${this.deleteAdaptiveData}>Delete adaptive-media data</button>
              <p class="text-xs text-zinc-500">Deletion removes synced provenance, candidates, checkouts, and generated exercises plus this browser's private signatures. Point-level study progress is kept so deleting media history cannot erase unrelated learning.</p>
              <p class="text-xs text-zinc-500" role="status">${this.aiStatus}</p>
            </div>
            <p class="border-t border-zinc-700 pt-3 text-xs text-zinc-500">The optional browser-WASM FFmpeg core remains disabled pending licence approval; local repair uses your installed system FFmpeg.</p>
          </aside>
        </div>
        <section class="space-y-4 rounded-xl border border-zinc-700 bg-zinc-900 p-5" aria-label="Adaptive learning loop">
          <div class="flex items-center justify-between gap-3"><div><h2 class="text-lg font-semibold">Prime and checkout</h2><p class="text-xs text-zinc-500">Generated teaching content is shown only after local source-copy validation.</p></div><p class="text-sm text-emerald-300" role="status">${this.learningStatus}</p></div>
          ${this.primer ? html`
            <article class="space-y-3 rounded-lg border border-emerald-800 bg-emerald-950/20 p-4">
              <h3 class="font-semibold">Primer · ${this.primer.content.form} ${this.primer.content.reading ? html`<span class="text-zinc-400">(${this.primer.content.reading})</span>` : ""}</h3>
              <p>${this.primer.content.senseOrFunction}</p><p class="text-sm text-zinc-400">Formation: ${this.primer.content.formation}</p>
              <div class="rounded bg-zinc-950 p-3"><p class="text-xs text-zinc-500">Different example</p><p>${this.primer.content.exampleContext}</p><p class="text-lg">${this.primer.content.exampleSentence}</p><button class="mt-2 rounded border border-zinc-600 px-2 py-1 text-xs" @click=${this.speakPrimer}>Play local audio</button></div>
              <div class="rounded bg-zinc-800 p-3"><p class="font-medium">${this.primer.content.retrievalPrompt}</p>${this.primer.revealed ? html`<p class="mt-2 text-emerald-300">${this.primer.content.retrievalAnswer}</p><div class="mt-2 flex gap-2"><button class="rounded bg-emerald-700 px-3 py-1" @click=${this.completePrimer}>I retrieved it</button><button class="rounded border border-zinc-600 px-3 py-1" @click=${() => { if (this.primer) this.primer = { ...this.primer, revealed: false }; }}>Try again</button></div>` : html`<button class="mt-2 rounded border border-zinc-600 px-3 py-1" @click=${() => { if (this.primer) this.primer = { ...this.primer, revealed: true }; }}>Reveal answer</button>`}</div>
              <p class="text-sm text-amber-300">Listening mission: ${this.primer.content.listeningMission}</p>
            </article>
          ` : ""}
          ${this.checkout ? html`
            <article class="space-y-3 rounded-lg border border-sky-800 bg-sky-950/20 p-4">
              <h3 class="font-semibold">Checkout · ${this.checkout.item.canonicalKey}</h3>
              <p>${this.checkout.content.context}</p>
              ${this.checkout.revealed ? html`<div class="rounded bg-zinc-950 p-3"><p class="text-lg">${this.checkout.content.japaneseSentence}</p><p class="mt-2 text-sky-300">${this.checkout.content.answer}</p><p class="text-sm text-zinc-400">${this.checkout.content.explanation}</p></div>` : html`<button class="rounded border border-zinc-600 px-3 py-1" @click=${() => { if (this.checkout) this.checkout = { ...this.checkout, revealed: true }; }}>Reveal fresh answer</button>`}
              <div class="flex flex-wrap gap-2 text-sm"><button class="rounded bg-emerald-700 px-3 py-1" @click=${() => this.gradeCheckout(true)}>Recalled</button><button class="rounded bg-rose-800 px-3 py-1" @click=${() => this.gradeCheckout(false)}>Not recalled</button><button class="rounded border border-zinc-600 px-3 py-1" @click=${() => this.alternativeCheckout("already_known")}>Already known</button><button class="rounded border border-zinc-600 px-3 py-1" @click=${() => this.alternativeCheckout("wrongly_analyzed")}>Wrongly analyzed</button><button class="rounded border border-zinc-600 px-3 py-1" @click=${() => this.alternativeCheckout("not_useful")}>Not useful</button></div>
            </article>
          ` : this.pendingCheckouts.length ? html`<div><p class="mb-2 text-sm text-zinc-400">Checkout is available now, including after an early stop or refresh.</p><div class="flex flex-wrap gap-2">${this.pendingCheckouts.map((item) => html`<button class="rounded border border-sky-700 px-3 py-2 text-sm" @click=${() => this.openCheckout(item)}>${item.canonicalKey}</button>`)}</div></div>` : html`<p class="text-sm text-zinc-500">Accept and complete a primer to reserve checkout and next-day priority.</p>`}
        </section>
      </section>
    `;
  }
}
