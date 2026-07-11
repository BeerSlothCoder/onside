# Onside ⚽

**Prediction markets, played live.**

Onside is a browser-extension overlay that turns any live football stream into an
in-play prediction market. Markets on micro-moments — match result, first-half goal,
corners, cards — open and settle **while you watch**, and every settlement is
**trustless**: outcomes are proven on-chain against [TxLINE](https://txline.txodds.com)'s
cryptographically anchored match data on Solana. No oracle to trust. No waiting.
No leaving the stream.

Built from scratch for the **TxODDS World Cup Hackathon 2026**
(Prediction Markets & Settlement track).

---

## Why this is different

Existing Solana prediction markets settle match-outcome contracts through trusted
oracles. Onside does two things they don't:

1. **In-play micro-markets** — first-half goal, team corners over N, cards — the
   moments that make live football exciting, not just the final result.
2. **Merkle-proof settlement** — the `settle` instruction verifies a TxLINE
   stat-validation proof against the Merkle roots TxODDS anchors on Solana
   (`daily_scores_roots`). Anyone can settle a market; nobody can settle it wrong.

## Architecture

```
TxLINE (TxODDS)                                Solana (devnet)
  /api/scores/stream (SSE) ──► crank ──► lock_market at kickoff
  /api/scores/stat-validation ─► crank ──► settle(proof) ──► onside program
  StablePrice odds ──► overlay (reference prices)      │  verifies Merkle proof vs
                                                       │  daily_scores_roots PDA
  browser extension (MV3 overlay on the stream) ───────┤
    place_bet / claim (devnet USDC pools)              ▼
                                            parimutuel vault PDAs, pro-rata payout
```

- `programs/onside/` — Anchor program: parimutuel markets in devnet USDC, proof-verified settlement
- `extension/` — MV3 overlay extension (the product): markets rendered over the stream
- `packages/txline-client/` — TxLINE auth flow (subscribe → activate) + data endpoints + SSE
- `crank/` — permissionless market lifecycle: create from schedule, lock at kickoff, settle with proofs
- `viewer/` — read-only hosted page: markets, pools, and settlement proofs (judge aid)

## Judge quickstart (zero cost, no wallet needed)

1. `npm install && npm run dev:extension`, then load `extension/dist` via
   `chrome://extensions` → *Load unpacked* (≈1 minute).
2. Open any football stream page (e.g. a YouTube match) — the Onside overlay appears.
3. In the popup choose **Demo wallet** → one click generates a burner keypair and
   funds it with free devnet SOL + test USDC (faucet mint
   `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr`).
4. Bet on an open market → watch the match → the market settles with an on-chain
   Merkle proof → claim your payout. Every step is on Solana devnet; total cost: $0.

No install needed at all: the hosted read-only viewer at
**<https://beerslothcoder.github.io/onside/>** lists every devnet market and lets you
open any settled market's on-chain Merkle-proof verification (the settle transaction's
`txoracle` CPI logs) in one click.

### Running the live stack (optional)

```bash
npm run crank    # market lifecycle: lock at kickoff, settle at FT with TxLINE proofs
npm run proxy    # localhost:8787 — live scores, StablePrice odds and lineups for the
                 # overlay & viewer (holds the TxLINE credentials server-side)
```

The extension and viewer work without the proxy; with it they gain live scores,
match clock, live corner counts and StablePrice reference odds. Lineups served from
`crank/fixtures/lineups.json` are hot-reloaded — edit the file, no rebuild.

## Status

- [x] Repo scaffold, TxLINE devnet client (auth flow, snapshots, SSE)
- [x] **On-chain proof validation verified with a real World Cup result**:
      Portugal 0–1 Spain (fixture 18202205 → seq 993) proven via
      `txoracle.validateStat` on devnet — "away win" validates `true`,
      the false claim "home win" returns `false`
      (`npx tsx crank/src/stage1-validate.ts`)
- [x] **Anchor program deployed on devnet** —
      [`DhFnzPPgyg77EczxLpmfuT2msD1yHzBLjWfz32q9A4B8`](https://explorer.solana.com/address/DhFnzPPgyg77EczxLpmfuT2msD1yHzBLjWfz32q9A4B8?cluster=devnet):
      parimutuel USDC pools, permissionless proof-verified settlement
- [x] **Trustless settlement live**: market on the real Portugal–Spain fixture
      settled via CPI into `txoracle.validate_stat` —
      [false "home win" claim rejected on-chain, true "away win" accepted](https://explorer.solana.com/tx/g4443sGxhsK5PEqVvdqKy6cQVPKT9t8vMgkYj1CKoP6NGoTumkttohUYCUyaL19qQwuhb72jHQ1swakWkLobfZT?cluster=devnet).
      Settlement costs ~139k CU (10× headroom). "Later proof wins" finality
      window (15 min) guards against mid-match proofs; claims open after it.
- [x] **Full money loop verified on devnet** (Mexico 2–3 England): two bettors
      stake test USDC, market locks, settles by Merkle proof, the winner
      claims the whole pot pro-rata, the losing claim is rejected on-chain
      (`npx tsx crank/src/stage2b-e2e.ts`). Per-market finality window
      (30 s–1 h) with "later proof wins" re-settlement.
- [x] **Extension overlay + demo-wallet judge mode** — markets over the stream on
      ceskatelevize.cz / tv.nova.cz / tipsport.cz / YouTube, burner-wallet faucet,
      bet → settle → claim exercised live during the quarter-finals
- [x] **Sticky clickable players** — in-browser YOLOv8n + ByteTrack-lite tracker
      (7 Hz, WebGL, no server) pins tappable player chips to the actual players in
      the video; tap-to-pin fallback on DRM streams
- [x] **Crank automation + data proxy + viewer deployed** — crank locks/settles
      unattended; localhost proxy serves live scores + StablePrice odds + lineups;
      hosted viewer with per-market on-chain proof verification:
      <https://beerslothcoder.github.io/onside/>
- [ ] Pool math edge-case test suite (bankrun)
- [ ] Demo video + submission

## Originality & attribution

This project was created from scratch during the hackathon period (first commit
July 6, 2026). The team behind Onside also builds goal.live, a separate
betting-overlay product; **no code is shared** — Onside is a new codebase, a new
data provider (TxODDS/TxLINE), and a new, fully trustless settlement architecture.

Open-source dependencies (attributed per hackathon rules): Anchor (`@coral-xyz/anchor`),
`@solana/web3.js`, `@solana/spl-token`, React, Vite, tweetnacl, axios/undici.
TxLINE data is used under the hackathon data licence. This project is not affiliated
with, sponsored by, or endorsed by FIFA or any tournament organiser.

## License

MIT — see [LICENSE](./LICENSE).
