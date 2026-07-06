import type { TxlineCredentials } from "./auth.js";

/** Merkle proof node as returned by /api/scores/stat-validation. */
export interface ProofNode {
  hash: string | number[];
  isRightSibling: boolean;
}

/** Payload of /api/scores/stat-validation — everything settle() needs. */
export interface StatValidation {
  summary: {
    fixtureId: number;
    updateStats: {
      updateCount: number;
      minTimestamp: number;
      maxTimestamp: number;
    };
    eventStatsSubTreeRoot: string;
  };
  subTreeProof: ProofNode[];
  mainTreeProof: ProofNode[];
  eventStatRoot: string;
  statToProve: unknown;
  statProof: ProofNode[];
  statToProve2?: unknown;
  statProof2?: ProofNode[];
}

export class TxlineDataClient {
  constructor(private creds: TxlineCredentials) {}

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.creds.jwt}`,
      "X-Api-Token": this.creds.apiToken,
    };
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.creds.apiOrigin}${path}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
    return (await res.json()) as T;
  }

  /** Current scores snapshot for a fixture. */
  scoresSnapshot(fixtureId: number, asOf: number = Date.now()) {
    return this.get<unknown>(`/api/scores/snapshot/${fixtureId}?asOf=${asOf}`);
  }

  /** Score updates for a 5-minute interval bucket. */
  scoresUpdates(epochDay: number, hourOfDay: number, interval: number) {
    return this.get<unknown>(
      `/api/scores/updates/${epochDay}/${hourOfDay}/${interval}`
    );
  }

  /** Merkle validation payload for one or two stats — feeds the settle instruction. */
  statValidation(params: {
    fixtureId: number;
    seq: number;
    statKey: number;
    statKey2?: number;
  }) {
    const q = new URLSearchParams({
      fixtureId: String(params.fixtureId),
      seq: String(params.seq),
      statKey: String(params.statKey),
      ...(params.statKey2 ? { statKey2: String(params.statKey2) } : {}),
    });
    return this.get<StatValidation>(`/api/scores/stat-validation?${q}`);
  }

  /**
   * Subscribe to the real-time scores SSE stream.
   * Calls onMessage for each event until the signal aborts.
   */
  async streamScores(
    onMessage: (event: string | undefined, data: unknown) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const res = await fetch(`${this.creds.apiOrigin}/api/scores/stream`, {
      headers: {
        ...this.headers(),
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      },
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`stream → ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE messages are separated by a blank line
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let event: string | undefined;
        const dataLines: string[] = [];
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length > 0) {
          const joined = dataLines.join("\n");
          let parsed: unknown = joined;
          try {
            parsed = JSON.parse(joined);
          } catch {
            /* keep raw string */
          }
          onMessage(event, parsed);
        }
      }
    }
  }
}
