/**
 * VAR event sources — the pluggable half of this feature.
 *
 * Every source reports the same two-phase shape a real oracle would: a
 * `VarTrigger` ("VAR just entered the game, here's the situation") and,
 * later, a `VarResolution` ("VAR just announced its decision, at this exact
 * match timestamp"). `VarMarketController` and the UI only ever talk to
 * this interface — swapping which source feeds them is a one-line change.
 *
 *   - `ReplayVarEventSource` — plays back a scripted JSON file of an
 *     already-finished match (see ../sample-events/) on a timeline.
 *   - `AdminVarEventSource` — an admin watching any match by hand reports
 *     the trigger, then later the resolution, as VAR actually happens. This
 *     is the "simulate txodds/oracles" path: it produces the exact same
 *     trigger/resolution records a real feed would, just typed in.
 *   - `TxlineVarEventSource` — documented plug point, not yet implemented
 *     (see the doc comment below for what unlocks it).
 */
import type { VarEvent, VarResolution, VarTrigger, VarType } from "./types.js";
import { assertValidVarEvent, varEventToTrigger } from "./types.js";

export interface VarEventHandlers {
  onTrigger: (trigger: VarTrigger) => void;
  onResolution: (resolution: VarResolution) => void;
}

export interface VarEventSource {
  /** Start emitting trigger/resolution events. Returns an unsubscribe
   *  function that stops the source (clears timers / detaches handlers). */
  subscribe(handlers: VarEventHandlers): () => void;
}

export interface ReplayOptions {
  /** 1 = real-time pacing, 4 = four times faster (handy for live demos). */
  speedMultiplier?: number;
  /** Skip straight to this offset (seconds) — e.g. to resume a scrubbed demo. */
  startAtOffsetSeconds?: number;
}

/**
 * REPLAY source — fires each event's trigger at its `realTimeOffset` and its
 * resolution `reviewDurationSeconds` later, both scaled by
 * `speedMultiplier`. Every `officialDecision` here is the real recorded
 * outcome of an already-played match; the engine just times the two-phase
 * announcement to feel live, for demo purposes only.
 */
export class ReplayVarEventSource implements VarEventSource {
  private readonly events: readonly VarEvent[];
  private readonly speedMultiplier: number;
  private readonly startAtOffsetSeconds: number;

  constructor(events: readonly VarEvent[], opts: ReplayOptions = {}) {
    events.forEach(assertValidVarEvent);
    // fire in schedule order regardless of file order
    this.events = [...events].sort((a, b) => a.realTimeOffset - b.realTimeOffset);
    this.speedMultiplier = opts.speedMultiplier ?? 1;
    this.startAtOffsetSeconds = opts.startAtOffsetSeconds ?? 0;
  }

  subscribe(handlers: VarEventHandlers): () => void {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const event of this.events) {
      const triggerRemaining = event.realTimeOffset - this.startAtOffsetSeconds;
      if (triggerRemaining < 0) continue; // already "past" this scrub point
      const trigger = varEventToTrigger(event);

      const triggerDelayMs = (triggerRemaining * 1000) / this.speedMultiplier;
      timers.push(
        setTimeout(() => {
          handlers.onTrigger(trigger);
          const resolveDelayMs = (event.reviewDurationSeconds * 1000) / this.speedMultiplier;
          timers.push(
            setTimeout(
              () => handlers.onResolution({ triggerId: trigger.id, outcome: event.officialDecision, timestamp: event.timestamp }),
              resolveDelayMs
            )
          );
        }, triggerDelayMs)
      );
    }
    return () => timers.forEach(clearTimeout);
  }
}

let adminTriggerSeq = 0;

/**
 * ADMIN source — a human operator (watching any match, including ones with
 * no TxODDS/TxLINE coverage) reports VAR moments by hand: `triggerVar()` the
 * instant a review starts, `resolveVar()` once the real decision is known.
 * This is literally standing in for the oracle: the shape of what it
 * produces (VarTrigger, then VarResolution) is identical to what a real
 * live feed would send, so switching to `TxlineVarEventSource` later
 * changes nothing downstream.
 */
export class AdminVarEventSource implements VarEventSource {
  private handlers = new Set<VarEventHandlers>();

  subscribe(handlers: VarEventHandlers): () => void {
    this.handlers.add(handlers);
    return () => this.handlers.delete(handlers);
  }

  /** Call the moment the admin sees a VAR review start on the broadcast.
   *  The outcome isn't known yet — that's reported later via `resolveVar`. */
  triggerVar(input: { matchId: string | number; timestamp: string; varType: VarType; context: string; outcomeOptions: readonly [string, string] }): VarTrigger {
    const trigger: VarTrigger = {
      id: `admin-${input.matchId}-${Date.now()}-${adminTriggerSeq++}`,
      matchId: input.matchId,
      timestamp: input.timestamp,
      varType: input.varType,
      context: input.context,
      outcomeOptions: input.outcomeOptions,
    };
    for (const h of this.handlers) h.onTrigger(trigger);
    return trigger;
  }

  /** Call once the admin sees VAR announce its decision, with the exact
   *  match-clock timestamp of the announcement — this is the simulated
   *  oracle settlement signal. */
  resolveVar(triggerId: string, outcome: string, timestamp: string): void {
    const resolution: VarResolution = { triggerId, outcome, timestamp };
    for (const h of this.handlers) h.onResolution(resolution);
  }
}

/**
 * LIVE source — NOT IMPLEMENTED. Exists so the swap from replay/admin to a
 * real feed is a one-line change, not a rearchitecture. Wire it up once
 * both of these are true:
 *   1. our TxLINE subscription covers the competition in question (today:
 *      World Cup [finished] + Friendlies only — see
 *      onside/Submission/txline_api_experience.md and the
 *      txodds-access-audit memory this feature was scoped against), and
 *   2. TxODDS exposes a VAR-review signal in the feed (today's
 *      /api/scores/stream has no such stat key).
 * When both land, implement `subscribe()` to open `txline.streamScores()`
 * (from @onside/txline-client), emit `onTrigger` when the provider flags a
 * review in progress and `onResolution` when it reports the decision.
 */
export class TxlineVarEventSource implements VarEventSource {
  constructor(private readonly fixtureId: number) {}

  subscribe(_handlers: VarEventHandlers): () => void {
    throw new Error(
      `TxlineVarEventSource(${this.fixtureId}): not implemented — TxLINE has no VAR-review ` +
        "signal today and our subscription doesn't cover this competition. See the doc " +
        "comment on this class for what unlocks it."
    );
  }
}
