/**
 * VarMarketController — the state machine for one VAR-moment market.
 *
 * Kept as a market type distinct from @onside/txline-client's Merkle-proof
 * settlement path on purpose. Goal/corner/card markets settle by *proving* a
 * stat against a root TxODDS anchors on-chain — no human in the loop. A VAR
 * review is, by nature, a referee's call: `resolve()` below settles against
 * a `VarResolution` — i.e. the recorded/reported official decision — so it's
 * an honest, useful settlement with a different trust model, kept on a
 * different code path rather than dressed up as oracle-free physics
 * settlement.
 *
 * Deliberately doesn't know or care whether the resolution came from a
 * scripted replay's own timer or from an admin clicking "resolve" by hand —
 * both just call `resolve(resolution)`. That symmetry is what makes the
 * admin tool a faithful simulation of a future live oracle feed.
 */
import { assertValidResolution } from "./types.js";
import type { VarEvent, VarMarketSnapshot, VarMarketState, VarPrediction, VarResolution, VarTrigger } from "./types.js";
import { DemoLedger } from "./ledger.js";

export interface VarMarketOptions {
  /** Fixed decimal odds paid on a correct prediction. VAR moments are
   *  intentionally simple, roughly-50/50 events for a demo — a flat price
   *  (rather than a live orderbook/pool) keeps the payout math legible. */
  payoutOdds?: number;
  /** Injection point for tests / a deterministic demo clock. */
  now?: () => number;
}

const DEFAULT_PAYOUT_ODDS = 1.9;

export type VarMarketListener = (snapshot: VarMarketSnapshot) => void;

export class VarMarketController {
  private state: VarMarketState = "OPEN";
  private predictions: VarPrediction[] = [];
  private resolvedOutcome?: string;
  private resolvedTimestamp?: string;
  private readonly openedAtMs: number;
  private lockedAtMs?: number;
  private readonly listeners = new Set<VarMarketListener>();

  private readonly payoutOdds: number;
  private readonly now: () => number;

  constructor(
    readonly trigger: VarTrigger,
    private readonly ledger: DemoLedger,
    opts: VarMarketOptions = {}
  ) {
    this.payoutOdds = opts.payoutOdds ?? DEFAULT_PAYOUT_ODDS;
    this.now = opts.now ?? Date.now;
    this.openedAtMs = this.now();
  }

  /** Subscribe to every state transition (open→locked→resolved) and every
   *  new prediction. Returns an unsubscribe function. */
  onChange(listener: VarMarketListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }

  snapshot(): VarMarketSnapshot {
    return {
      trigger: this.trigger,
      state: this.state,
      openedAtMs: this.openedAtMs,
      lockedAtMs: this.lockedAtMs,
      predictions: [...this.predictions],
      resolvedOutcome: this.resolvedOutcome,
      resolvedTimestamp: this.resolvedTimestamp,
    };
  }

  /** Place one prediction for `userId`. Only allowed while OPEN, one
   *  prediction per user per market. Returns false if the window is closed,
   *  the outcome is invalid, the user already predicted, or their demo
   *  balance can't cover `stake`. */
  predict(userId: string, outcome: string, stake: number): boolean {
    if (this.state !== "OPEN") return false;
    if (!this.trigger.outcomeOptions.includes(outcome)) return false;
    if (this.predictions.some((p) => p.userId === userId)) return false;

    const reservation = this.ledger.reserve(userId, stake);
    if (!reservation) return false;

    this.predictions.push({ userId, outcome, stake });
    this.emit();
    return true;
  }

  /** Stop accepting new entries without resolving yet — e.g. an admin
   *  cutting off bets a beat before the real decision drops. `resolve()`
   *  calls this automatically if it hasn't happened already. */
  lock(): void {
    if (this.state !== "OPEN") return;
    this.state = "LOCKED";
    this.lockedAtMs = this.now();
    this.emit();
  }

  /**
   * Settle every prediction against `resolution.outcome` — the reported
   * real outcome of this review (scripted or admin-fed), not a
   * computed/proven result. Returns false if the resolution doesn't match
   * this market's trigger or it's already resolved.
   */
  resolve(resolution: VarResolution): boolean {
    if (this.state === "RESOLVED") return false;
    assertValidResolution(this.trigger, resolution);
    if (this.state === "OPEN") this.lock();

    this.state = "RESOLVED";
    this.resolvedOutcome = resolution.outcome;
    this.resolvedTimestamp = resolution.timestamp;

    for (const prediction of this.predictions) {
      if (prediction.outcome === this.resolvedOutcome) {
        this.ledger.credit(prediction.userId, prediction.stake * this.payoutOdds);
      }
      // losers: their stake was already deducted at predict()-time.
    }
    this.emit();
    return true;
  }

  /**
   * Export this resolved market as a full VarEvent record, in exactly the
   * shape ReplayVarEventSource reads from a sample-events JSON file — so an
   * admin-run live session can be saved and replayed later.
   * `sessionStartMs` anchors `realTimeOffset` to when the admin session (or
   * the match) began; pass the same value for every market in one session.
   */
  toVarEvent(sessionStartMs: number): VarEvent | null {
    if (this.state !== "RESOLVED" || this.resolvedOutcome === undefined) return null;
    const reviewDurationSeconds = Math.max(1, Math.round(((this.lockedAtMs ?? this.now()) - this.openedAtMs) / 1000));
    return {
      matchId: this.trigger.matchId,
      timestamp: this.trigger.timestamp,
      realTimeOffset: Math.max(0, Math.round((this.openedAtMs - sessionStartMs) / 1000)),
      varType: this.trigger.varType,
      context: this.trigger.context,
      outcomeOptions: this.trigger.outcomeOptions,
      officialDecision: this.resolvedOutcome,
      reviewDurationSeconds,
    };
  }

  /** No pending timers to clean up in this model, but kept for symmetry
   *  with the source lifecycle (call when tearing down a session early). */
  dispose(): void {
    this.listeners.clear();
  }
}
