import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { effect } from "@preact/signals-core";
import { grammarPointStore, grammarPointCatalogStore, calculateRetrievability } from "../lib/client/stores/grammarPointStore.ts";
import { userPreferencesStore } from "../lib/client/stores/userPreferencesStore.ts";
import { logout, tokenState } from "../lib/client/stores/authStore.ts";
import {
  generateExportPayload,
  importSessionPayload,
  type ImportSessionProgress,
} from "../lib/client/stores/sessionSyncStore.ts";
import { clientLog } from "../lib/client/clientLog.ts";
import { runClientUnscoped } from "../lib/client/runtime.ts";
import { navigate } from "../lib/client/router.ts";
import { Effect } from "effect";
import { fetchNextValidatedExercise } from "../lib/client/media/adaptive/learning-content.ts";
import { activeSessionStore, type SessionCard } from "../lib/client/stores/activeSessionStore.ts";
import { requestDailySessionGeneration } from "../lib/client/ai/daily-session-generation.ts";
import { DailySessionGenerationRequestSchema } from "../lib/server/ai/schema.ts";
import { orderReviewQueue } from "../lib/shared/adaptive-scheduling.ts";

@customElement("study-desk")
export class StudyDesk extends LitElement {
  @state()
  private showQueue = false;

  @state()
  private pasteValue = "";

  @state()
  private importError: string | null = null;

  @state()
  private importProgress: ImportSessionProgress | null = null;

  @state()
  private saveSuccessMessage: string | null = null;

  @state()
  private adaptiveReviewLoading = false;

  @state()
  private sessionGenerationLoading = false;

  private _disposeEffect?: () => void;

  protected override createRenderRoot() {
    return this;
  }

  override connectedCallback() {
    super.connectedCallback();
    runClientUnscoped(grammarPointStore.load());
    runClientUnscoped(grammarPointCatalogStore.load());
    
    this._disposeEffect = effect(() => {
      const count = grammarPointStore.state.value.length;
      const catalogCount = grammarPointCatalogStore.state.value.length;
      // Subscribe to preference signals
      void userPreferencesStore.dailyReviewLimit.value;
      void userPreferencesStore.dailyNewRuleLimit.value;
      void userPreferencesStore.enforceMasteryGates.value;
      void grammarPointStore.activeMasteryRate.value;
      void grammarPointStore.unmasteredActiveRules.value;
      void grammarPointStore.unstartedCount.value;
      void grammarPointStore.learningCount.value;
      void grammarPointStore.masteredCount.value;
      void grammarPointStore.graduatedCount.value;
      void grammarPointStore.averageDifficulty.value;
      void grammarPointStore.averageRetrievability.value;

      runClientUnscoped(clientLog("info", `[StudyDesk] Store updated - progress count: ${count}, catalog count: ${catalogCount}`));
      this.requestUpdate();
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._disposeEffect?.();
  }

  private triggerExport = (e: Event) => {
    const btn = e.target as HTMLButtonElement;
    const originalText = btn.textContent || "";
    btn.textContent = "⏱️ Compiling...";
    btn.disabled = true;

    runClientUnscoped(
      generateExportPayload().pipe(
        Effect.andThen(() => Effect.sync(() => {
          btn.textContent = "✅ Copied to Clipboard!";
          setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
          }, 2000);
        })),
        Effect.catchAll((err) => {
          btn.textContent = "❌ Failed to Copy";
          btn.disabled = false;
          return clientLog("error", "Export failed", err);
        })
      )
    );
  };

