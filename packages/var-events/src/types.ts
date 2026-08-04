/**
 * VAR-moment markets — data model.
 *
 * IMPORTANT — scope of this package: this feature never depends on a live
 * TxLINE VAR signal (there isn't one yet — see
 * onside/Submission/txline_api_experience.md — and our current TxLINE tier
 * only covers the [finished] World Cup + Friendlies anyway; see the
 * txodds-access-audit note). Instead every market here is fed by a
 * `VarEventSource` that reports the SAME two-phase shape a real oracle
 * would: a trigger ("VAR just entered the game, here's the situation") and,
 * later, a resolution ("VAR just announced its decision, at this exact
 * match timestamp"). Three sources implement it:
 *   - ReplayVarEventSource — plays back a scripted JSON file of an
 *     already-finished match on a timeline (both trigger and resolution are
 *     known in advance; still fired as two separate, timed events).
 *   - AdminVarEventSource — an admin watching any match (one without TxODDS
 *     coverage too) reports the trigger and, later, the resolution by hand.
 *     This is the "simulate txodds/oracles" path.
 *   - TxlineVarEventSource — documented plug point, not yet implemented.
 * Nothing downstream (VarMarketController, the ledger, the UI) cares which
 * one is feeding it — same trigger/resolution shape either way.
 */

/** The three VAR review types we support. */
export type VarType = "GOAL_REVIEW" | "RED_CARD_REVIEW" | "PENALTY_REVIEW";

/** The exactly-two possible outcomes for each VAR type, in canonical order. */
export const VAR_OUTCOME_OPTIONS: Record<VarType, readonly [string, string]> = {
  GOAL_REVIEW: ["GOAL_STANDS", "GOAL_RULED_OUT"],
  RED_CARD_REVIEW: ["RED_CARD_GIVEN", "NO_RED_CARD"],
  PENALTY_REVIEW: ["PENALTY_AWARDED", "NO_PENALTY"],
} as const;

/** Human-readable labels for the UI (kept separate from the wire values). */
export const VAR_TYPE_LABEL: Record<VarType, string> = {
  GOAL_REVIEW: "Goal review",
  RED_CARD_REVIEW: "Red card review",
  PENALTY_REVIEW: "Penalty review",
};
export const VAR_OUTCOME_LABEL: Record<string, string> = {
  GOAL_STANDS: "Goal stands",
  GOAL_RULED_OUT: "Goal ruled out",
  RED_CARD_GIVEN: "Red card given",
  NO_RED_CARD: "No red card",
  PENALTY_AWARDED: "Penalty awarded",
  NO_PENALTY: "No penalty",
};

/**
 * "VAR just entered the game" — fired the moment a review starts, before
 * anyone (including the admin) knows how it will be decided.
 */
export interface VarTrigger {
  /** Unique per review — correlates a later VarResolution back to this one. */
  id: string;
  /** TxLINE FixtureId when known, else any stable string for demo/admin use. */
  matchId: string | number;
  /** Match clock when VAR entered, e.g. "67:14" (display only). */
  timestamp: string;
  varType: VarType;
  /** Short human description, e.g. "Offside check on goal". */
  context: string;
  /** Always the two options for `varType`, in canonical order. */
  outcomeOptions: readonly [string, string];
}

/**
 * "VAR just announced its decision" — the settlement signal. `timestamp` is
 * the exact match clock at the moment of the announcement (not when the
 * admin happens to click the button), so the record is faithful to the
 * broadcast even if there's UI lag.
 */
export interface VarResolution {
  triggerId: string;
  outcome: string;
  timestamp: string;
}

/** Throws if a resolution doesn't fit the trigger it claims to resolve. */
export function assertValidResolution(trigger: VarTrigger, resolution: VarResolution): void {
  if (resolution.triggerId !== trigger.id) {
    throw new Error(`resolution.triggerId "${resolution.triggerId}" doesn't match trigger.id "${trigger.id}"`);
  }
  if (!trigger.outcomeOptions.includes(resolution.outcome)) {
    throw new Error(
      `resolution outcome "${resolution.outcome}" is not one of trigger.outcomeOptions ${JSON.stringify(trigger.outcomeOptions)}`
    );
  }
}

/**
 * A complete, resolved VAR moment — trigger + resolution combined, plus
 * replay-scheduling metadata. This is the archival/JSON shape: what
 * ReplayVarEventSource reads from a sample-events file, and what
 * `VarMarketController.toVarEvent()` produces from a live admin session so
 * that session can be saved as a new sample-events file later.
 */
export interface VarEvent {
  matchId: string | number;
  timestamp: string;
  /** Seconds from replay start at which the replay engine fires the trigger. */
  realTimeOffset: number;
  varType: VarType;
  context: string;
  outcomeOptions: readonly [string, string];
  /** The real, recorded outcome of this review — must be one of outcomeOptions. */
  officialDecision: string;
  /** Trigger-to-resolution gap, for realistic replay pacing. */
  reviewDurationSeconds: number;
}

/** Throws with a clear message if an event's shape doesn't hold together. */
export function assertValidVarEvent(e: VarEvent): void {
  const expected = VAR_OUTCOME_OPTIONS[e.varType];
  if (!expected) throw new Error(`VarEvent ${e.matchId}@${e.timestamp}: unknown varType "${e.varType}"`);
  if (e.outcomeOptions[0] !== expected[0] || e.outcomeOptions[1] !== expected[1]) {
    throw new Error(
      `VarEvent ${e.matchId}@${e.timestamp}: outcomeOptions ${JSON.stringify(e.outcomeOptions)} ` +
        `don't match the canonical pair for ${e.varType} (${JSON.stringify(expected)})`
    );
  }
  if (!e.outcomeOptions.includes(e.officialDecision)) {
    throw new Error(
      `VarEvent ${e.matchId}@${e.timestamp}: officialDecision "${e.officialDecision}" ` +
        `is not one of outcomeOptions ${JSON.stringify(e.outcomeOptions)}`
    );
  }
  if (e.reviewDurationSeconds <= 0) {
    throw new Error(`VarEvent ${e.matchId}@${e.timestamp}: reviewDurationSeconds must be > 0`);
  }
}

/** Deterministic id for a scripted VarEvent (unique within one sample file). */
export function varEventId(e: Pick<VarEvent, "matchId" | "timestamp">): string {
  return `${e.matchId}@${e.timestamp}`;
}

export function varEventToTrigger(e: VarEvent): VarTrigger {
  return {
    id: varEventId(e),
    matchId: e.matchId,
    timestamp: e.timestamp,
    varType: e.varType,
    context: e.context,
    outcomeOptions: e.outcomeOptions,
  };
}

/** Lifecycle of one VAR market: OPEN while predictions are accepted, LOCKED
 *  once entries are cut off (VAR is "reviewing"), RESOLVED once the real
 *  decision — scripted or admin-reported — is revealed. */
export type VarMarketState = "OPEN" | "LOCKED" | "RESOLVED";

export interface VarPrediction {
  userId: string;
  outcome: string;
  stake: number;
}

/** Read-only snapshot handed to the UI on every state change. */
export interface VarMarketSnapshot {
  trigger: VarTrigger;
  state: VarMarketState;
  /** ms epoch (wall clock, unscaled) the market opened / locked. */
  openedAtMs: number;
  lockedAtMs?: number;
  predictions: VarPrediction[];
  /** Set only once state === "RESOLVED". */
  resolvedOutcome?: string;
  /** Match-clock timestamp of the announcement (from the VarResolution). */
  resolvedTimestamp?: string;
}
