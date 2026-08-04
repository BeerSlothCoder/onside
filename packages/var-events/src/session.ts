/**
 * VarMarketSession — wires a VarEventSource's trigger/resolution stream into
 * live VarMarketController instances. This is the one piece of plumbing
 * shared by every consumer (the replay demo, the admin tool, and eventually
 * a live TxLINE feed): create a controller on each trigger, route each
 * resolution to the controller with the matching trigger id.
 */
import { DemoLedger } from "./ledger.js";
import { VarMarketController, VarMarketOptions } from "./market.js";
import type { VarEventSource } from "./source.js";

export type VarSessionListener = (markets: VarMarketController[]) => void;

export class VarMarketSession {
  private readonly controllers = new Map<string, VarMarketController>();
  private readonly listeners = new Set<VarSessionListener>();
  private readonly unsubscribeSource: () => void;
  /** Wall-clock start of this session — anchors `VarMarketController.toVarEvent()`. */
  readonly startedAtMs = Date.now();

  constructor(
    source: VarEventSource,
    private readonly ledger: DemoLedger,
    private readonly opts: VarMarketOptions = {}
  ) {
    this.unsubscribeSource = source.subscribe({
      onTrigger: (trigger) => {
        const controller = new VarMarketController(trigger, this.ledger, this.opts);
        this.controllers.set(trigger.id, controller);
        controller.onChange(() => this.emit());
      },
      onResolution: (resolution) => {
        this.controllers.get(resolution.triggerId)?.resolve(resolution);
      },
    });
  }

  onChange(listener: VarSessionListener): () => void {
    this.listeners.add(listener);
    listener(this.markets());
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const markets = this.markets();
    for (const l of this.listeners) l(markets);
  }

  markets(): VarMarketController[] {
    return [...this.controllers.values()].sort((a, b) => a.snapshot().openedAtMs - b.snapshot().openedAtMs);
  }

  /** Every resolved market in this session, as VarEvent records — hand this
   *  to `JSON.stringify` to save an admin-run session as a new
   *  sample-events file. */
  toVarEvents() {
    return this.markets()
      .map((c) => c.toVarEvent(this.startedAtMs))
      .filter((e): e is NonNullable<typeof e> => e !== null);
  }

  dispose(): void {
    this.unsubscribeSource();
    for (const c of this.controllers.values()) c.dispose();
    this.controllers.clear();
    this.listeners.clear();
  }
}