  private triggerCramExport = (e: Event) => {
    const btn = e.target as HTMLButtonElement;
    const originalText = btn.textContent || "";
    btn.textContent = "⏱️ Compiling Cram...";
    btn.disabled = true;

    runClientUnscoped(
      generateExportPayload({ isCram: true }).pipe(
        Effect.andThen(() => Effect.sync(() => {
          btn.textContent = "✅ Cram Copied!";
          setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
          }, 2000);
        })),
        Effect.catchAll((err) => {
          btn.textContent = "❌ Failed to Copy";
          btn.disabled = false;
          return clientLog("error", "Cram export failed", err);
        })
      )
    );
  };

  private startGeneratedSession = (isCram: boolean) => {
    const token = tokenState.peek();
    if (!token) {
      this.importError =
        "AI session generation requires an authenticated session.";
      return;
    }

    this.importError = null;
    this.sessionGenerationLoading = true;
    const program = Effect.gen(this, function* () {
      yield* clientLog(
        "info",
        `[StudyDesk] Starting ${isCram ? "cram" : "standard"} API session generation.`,
      );
      const compiledJson = yield* generateExportPayload({
        isCram,
        copyToClipboard: false,
        persistIntroductions: false,
      });
      const parsedPayload = yield* Effect.try({
        try: () => JSON.parse(compiledJson) as unknown,
        catch: (cause) =>
          new Error(
            `The locally compiled session request was invalid: ${String(cause)}`,
          ),
      });
      const validatedPayload = DailySessionGenerationRequestSchema.safeParse(
        typeof parsedPayload === "object" &&
          parsedPayload !== null &&
          "queue" in parsedPayload &&
          "vocabulary_pool" in parsedPayload
          ? {
              mode: isCram ? "cram" : "standard",
              queue: parsedPayload.queue,
              vocabulary_pool: parsedPayload.vocabulary_pool,
            }
          : parsedPayload,
      );
      if (!validatedPayload.success) {
        const validationIssues = validatedPayload.error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
          message: issue.message,
        }));
        yield* clientLog(
          "error",
          "[StudyDesk] Locally compiled session request failed schema validation.",
          { validationIssues },
        );
        return yield* Effect.fail(
          new Error(
            `The locally compiled session request failed validation at ${validationIssues.map((issue) => issue.path || "root").join(", ")}.`,
          ),
        );
      }

      const generated = yield* requestDailySessionGeneration(
        token,
        validatedPayload.data,
      );
      yield* importSessionPayload(JSON.stringify(generated), {
        onProgress: (progress) => {
          this.importProgress = progress;
          this.requestUpdate();
          runClientUnscoped(
            clientLog(
              "info",
              `[StudyDesk] Generated session import phase=${progress.phase}, completed=${progress.audioCompletedCount}/${progress.totalCards}.`,
            ),
          );
        },
      });
      yield* clientLog(
        "info",
        "[StudyDesk] Generated session validated and stored; opening study view.",
      );
      yield* navigate("study");
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(this, function* () {
          this.importProgress = null;
          this.importError =
            error instanceof Error ? error.message : String(error);
          yield* clientLog(
            "error",
            "[StudyDesk] API session generation failed.",
            error,
          );
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          this.sessionGenerationLoading = false;
        }),
      ),
    );

    runClientUnscoped(program);
  };

  private handleImport = (e: Event) => {
    e.preventDefault();
    this.importError = null;

    if (!this.pasteValue.trim()) {
      this.importError = "Please paste a valid session JSON payload.";
      return;
    }

    this.importProgress = {
      phase: "validating",
      totalCards: 0,
      audioCompletedCount: 0,
      audioSucceededCount: 0,
      audioFailedCount: 0,
    };

    runClientUnscoped(
      importSessionPayload(this.pasteValue, {
        onProgress: (progress) => {
          this.importProgress = progress;
          this.requestUpdate();
          runClientUnscoped(
            clientLog(
              "info",
              `[StudyDesk] Import progress phase=${progress.phase}, completed=${progress.audioCompletedCount}/${progress.totalCards}, succeeded=${progress.audioSucceededCount}, failed=${progress.audioFailedCount}.`,
            ),
          );
        },
      }).pipe(
        Effect.andThen(() => navigate("study")),
        Effect.catchAll((err) => {
          this.importProgress = null;
          this.importError =
            err instanceof Error ? err.message : String(err);
          return clientLog("error", "Import failed", err);
        })
      )
    );
  };

  private toggleQueue = () => {
    this.showQueue = !this.showQueue;
  };

  private startAdaptiveReview = () => {
    const token = tokenState.peek();
    if (!token) {
      this.importError = "Adaptive review requires an authenticated session.";
      return;
    }
    this.adaptiveReviewLoading = true;
    this.importError = null;
    const now = new Date();
    const progress = grammarPointStore.state.peek();
    const progressById = new Map(progress.map((item) => [item.id, item]));
    const due = orderReviewQueue(progress.map((item) => ({
      knowledgePointId: item.id,
      participationStatus: item.participationStatus ?? "active",
      learningState: item.learningState ?? ((item.stability ?? 0) >= 21 ? "stable" : "learning"),
      introducedAt: item.unlockedAt ?? null,
      nextReview: item.nextReview,
      checkoutDue: item.checkoutDue ?? false,
      risk: 1 - calculateRetrievability(item),
    })), now)
      .map((item) => progressById.get(item.knowledgePointId)!)
      .filter(Boolean)
      .slice(0, userPreferencesStore.dailyReviewLimit.peek());
    const program = Effect.gen(this, function* () {
      const cards: SessionCard[] = [];
      for (const progress of due) {
        const selected = yield* Effect.either(fetchNextValidatedExercise(token, progress.id));
        if (selected._tag === "Left") continue;
        const exercise = selected.right;
        cards.push({
          knowledgePointId: progress.id,
          exerciseId: exercise.id,
          englishContext: exercise.content.context,
          japaneseSentence: exercise.content.japaneseSentence,
          furigana: exercise.content.furigana.map((segment) => ({
            kanji: segment.text,
            ...(segment.reading ? { kana: segment.reading } : {}),
          })),
          audioUrl: null,
          explanation: exercise.content.explanation,
        });
      }
      if (cards.length === 0) {
        return yield* Effect.fail(new Error(
          due.length === 0
            ? "No adaptive knowledge points are due."
            : "No source-validated cached exercises are available. Due points were not graded or postponed.",
        ));
      }
      yield* Effect.sync(() => activeSessionStore.loadSession(cards));
      yield* navigate("study");
    }).pipe(
      Effect.catchAll((error) => Effect.sync(() => {
        this.importError = error.message;
      })),
      Effect.ensuring(Effect.sync(() => { this.adaptiveReviewLoading = false; })),
    );
    runClientUnscoped(program);
  };

  private handlePreferenceUpdate = (e: Event, type: "review" | "newRule") => {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    if (isNaN(val) || val < 0) return;

    const currentReview = userPreferencesStore.dailyReviewLimit.peek();
    const currentNew = userPreferencesStore.dailyNewRuleLimit.peek();
    const currentGate = userPreferencesStore.enforceMasteryGates.peek();

    runClientUnscoped(
      Effect.gen(function* () {
        yield* clientLog("info", `[StudyDesk] Updating preferences: type=${type}, newValue=${val}`);
        yield* userPreferencesStore.updateLimits(
          type === "review" ? val : currentReview,
          type === "newRule" ? val : currentNew,
          currentGate
        );
        yield* clientLog("info", "[StudyDesk] Preferences updated successfully.");
      }).pipe(
        Effect.andThen(() => {
          this.saveSuccessMessage = "Settings saved!";
          setTimeout(() => {
            this.saveSuccessMessage = null;
          }, 2000);
        })
      )
    );
  };

  private handleGateToggleUpdate = (e: Event) => {
    const checked = (e.target as HTMLInputElement).checked;
    const currentReview = userPreferencesStore.dailyReviewLimit.peek();
    const currentNew = userPreferencesStore.dailyNewRuleLimit.peek();

    runClientUnscoped(
      Effect.gen(function* () {
        yield* clientLog("info", `[StudyDesk] Updating preferences: enforceMasteryGates=${checked}`);
        yield* userPreferencesStore.updateLimits(
          currentReview,
          currentNew,
          checked
        );
        yield* clientLog("info", "[StudyDesk] Preferences updated successfully.");
      }).pipe(
        Effect.andThen(() => {
          this.saveSuccessMessage = "Settings saved!";
          setTimeout(() => {
            this.saveSuccessMessage = null;
          }, 2000);
        })
      )
    );
  };

  override render() {
    const catalog = grammarPointCatalogStore.state.value;
    
    // Show the same genuinely due, priority-ordered queue used by Adaptive Review.
    const progressItems = grammarPointStore.state.value;
    const progressById = new Map(progressItems.map((item) => [item.id, item]));
    const allDueItems = orderReviewQueue(progressItems.map((item) => ({
      knowledgePointId: item.id,
      participationStatus: item.participationStatus ?? "active",
      learningState: item.learningState ?? ((item.stability ?? 0) >= 21 ? "stable" : "learning"),
      introducedAt: item.unlockedAt ?? null,
      nextReview: item.nextReview,
      checkoutDue: item.checkoutDue ?? false,
      risk: 1 - calculateRetrievability(item),
    })), new Date())
      .map((item) => progressById.get(item.knowledgePointId)!)
      .filter(Boolean);

    const reviewLimit = userPreferencesStore.dailyReviewLimit.value;

    // Slice reviews to enforce a clean dynamic daily active cap and group the rest into backlog
    const dailyTargetItems = allDueItems.slice(0, reviewLimit);
    const backlogItems = allDueItems.slice(reviewLimit);

    const enforceGates = userPreferencesStore.enforceMasteryGates.value;
    const masteryRate = grammarPointStore.activeMasteryRate.value;
    const showMasteryGateWarning = enforceGates && masteryRate < 80 && grammarPointStore.activeLearningRules.value.length > 0;
    const hasBacklog = backlogItems.length > 0;

    const unstarted = grammarPointStore.unstartedCount.value;
    const learning = grammarPointStore.learningCount.value;
    const mastered = grammarPointStore.masteredCount.value;
    const graduated = grammarPointStore.graduatedCount.value;
    const avgDiff = grammarPointStore.averageDifficulty.value;
    const avgRet = grammarPointStore.averageRetrievability.value;

    const totalRules = unstarted + learning + mastered + graduated;
    const pctUnstarted = totalRules > 0 ? (unstarted / totalRules) * 100 : 0;
    const pctLearning = totalRules > 0 ? (learning / totalRules) * 100 : 0;
    const pctMastered = totalRules > 0 ? (mastered / totalRules) * 100 : 0;
    const pctGraduated = totalRules > 0 ? (graduated / totalRules) * 100 : 0;

    runClientUnscoped(clientLog("info", `[StudyDesk] Rendering desk. showMasteryGateWarning=${showMasteryGateWarning}, masteryRate=${masteryRate}%, enforceGates=${enforceGates}`));

    const progress = this.importProgress;
    const progressPercent =
      progress && progress.totalCards > 0
        ? Math.round(
            (progress.audioCompletedCount /
              progress.totalCards) *
              100,
          )
        : 0;
    const progressTitle =
      progress?.phase === "validating"
        ? "Validating imported cards"
        : progress?.phase === "finalizing"
          ? "Preparing your study session"
          : "Generating card audio";

    const mappedDailyTarget = dailyTargetItems.map(p => {
      const catalogItem = catalog.find(c => c.id === p.id);
      return {
        name: catalogItem ? catalogItem.formal_name : "Loading...",
        repetitions: p.repetitions,
        nextReview: p.nextReview
      };
    });

    const mappedBacklog = backlogItems.map(p => {
      const catalogItem = catalog.find(c => c.id === p.id);
      return {
        name: catalogItem ? catalogItem.formal_name : "Loading...",
        repetitions: p.repetitions,
        nextReview: p.nextReview
      };
    });

    let finalDailyTarget = mappedDailyTarget;
    let finalBacklog = mappedBacklog;

    if (grammarPointStore.state.value.length === 0) {
      finalDailyTarget = [
        { name: "だ", repetitions: 0, nextReview: new Date().toISOString() },
        { name: "です", repetitions: 0, nextReview: new Date().toISOString() },
        { name: "は", repetitions: 0, nextReview: new Date().toISOString() },
        { name: "も", repetitions: 0, nextReview: new Date().toISOString() },
        { name: "に", repetitions: 0, nextReview: new Date().toISOString() },
        { name: "で", repetitions: 0, nextReview: new Date().toISOString() },
        { name: "を", repetitions: 0, nextReview: new Date().toISOString() },
        { name: "が", repetitions: 0, nextReview: new Date().toISOString() },
        { name: "から", repetitions: 0, nextReview: new Date().toISOString() },
        { name: "まで", repetitions: 0, nextReview: new Date().toISOString() },
        { name: "と", repetitions: 0, nextReview: new Date().toISOString() }
      ];
      finalBacklog = [];
    }

    return html`
      <div class="max-w-4xl mx-auto space-y-6">
        ${progress
          ? html`
              <div
                class="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm"
                role="dialog"
                aria-modal="true"
                aria-labelledby="audio-import-progress-title"
                data-testid="audio-import-progress-modal"
              >
                <div class="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-950 p-6 shadow-2xl">
                  <div class="flex items-start gap-4">
                    <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green-500/10 text-xl">
                      🔊
                    </div>
                    <div class="min-w-0 flex-1">
                      <h2
                        id="audio-import-progress-title"
                        class="text-lg font-bold text-zinc-100"
                      >
                        ${progressTitle}
                      </h2>
                      <p class="mt-1 text-sm text-zinc-400">
                        ${progress.phase === "validating"
                          ? "Checking every card before any audio request begins."
                          : progress.phase === "finalizing"
                            ? "Saving the enriched cards and warming audio for offline study."
                            : `Audio ready for ${progress.audioCompletedCount} of ${progress.totalCards} cards.`}
                      </p>
                    </div>
                  </div>

                  <div class="mt-6 space-y-2">
                    <div class="flex items-center justify-between text-xs font-medium">
                      <span class="text-zinc-400">
                        ${progress.audioCompletedCount} / ${progress.totalCards || "—"}
                      </span>
                      <span class="text-green-400">${progressPercent}%</span>
                    </div>
                    <div
                      class="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800"
                      role="progressbar"
                      aria-valuemin="0"
                      aria-valuemax=${progress.totalCards}
                      aria-valuenow=${progress.audioCompletedCount}
                    >
                      <div
                        class="h-full rounded-full bg-green-500 transition-[width] duration-300 ease-out"
                        style=${`width: ${progressPercent}%`}
                      ></div>
                    </div>
                  </div>

                  <div class="mt-5 grid grid-cols-2 gap-3 text-center">
                    <div class="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                      <div class="text-lg font-bold text-green-400">
                        ${progress.audioSucceededCount}
                      </div>
                      <div class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        Audio ready
                      </div>
                    </div>
                    <div class="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                      <div class="text-lg font-bold ${progress.audioFailedCount > 0 ? "text-yellow-400" : "text-zinc-300"}">
                        ${progress.audioFailedCount}
                      </div>
                      <div class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        Without audio
                      </div>
                    </div>
                  </div>

                  <p class="mt-4 text-center text-xs text-zinc-500">
                    Keep this page open. The study session will start automatically.
                  </p>
                </div>
              </div>
            `
          : ""}

        <div class="flex items-center justify-between border-b border-zinc-800 pb-4">
          <div>
            <h1 class="text-2xl font-bold">Language Study Desk</h1>
            <p class="text-sm text-zinc-400">Review your active decks and vocabulary cycles.</p>
          </div>
          <button 
            @click=${logout}
            class="px-4 py-2 bg-zinc-850 hover:bg-zinc-800 text-zinc-200 hover:text-white rounded text-sm font-medium border border-zinc-800 transition-colors cursor-pointer"
          >
            Logout
          </button>
        </div>

        <!-- Real-Time FSRS Metrics Panel -->
        <div class="grid gap-4 sm:grid-cols-3 p-5 bg-zinc-950 border border-zinc-800 rounded-lg shadow-sm" id="metrics-panel">
          <!-- 1. Estimated Retention (Memory Health) -->
          <div class="flex flex-col justify-between p-4 bg-zinc-900/40 border border-zinc-900 rounded-lg">
            <div>
              <span class="text-2xs font-bold text-zinc-500 uppercase tracking-widest block">Memory Retention</span>
              <div class="flex items-baseline gap-2 mt-2">
                <span class="text-3xl font-extrabold tracking-tight ${avgRet >= 85 ? "text-green-400" : avgRet >= 75 ? "text-yellow-400" : "text-red-400"}" id="retention-rate">
                  ${avgRet}%
                </span>
                <span class="text-xs text-zinc-500">recall prob.</span>
              </div>
            </div>
            <p class="text-3xs text-zinc-400 mt-3 leading-relaxed">
              FSRS estimate of your current memory retrievability. Optimal target is 85–90%.
            </p>
          </div>

          <!-- 2. Deck Difficulty -->
          <div class="flex flex-col justify-between p-4 bg-zinc-900/40 border border-zinc-900 rounded-lg">
            <div>
              <span class="text-2xs font-bold text-zinc-500 uppercase tracking-widest block">Deck Difficulty</span>
              <div class="flex items-baseline justify-between mt-2">
                <span class="text-2xl font-bold tracking-tight text-zinc-200" id="avg-difficulty">
                  ${avgDiff.toFixed(1)} <span class="text-xs text-zinc-500">/ 10</span>
                </span>
                <span class="text-xs font-semibold ${avgDiff < 4.0 ? "text-green-400" : avgDiff < 7.0 ? "text-yellow-400" : "text-red-400"}" id="difficulty-label">
                  ${avgDiff < 4.0 ? "Easy" : avgDiff < 7.0 ? "Moderate" : "Challenging"}
                </span>
              </div>
              <div class="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden mt-3.5">
                <div class="h-full transition-all duration-300 ${avgDiff < 4.0 ? "bg-green-500" : avgDiff < 7.0 ? "bg-yellow-500" : "bg-red-500"}" style="width: ${avgDiff * 10}%"></div>
              </div>
            </div>
            <p class="text-3xs text-zinc-400 mt-3 leading-relaxed">
              Weighted average complexity of active rules in your current deck.
            </p>
          </div>

          <!-- 3. Card Distribution -->
          <div class="flex flex-col justify-between p-4 bg-zinc-900/40 border border-zinc-900 rounded-lg">
            <div>
              <span class="text-2xs font-bold text-zinc-500 uppercase tracking-widest block">Deck Distribution</span>
              
              <!-- Stacked proportional progress bar -->
              <div class="w-full h-2.5 rounded-full overflow-hidden flex bg-zinc-800 mt-4 shadow-inner" id="distribution-bar">
                ${totalRules === 0 
                  ? html`<div class="h-full bg-zinc-700 w-full" title="Unstarted"></div>`
                  : html`
                      <div class="h-full bg-zinc-600 transition-all duration-300" style="width: ${pctUnstarted}%" title="Unstarted: ${unstarted}"></div>
                      <div class="h-full bg-blue-500 transition-all duration-300" style="width: ${pctLearning}%" title="Learning: ${learning}"></div>
                      <div class="h-full bg-yellow-500 transition-all duration-300" style="width: ${pctMastered}%" title="Mastered: ${mastered}"></div>
                      <div class="h-full bg-green-500 transition-all duration-300" style="width: ${pctGraduated}%" title="Graduated: ${graduated}"></div>
                    `
                }
              </div>

              <!-- Legend -->
              <div class="grid grid-cols-2 gap-x-5 gap-y-2 mt-3.5 text-[11px] font-medium text-zinc-400" id="distribution-legend">
                <div class="flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0"></span>
                  <span>New: <strong class="text-zinc-300" id="count-unstarted">${unstarted}</strong></span>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></span>
                  <span>Learning: <strong class="text-zinc-300" id="count-learning">${learning}</strong></span>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-yellow-500 shrink-0"></span>
                  <span>Mastery: <strong class="text-zinc-300" id="count-mastered">${mastered}</strong></span>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"></span>
                  <span>Graduated: <strong class="text-zinc-300" id="count-graduated">${graduated}</strong></span>
                </div>
              </div>
            </div>
          </div>
        </div>

        ${showMasteryGateWarning ? html`
          <div class='p-5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg space-y-3 animate-fade-in' id='mastery-gate-alert'>
            <div class='flex items-center justify-between'>
              <div class='flex items-center gap-3.5'>
                <span class='text-2xl'>🔒</span>
                <div>
                  <h3 class='text-sm font-bold text-yellow-500'>Mastery Gate Active</h3>
                  <p class='text-xs text-zinc-400'>You must reach an 80% mastery rate of active learning rules to unlock new material.</p>
                </div>
              </div>
              <div class='text-right'>
                <span class='text-xl font-bold text-yellow-500' id='mastery-rate-pct'>${masteryRate}%</span>
                <span class='text-3xs text-zinc-500 block uppercase tracking-wider font-semibold'>Mastery Rate</span>
              </div>
            </div>

            <div class='w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden'>
              <div class='bg-yellow-500 h-full transition-all duration-300' style='width: ${masteryRate}%'></div>
            </div>

            <div class='space-y-1.5 pt-1'>
              <span class='text-[10px] font-bold text-zinc-500 uppercase tracking-wider block'>Unmastered Rules Blocking Progress:</span>
              <div class='flex flex-wrap gap-1.5' id='unmastered-blocking-list'>
                ${grammarPointStore.unmasteredActiveRules.value.map(rule => {
                  const catalogItem = grammarPointCatalogStore.state.value.find(c => c.id === rule.id);
                  return html`
                    <span class='px-2 py-0.5 bg-zinc-900 text-yellow-500 border border-yellow-500/10 text-xs font-semibold rounded'>${catalogItem ? catalogItem.formal_name : "Loading..."}</span>
                  `;
                })}
              </div>
            </div>

            <div class='pt-2.5 border-t border-zinc-900/40 flex items-center justify-between gap-4'>
              <p class='text-2xs text-zinc-400 leading-relaxed'>
                💡 <strong>Stuck?</strong> Generate a focused cram session targeting your troublesome unmastered rules.
              </p>
              <button 
                @click=${() => this.startGeneratedSession(true)}
                ?disabled=${this.sessionGenerationLoading || this.importProgress !== null}
                class='px-3.5 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-zinc-950 font-bold rounded text-2xs transition-colors cursor-pointer shrink-0'
                id='btn-cram-generate'
              >
                ${this.sessionGenerationLoading ? "Generating…" : "Generate Cram Session"}
              </button>
            </div>
          </div>
        ` : ""}

        ${showMasteryGateWarning && hasBacklog ? html`
          <div class='p-3 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-lg text-xs leading-normal animate-fade-in' id='backlog-advice-hint'>
            💡 <strong>Backlog Alert</strong>: You have ${backlogItems.length} reviews snoozed in your backlog! Try increasing your <strong>Review Cap</strong> in the configuration panel below to bring them into your due queue and master them.
          </div>
        ` : ""}

        <div class="grid gap-6 md:grid-cols-2">
          <!-- Generated session setup and manual fallback -->
          <div class="p-6 bg-zinc-950 border border-zinc-800 rounded-lg shadow-sm space-y-5">
            <div>
              <h2 class="text-lg font-semibold text-zinc-200">Conversational Japanese</h2>
              <p class="text-sm text-zinc-400 mt-1">Essential survival phrases and foundational grammar.</p>
            </div>

            <div class="space-y-4 pt-2 border-t border-zinc-900">
              <div class="space-y-2">
                <span class="text-xs font-semibold text-emerald-400 uppercase tracking-wider block">Adaptive media reviews</span>
                <button
                  @click=${this.startAdaptiveReview}
                  ?disabled=${this.adaptiveReviewLoading}
                  class="w-full py-2.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-zinc-800 text-white font-bold rounded text-sm transition-colors cursor-pointer"
                >${this.adaptiveReviewLoading ? "Loading validated exercises…" : "Start adaptive review"}</button>
                <p class="text-2xs text-zinc-500">Uses varied exercises already validated against the original subtitle on a source-capable device. If none exist, the point stays due.</p>
              </div>
              <div class="space-y-2">
                <span class="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">AI-generated daily session</span>
                ${showMasteryGateWarning
                  ? html`
                      <button 
                        disabled
                        class="w-full py-2.5 bg-zinc-900/40 text-zinc-500 font-medium rounded text-sm border border-zinc-800/60 flex items-center justify-center gap-2 cursor-not-allowed"
                        id="btn-generate-session"
                      >
                        🔒 Progression Locked (Gate Active)
                      </button>
                      <p class="text-2xs text-yellow-500/80 leading-normal">
                        ⚠️ Your progress is locked under the 80% mastery threshold. Generate a <strong>Cram Session</strong> above to review unmastered concepts first.
                      </p>
                    `
                  : html`
                      <button 
                        @click=${() => this.startGeneratedSession(false)}
                        ?disabled=${this.sessionGenerationLoading || this.importProgress !== null}
                        class="w-full py-2.5 bg-green-650 hover:bg-green-600 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-bold rounded text-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
                        id="btn-generate-session"
                      >
                        ${this.sessionGenerationLoading
                          ? "Generating session…"
                          : "✨ Generate & Start Session"}
                      </button>
                      <p class="text-2xs text-zinc-500">Uses the server's OPENAI_API_KEY. Your key is never sent to or stored by the browser.</p>
                    `}
              </div>

              ${this.importError
                ? html`<p class="text-xs text-red-400 font-medium" role="alert">${this.importError}</p>`
                : ""}

              <details class="space-y-3 border-t border-zinc-900 pt-3">
                <summary class="cursor-pointer text-xs font-semibold text-zinc-500 hover:text-zinc-300">Manual JSON fallback</summary>
                <div class="space-y-2 pt-2">
                  <button
                    @click=${this.triggerExport}
                    class="w-full py-2 bg-zinc-900 hover:bg-zinc-850 text-zinc-300 rounded text-xs border border-zinc-800"
                    id="btn-export-progress"
                  >
                    📋 Copy Progress Payload
                  </button>
                  <button
                    @click=${this.triggerCramExport}
                    class="w-full py-2 bg-zinc-900 hover:bg-zinc-850 text-zinc-300 rounded text-xs border border-zinc-800"
                    id="btn-cram-export"
                  >
                    📋 Copy Cram Payload
                  </button>
                  <form @submit=${this.handleImport} class="space-y-2">
                    <textarea
                      @input=${(e: Event) => { this.pasteValue = (e.target as HTMLTextAreaElement).value; }}
                      placeholder="Paste a compiled JSON session payload here..."
                      aria-label="Manual session JSON"
                      class="w-full h-24 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-700 text-xs font-mono"
                    ></textarea>
                    <button
                      type="submit"
                      ?disabled=${this.importProgress !== null || this.sessionGenerationLoading}
                      class="w-full py-2 bg-zinc-800 hover:bg-zinc-700 disabled:text-zinc-500 text-zinc-200 font-medium rounded text-xs"
                    >
                      Import JSON & Start Study
                    </button>
                  </form>
                </div>
              </details>
            </div>
          </div>

          <!-- Study Progress / Stats Card -->
          <div class="p-6 bg-zinc-950 border border-zinc-800 rounded-lg shadow-sm space-y-4 flex flex-col justify-between">
            <div>
              <div class="flex items-center justify-between">
                <h2 class="text-lg font-semibold text-zinc-200">Study Progress</h2>
              </div>

              <div class="mt-4 p-3 bg-zinc-900/40 border border-zinc-900 rounded-lg space-y-3">
                <div class="flex items-center justify-between">
                  <span class="text-2xs font-bold text-zinc-500 uppercase tracking-widest">Study Configuration</span>
                  ${this.saveSuccessMessage ? html`
                    <span class="text-xs text-green-400 font-medium animate-fade-in">✓ ${this.saveSuccessMessage}</span>
                  ` : ""}
                </div>
                <div class="grid grid-cols-2 gap-4">
                  <div class="space-y-1">
                    <label class="text-[10px] font-medium text-zinc-400 uppercase">Review Cap</label>
                    <input 
                      type="number" 
                      .value=${userPreferencesStore.dailyReviewLimit.value}
                      @input=${(e: Event) => this.handlePreferenceUpdate(e, "review")}
                      class="w-full px-2 py-1 bg-zinc-950 border-zinc-800 rounded text-xs text-green-400 focus:outline-none focus:border-green-600"
                    />
                  </div>
                  <div class="space-y-1">
                    <label class="text-[10px] font-medium text-zinc-400 uppercase">New Rules</label>
                    <input 
                      type="number" 
                      .value=${userPreferencesStore.dailyNewRuleLimit.value}
                      @input=${(e: Event) => this.handlePreferenceUpdate(e, "newRule")}
                      class="w-full px-2 py-1 bg-zinc-950 border-zinc-800 rounded text-xs text-blue-400 focus:outline-none focus:border-blue-600"
                    />
                  </div>
                </div>

                <div class="flex items-center justify-between pt-2.5 border-t border-zinc-900/60">
                  <label for="enforce-gates-toggle" class="text-xs font-medium text-zinc-400">Enforce Mastery Gates</label>
                  <input 
                    id="enforce-gates-toggle"
                    type="checkbox"
                    .checked=${userPreferencesStore.enforceMasteryGates.value}
                    @change=${this.handleGateToggleUpdate}
                    class="h-4 w-4 bg-zinc-950 border-zinc-800 rounded focus:ring-green-500 text-green-500 cursor-pointer"
                  />
                </div>
              </div>

              <div class="space-y-3 text-sm text-zinc-400 mt-4">
                <div class="flex justify-between border-b border-zinc-900 pb-2">
                  <span>Sync Outbox Queue</span>
                  <span class="text-zinc-200 text-xs">Local-first enabled</span>
                </div>
              </div>

              <button 
                @click=${this.toggleQueue}
                class="w-full mt-4 py-2 bg-zinc-900 hover:bg-zinc-850 text-zinc-300 hover:text-white rounded text-xs font-medium border border-zinc-800 transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                ${this.showQueue ? "🙈 Hide Active Queue" : "👁️ View Active Queue"}
              </button>

              ${this.showQueue ? html`
                <div class="mt-4 p-3 bg-zinc-900/60 border border-zinc-900 rounded-lg space-y-4 animate-fade-in">
                  <div class="space-y-2">
                    <span class="text-xs font-bold text-green-400 uppercase tracking-wider block">${`Due Today - Daily Target (${finalDailyTarget.length} rules)`}</span>
                    <div class="divide-y divide-zinc-900/80 max-h-32 overflow-y-auto pr-1">
                      ${finalDailyTarget.map(item => html`
                        <div class="py-2 flex items-center justify-between text-xs">
                          <div class="flex items-center gap-2">
                            <span class="px-1.5 py-0.5 bg-zinc-850 text-green-400 font-bold rounded border border-zinc-800">${item.name}</span>
                            <span class="text-zinc-500">Reps: ${item.repetitions}</span>
                          </div>
                          <span class="text-zinc-500">Next: ${new Date(item.nextReview).toLocaleDateString()}</span>
                        </div>
                      `)}
                    </div>
                  </div>

                  ${finalBacklog.length > 0 ? html`
                    <div class="space-y-2 border-t border-zinc-900/60 pt-2">
                      <span class="text-xs font-semibold text-zinc-500 uppercase tracking-wider block">${`Snoozed Backlog (${finalBacklog.length} rules)`}</span>
                      <div class="divide-y divide-zinc-900/80 max-h-24 overflow-y-auto pr-1 opacity-60">
                        ${finalBacklog.map(item => html`
                          <div class="py-2 flex items-center justify-between text-xs">
                            <div class="flex items-center gap-2">
                              <span class="px-1.5 py-0.5 bg-zinc-850 text-zinc-400 font-bold rounded border border-zinc-800">${item.name}</span>
                              <span class="text-zinc-500">Reps: ${item.repetitions}</span>
                            </div>
                            <span class="text-zinc-500">Next: ${new Date(item.nextReview).toLocaleDateString()}</span>
                          </div>
                        `)}
                      </div>
                    </div>
                  ` : ""}
                </div>
              ` : ""}
            </div>
            <div class="p-4 bg-zinc-900/40 border border-zinc-900 rounded-lg text-xs text-zinc-400 leading-relaxed">
              💡 <strong>API flow</strong>: Gafu sends the bounded study queue to its authenticated server endpoint, validates the structured response, optionally generates audio, and starts the session automatically. Manual JSON remains available as an offline fallback.
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
