/**
 * Demo play-money ledger for VAR-moment predictions.
 *
 * This is DELIBERATELY NOT the real settlement path: the goal/corner/card
 * markets in @onside/txline-client + the onside Solana program move real
 * (devnet) USDC through an on-chain vault, proven trustlessly against
 * TxLINE Merkle roots. VAR markets resolve against a *recorded human
 * decision* (see the honesty note in market.ts), so — to keep that
 * distinction honest and architecturally visible — they spend a separate,
 * clearly-labelled play-money balance instead of touching the real vault.
 */

const STARTING_BALANCE = 1000;

/** Minimal storage hook so a browser demo can persist balances across
 *  reloads (e.g. `window.localStorage`). Omit it for a pure in-memory demo. */
export interface LedgerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface Reservation {
  userId: string;
  amount: number;
}

export class DemoLedger {
  private balances = new Map<string, number>();
  private readonly storageKey: string;

  constructor(
    private readonly storage?: LedgerStorage,
    storageKey = "onside_var_demo_ledger"
  ) {
    this.storageKey = storageKey;
    this.load();
  }

  private load(): void {
    const raw = this.storage?.getItem(this.storageKey);
    if (!raw) return;
    try {
      const entries = JSON.parse(raw) as [string, number][];
      this.balances = new Map(entries);
    } catch {
      /* corrupt/old shape — start fresh */
    }
  }

  private save(): void {
    this.storage?.setItem(this.storageKey, JSON.stringify([...this.balances.entries()]));
  }

  balanceOf(userId: string): number {
    if (!this.balances.has(userId)) {
      this.balances.set(userId, STARTING_BALANCE);
      this.save();
    }
    return this.balances.get(userId)!;
  }

  /** Deducts `amount` up front when a prediction is placed. Returns false
   *  (and changes nothing) if the balance can't cover it. */
  reserve(userId: string, amount: number): Reservation | null {
    const bal = this.balanceOf(userId);
    if (amount <= 0 || amount > bal) return null;
    this.balances.set(userId, bal - amount);
    this.save();
    return { userId, amount };
  }

  /** Refunds a reservation without any win/loss judgement (e.g. a market
   *  that never resolves, or an admin-cancelled demo event). */
  refund(reservation: Reservation): void {
    this.balances.set(reservation.userId, this.balanceOf(reservation.userId) + reservation.amount);
    this.save();
  }

  /** Credits a winning prediction: `payout` is the full amount returned,
   *  i.e. stake × odds — call this only for the winning side; losers keep
   *  the reservation gone and get nothing further. */
  credit(userId: string, payout: number): void {
    this.balances.set(userId, this.balanceOf(userId) + payout);
    this.save();
  }
}
