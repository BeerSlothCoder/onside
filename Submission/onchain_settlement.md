# Onside — On-chain Resolution, Settlement & Claims

**Everything below is live on Solana devnet — not simulated.** Onside markets
are settled trustlessly from TxODDS TxLINE Merkle-proof-verified match data.
There is no admin key and no trusted human oracle: anyone can settle a market,
and nobody can settle it wrong.

- **Onside program (devnet):** `DhFnzPPgyg77EczxLpmfuT2msD1yHzBLjWfz32q9A4B8`
- **TxODDS txoracle program (devnet):** `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`
- **Read-only viewer (markets + settlement proofs):** https://beerslothcoder.github.io/onside/

---

## 1. On-chain resolution from TxODDS

The Onside program's `settle` instruction does a **CPI into the TxODDS
`txoracle` program's `validate_stat`**, which verifies a TxLINE **Merkle proof**
— the fixture summary, the per-stat proofs, and the main-tree path — against the
daily stat roots TxODDS anchors on Solana (`daily_scores_roots`).

Trust model, enforced in the program:

- The settler submits the proof, but the program **derives the predicate the
  claimed outcome implies from the market's own stat-key mapping and overwrites
  the predicate/op in the proof args** before the CPI. A settler therefore
  cannot smuggle in a different claim than the outcome requires.
- `require!(verdict, ProofRejected)` aborts if the oracle returns `false`, so an
  incorrect settlement simply cannot land.
- A "later proof wins" finality window guards against premature/mid-match proofs;
  claims open only after it closes.

**Verified with a real World Cup result:** a market on Portugal 0–1 Spain
(fixture 18202205, seq 993) settled via CPI — the false "home win" claim is
rejected on-chain, the true "away win" is accepted. Settlement costs ~139k CU
(≈10× headroom).

## 2. On-chain settlement (automated, permissionless)

A permissionless crank daemon watches the fixture feed, locks each market at
full time, fetches the stat-validation proof from TxLINE, and submits `settle`.
Anyone can run it; correctness is enforced on-chain by the proof, not by the
operator.

**Live state on devnet: 16 of 17 markets are settled this way**, across match
result (1X2), team corners over/under, and total goals.

Three settleable market kinds today, all from signed stats:

| Market | How it settles from the proof |
|---|---|
| **Match result (1X2)** | goal-difference of stats 1 & 2 (Subtract), vs 0 |
| **Team corners over N** | single stat (7/8) vs threshold |
| **Total goals over N** | **sum** of stats 1 & 2 (Add) vs threshold |

The total-goals market uses the txoracle `Add` binary expression to prove
`home_goals + away_goals > N` from two Merkle-proven stats. Verified end-to-end
(Norway 1–2 England → total 3 → OVER settled with a real proof).

## 3. Claim of winnings (parimutuel, on-chain)

Markets are **parimutuel pools in devnet USDC** held in per-market vault PDAs.
After settlement and the finality window, the `claim` instruction pays each
winner **pro-rata from the winning-side pool**; losing claims are rejected
on-chain. In the extension this is the green **CLAIM** button in the match panel.

**Full money loop verified on devnet** (Mexico 2–3 England): two bettors stake
test USDC → market locks → settles by Merkle proof → winner claims the whole pot
pro-rata → the losing claim is rejected. Zero real cost — devnet + faucet USDC.

## What is NOT on-chain (and why)

Two demo features are **display-only** and deliberately labelled as roadmap:

- **Next-goalscorer tag** (tap a player → green) and
- **In-play "SIM" props** (next shot on target, goal in next 10′, etc.)

These need **player- and event-level signed data** that TxLINE does not expose
today. They show the product direction; they do not settle on-chain. Everything
with a real market address and a pool settles trustlessly from TxODDS data.
