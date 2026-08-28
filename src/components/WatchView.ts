import { Effect } from "effect";
import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { runClientPromise } from "../lib/client/runtime.ts";
import { knowledgePointCatalogStore, knowledgePointStore } from "../lib/client/stores/knowledgePointStore.ts";
import type { NormalizedCue, TimingTransform } from "../lib/shared/adaptive-media.ts";
import { alignSubtitles } from "../lib/client/media/adaptive/alignment.ts";
import { decodeSpeechEnvelope } from "../lib/client/media/adaptive/audio-analysis.ts";
import { LocalMediaSession } from "../lib/client/media/adaptive/local-media.ts";
import { CueLifecycleTracker } from "../lib/client/media/adaptive/playback.ts";
import { buildSourceExclusionSignatures, enrichSourceSemanticSignatures, getOrCreateSourceSignatureKey, persistSourceExclusionSignatures } from "../lib/client/media/adaptive/source-signature-store.ts";
import { buildEpisodeSyllabus, type EpisodeSyllabus } from "../lib/client/media/adaptive/syllabus.ts";
import { findActiveCues, fingerprintSubtitleBytes, parseSubtitleTrack } from "../lib/client/media/adaptive/subtitles.ts";
import { tokenizeJapaneseWithFallback } from "../lib/client/media/adaptive/tokenizer.ts";
import { tokenState } from "../lib/client/stores/authStore.ts";
import {
  requestMediaRecommendations,
  selectMediaAnalysisExcerpts,
  submitMediaCandidateAction,
  validateMediaRecommendations,
  type ActionableMediaRecommendation,
  type MediaCandidateAction,
} from "../lib/client/media/adaptive/recommendations.ts";

const SOURCE_TIMING: TimingTransform = { id: "source", version: "timing_transform_v1", scale: 1, offsetSeconds: 0 };

@customElement("watch-view")
export class WatchView extends LitElement {
  @query("video") private video?: HTMLVideoElement;
  @state() private videoUrl = "";
  @state() private videoName = "";
  @state() private subtitleName = "";
  @state() private cues: readonly NormalizedCue[] = [];
  @state() private activeCues: readonly NormalizedCue[] = [];
  @state() private transform: TimingTransform = SOURCE_TIMING;
  @state() private status = "Choose a local video and subtitle track.";
  @state() private furigana = true;
  @state() private spacing = 0.32;
  @state() private subtitleSize = 32;
  @state() private syllabus: EpisodeSyllabus = { items: [], rejectedCandidateIds: [] };
  @state() private analysisConsent = false;
  @state() private aiRecommendations: readonly ActionableMediaRecommendation[] = [];
  @state() private aiStatus = "Optional AI analysis is off.";
  @state() private candidateStatuses: Readonly<Record<string, string>> = {};
  @state() private laterAccepted: Readonly<Record<string, boolean>> = {};
  private canonicalKeys: ReadonlySet<string> = new Set();
  private analysisRunId = "";
  private subtitleTrackFingerprint = "";
  private readonly media = new LocalMediaSession();
  private readonly lifecycle = new CueLifecycleTracker();

  protected override createRenderRoot() { return this; }

  override connectedCallback() {
    super.connectedCallback();
    document.addEventListener("keydown", this.onKeyDown);
  }

