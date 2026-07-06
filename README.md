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

A hosted read-only viewer (markets + settlement proofs) and a demo video are linked
in the submission for review without installing anything.

## Status

- [x] Repo scaffold, TxLINE devnet client (auth flow, snapshots, SSE)
- [ ] Anchor program: create_market / place_bet / lock_market / settle / claim
- [ ] Merkle-proof settlement (CPI vs in-program verification — CU-measured)
- [ ] Extension overlay + demo-wallet judge mode
- [ ] Crank automation + viewer + hosted deploy
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
