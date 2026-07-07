import type { TxlineCredentials } from "./auth.js";

/** Merkle proof node as returned by /api/scores/stat-validation. */
export interface ProofNode {
  hash: string | number[];
  isRightSibling: boolean;
}

/** Fixture metadata from /api/fixtures/snapshot. */
export interface Fixture {
  Ts: number;
  StartTime: number;
  Competition: string;
  CompetitionId: number;
  FixtureGroupId: number;
  Participant1Id: number;
  Participant1: string;
  Participant2Id: number;
  Participant2: string;
  FixtureId: number;
  [k: string]: unknown;
}

/** One score update message (historical or stream). */
export interface ScoreUpdate {
  FixtureId?: number;
  Seq?: number;
  GlobalSeq?: number;
  Ts?: number;
  [k: string]: unknown;
}

/** World Cup 2026 competition id observed in the fixtures feed. */
export const WORLD_CUP_COMPETITION_ID = 72;

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

  /** Latest fixtures snapshot, optionally windowed / filtered by competition. */
  fixturesSnapshot(params?: { startEpochDay?: number; competitionId?: number }) {
    const q = new URLSearchParams();
    if (params?.startEpochDay !== undefined)
      q.set("startEpochDay", String(params.startEpochDay));
    if (params?.competitionId !== undefined)
      q.set("competitionId", String(params.competitionId));
    const qs = q.toString();
    return this.get<Fixture[]>(`/api/fixtures/snapshot${qs ? `?${qs}` : ""}`);
  }

  /**
   * Full sequence of score updates for one fixture (post-match audit trail).
   * Note: the endpoint responds in SSE format (`data: {...}` lines), not JSON.
   */
  async scoresHistorical(fixtureId: number): Promise<ScoreUpdate[]> {
    const res = await fetch(
      `${this.creds.apiOrigin}/api/scores/historical/${fixtureId}`,
      { headers: this.headers() }
    );
    if (!res.ok) throw new Error(`historical ${fixtureId} → ${res.status}`);
    const text = await res.text();
    return text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => JSON.parse(l.slice(5)) as ScoreUpdate);
  }

  /** Latest odds per market line for a fixture (StablePrice). */
  oddsSnapshot(fixtureId: number, asOf?: number) {
    const qs = asOf ? `?asOf=${asOf}` : "";
    return this.get<unknown[]>(`/api/odds/snapshot/${fixtureId}${qs}`);
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