  override disconnectedCallback() {
    document.removeEventListener("keydown", this.onKeyDown);
    this.video?.pause();
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
      this.updateCues();
    }
  };

  private loadVideo(file: File) {
    const handle = this.media.replace("video", file);
    this.videoUrl = handle.objectUrl;
    this.videoName = file.name;
    this.status = "Video ready. Playback remains entirely local.";
  }

  private loadSubtitles(file: File) {
    const program = Effect.gen(this, function* () {
      const bytes = new Uint8Array(yield* Effect.tryPromise({
        try: () => file.arrayBuffer(),
        catch: (cause) => new Error(`Could not read subtitle file: ${String(cause)}`),
      }));
      const fingerprint = yield* fingerprintSubtitleBytes(bytes);
      const parsed = parseSubtitleTrack(file.name, new TextDecoder().decode(bytes), fingerprint);
      const enriched = yield* Effect.forEach(parsed, (cue) => Effect.map(
        tokenizeJapaneseWithFallback(cue.normalizedText),
        (tokens) => ({ ...cue, tokens }),
      ), { concurrency: 4 });
      const sourceSignatureKey = yield* getOrCreateSourceSignatureKey();
      const sourceSignatures = yield* buildSourceExclusionSignatures(enriched, sourceSignatureKey);
      if (enriched[0]) yield* persistSourceExclusionSignatures(enriched[0].subtitleTrackFingerprint, sourceSignatures);
      if (enriched[0]) {
        const trackFingerprint = enriched[0].subtitleTrackFingerprint;
        void runClientPromise(enrichSourceSemanticSignatures(enriched, sourceSignatures).pipe(
          Effect.flatMap((semanticSignatures) => persistSourceExclusionSignatures(trackFingerprint, semanticSignatures)),
          Effect.catchAll(() => Effect.void),
        ));
      }
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
      const syllabus = buildEpisodeSyllabus(enriched, catalog, learner);
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
    }).pipe(Effect.catchAll((error) => Effect.sync(() => { this.status = error.message; })));
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
    this.activeCues = findActiveCues(this.cues, this.video.currentTime, this.transform);
    for (const event of this.lifecycle.update(this.cues, this.video.currentTime, this.transform)) {
      this.dispatchEvent(new CustomEvent("gafu-media-cue", { detail: event, bubbles: true, composed: true }));
    }
  };

  private togglePlayback() {
    if (!this.videoUrl || !this.video) return;
    const playback = this.video.paused ? Effect.tryPromise({
      try: () => this.video!.play(),
      catch: () => new Error("This browser cannot play the selected local codec."),
    }) : Effect.sync(() => this.video!.pause());
    void runClientPromise(playback.pipe(Effect.catchAll((error) => Effect.sync(() => { this.status = error.message; }))));
  }

  private autoAlign() {
    const file = this.media.get("video")?.file;
    if (!file || this.cues.length < 8) return;
    this.status = "Analyzing speech timing locally…";
    const program = Effect.gen(this, function* () {
      const envelope = yield* decodeSpeechEnvelope(file);
      const result = alignSubtitles(envelope, this.cues.map((cue) => ({ start: cue.sourceStartSeconds, end: cue.sourceEndSeconds })));
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
    }).pipe(Effect.catchAll(() => Effect.sync(() => {
      this.transform = SOURCE_TIMING;
      this.status = "Automatic alignment is unavailable for this codec; use manual offset.";
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
      });
    }).pipe(Effect.catchAll((error) => Effect.sync(() => { this.aiStatus = error.message; })));
    void runClientPromise(program);
  }

  private renderToken(cue: NormalizedCue) {
    return cue.tokens.map((token) => token.lineBreak ? html`<br>` : html`
      <span class=${token.punctuation ? "" : "inline-block"} style=${`margin-right:${token.punctuation ? 0 : this.spacing}em`}>
        ${this.furigana && token.reading ? html`<ruby>${token.surface}<rt>${token.reading}</rt></ruby>` : token.surface}
      </span>
    `);
  }

  override render() {
    return html`
      <section class="mx-auto max-w-6xl space-y-5" data-private-media-boundary
        @dragover=${(event: DragEvent) => event.preventDefault()}
        @drop=${(event: DragEvent) => { event.preventDefault(); if (event.dataTransfer?.files) this.acceptFiles(event.dataTransfer.files); }}>
        <header class="flex flex-wrap items-end justify-between gap-4">
          <div><p class="text-xs font-semibold uppercase tracking-widest text-emerald-400">Watch · local media</p><h1 class="text-3xl font-bold">Adaptive Japanese playback</h1></div>
          <p class="rounded border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">Video and audio never leave this browser.</p>
        </header>
        <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div class="space-y-3">
            <div class="relative aspect-video overflow-hidden rounded-xl border border-zinc-700 bg-black">
              ${this.videoUrl ? html`<video class="h-full w-full" .src=${this.videoUrl} playsinline controls @timeupdate=${this.updateCues}></video>` : html`<div class="grid h-full place-items-center text-zinc-500">Choose or drop an MKV, MP4, or WebM file</div>`}
              <div class="pointer-events-none absolute inset-x-4 bottom-8 text-center font-semibold text-white [text-shadow:0_2px_5px_#000]" style=${`font-size:${this.subtitleSize}px`}>
                ${this.activeCues.map((cue) => html`<div>${this.renderToken(cue)}</div>`)}
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-800 p-3">
              <button class="rounded bg-emerald-600 px-4 py-2 font-semibold" @click=${this.togglePlayback}>Play / pause</button>
              <label class="cursor-pointer rounded border border-zinc-600 px-3 py-2">Video<input hidden type="file" accept=".mkv,.mp4,.webm,video/*" @change=${(event: Event) => { const file = (event.target as HTMLInputElement).files?.[0]; if (file) this.loadVideo(file); }}></label>
              <label class="cursor-pointer rounded border border-zinc-600 px-3 py-2">Subtitles<input hidden type="file" accept=".ass,.ssa,.srt" @change=${(event: Event) => { const file = (event.target as HTMLInputElement).files?.[0]; if (file) this.loadSubtitles(file); }}></label>
              <button class="rounded border border-zinc-600 px-3 py-2 disabled:opacity-40" ?disabled=${!this.videoUrl || this.cues.length < 8} @click=${this.autoAlign}>Auto-align locally</button>
              <button class="rounded border border-zinc-600 px-3 py-2" @click=${() => this.video?.requestFullscreen()}>Fullscreen</button>
            </div>
            <p class="text-sm text-zinc-400" role="status">${this.status}</p>
          </div>
          <aside class="space-y-4 rounded-xl border border-zinc-700 bg-zinc-800 p-4">
            <div><h2 class="font-semibold">Local files</h2><p class="truncate text-sm text-zinc-400">${this.videoName || "No video"}</p><p class="truncate text-sm text-zinc-400">${this.subtitleName || "No subtitles"}</p></div>
            <label class="flex justify-between">Furigana <input type="checkbox" .checked=${this.furigana} @change=${(event: Event) => { this.furigana = (event.target as HTMLInputElement).checked; }}></label>
            <label class="block text-sm">Word spacing<input class="w-full" type="range" min="0" max="0.7" step="0.05" .value=${String(this.spacing)} @input=${(event: Event) => { this.spacing = Number((event.target as HTMLInputElement).value); }}></label>
            <label class="block text-sm">Subtitle size<input class="w-full" type="range" min="22" max="46" step="2" .value=${String(this.subtitleSize)} @input=${(event: Event) => { this.subtitleSize = Number((event.target as HTMLInputElement).value); }}></label>
            <label class="block text-sm">Manual offset (${this.transform.offsetSeconds.toFixed(1)}s)<input class="w-full" type="range" min="-10" max="10" step="0.1" .value=${String(this.transform.offsetSeconds)} @input=${(event: Event) => { this.transform = { id: "manual", version: "timing_transform_v1", scale: 1, offsetSeconds: Number((event.target as HTMLInputElement).value) }; this.updateCues(); }}></label>
            <div class="border-t border-zinc-700 pt-3"><h2 class="font-semibold">Episode syllabus</h2><p class="mb-2 text-xs text-zinc-500">Up to three targets; dialogue is not shown here.</p>${this.aiRecommendations.length ? this.aiRecommendations.slice(0, 3).map((item) => { const later = this.isLaterRecommendation(item); return html`<div class="mb-2 space-y-2 rounded bg-zinc-900 p-2"><strong>${item.canonicalKey}</strong><p class="text-xs text-zinc-400">${item.reading ? `${item.reading} · ` : ""}${item.meaning} · about ${Math.round(item.firstTimeSeconds / 60)} min · ${item.occurrenceCount} encounters · ${Math.round(item.confidence * 100)}% confidence</p>${later ? html`<label class="flex gap-2 text-xs text-amber-300"><input type="checkbox" .checked=${Boolean(this.laterAccepted[item.candidateId])} @change=${(event: Event) => { this.laterAccepted = { ...this.laterAccepted, [item.candidateId]: (event.target as HTMLInputElement).checked }; }}> This target appears outside the early window; teach it anyway.</label>` : ""}<div class="flex flex-wrap gap-1 text-xs"><button class="rounded bg-emerald-700 px-2 py-1 disabled:opacity-40" ?disabled=${later && !this.laterAccepted[item.candidateId]} @click=${() => this.actOnRecommendation(item, "accept")}>Accept</button><button class="rounded border border-zinc-600 px-2 py-1" @click=${() => this.actOnRecommendation(item, "replace")}>Replace</button><button class="rounded border border-zinc-600 px-2 py-1" @click=${() => this.actOnRecommendation(item, "reduce")}>Reduce</button><button class="rounded border border-zinc-600 px-2 py-1" @click=${() => this.actOnRecommendation(item, "already_known")}>Already known</button><button class="rounded border border-zinc-600 px-2 py-1" @click=${() => this.actOnRecommendation(item, "not_useful")}>Not useful</button></div>${this.candidateStatuses[item.candidateId] ? html`<p class="text-xs text-emerald-300">${this.candidateStatuses[item.candidateId]}</p>` : ""}</div>`; }) : this.syllabus.items.length ? this.syllabus.items.map((item) => html`<div class="mb-2 rounded bg-zinc-900 p-2"><strong>${item.label}</strong><p class="text-xs text-zinc-400">${item.kind} · ${item.occurrenceCount} encounters</p></div>`) : html`<p class="text-sm text-zinc-500">Load subtitles to analyze candidates.</p>`}</div>
            <div class="space-y-2 border-t border-zinc-700 pt-3">
              <label class="flex gap-2 text-xs"><input type="checkbox" .checked=${this.analysisConsent} @change=${(event: Event) => { this.analysisConsent = (event.target as HTMLInputElement).checked; }}> Send at most 12 shortlisted subtitle excerpts for optional AI recommendations. Video and audio are never sent.</label>
              <button class="rounded border border-zinc-600 px-3 py-2 text-sm disabled:opacity-40" ?disabled=${!this.analysisConsent || this.cues.length === 0} @click=${this.analyzeRecommendations}>Analyze consented excerpts</button>
              <p class="text-xs text-zinc-500" role="status">${this.aiStatus}</p>
            </div>
            <p class="border-t border-zinc-700 pt-3 text-xs text-amber-300">Audio repair falls back to original audio while the FFmpeg core licence gate remains unresolved.</p>
          </aside>
        </div>
      </section>
    `;
  }
}
