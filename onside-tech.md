# Onside — Technical Documentation

**Prediction markets, played live.** Onside is a browser-extension overlay that
turns any live football stream into an in-play prediction market, with micro-
markets that open and settle *while you watch* — every settlement proven on-chain
against TxODDS TxLINE's cryptographically-signed match data on Solana. No oracle
to trust, no waiting, no leaving the stream.

Built from scratch for the **TxODDS World Cup Hackathon 2026** (Prediction Markets
& Settlement track).

- **Repo:** https://github.com/BeerSlothCoder/onside
- **Live viewer:** https://beerslothcoder.github.io/onside/
- **License:** MIT

---

## 1. System architecture

```
TxLINE (TxODDS)                                   Solana devnet
  /api/scores/stream (SSE) ─────► crank ─────► lock_market at full time
  /api/scores/stat-validation ──► crank ─────► settle(proof) ──► onside program
  StablePrice odds ──┐                              │  CPI → txoracle.validate_stat
  the-odds-api props ─┤   data proxy (localhost)    │  verifies Merkle proof vs
  (goalscorer)        └──► /live /odds /goalscorer  │  daily_scores_roots PDA
                            /lineups                 ▼
  browser extension (MV3 overlay on the stream) ──► parimutuel vault PDAs
    place_bet / claim (devnet USDC pools)             pro-rata payout
```

Four workspaces (npm workspaces monorepo):

| Package | Role |
|---|---|
| `programs/onside/` | Anchor program: parimutuel markets in devnet USDC, proof-verified settlement, claims |
| `extension/` | MV3 browser extension — the product: markets + tracking rendered over the stream |
| `packages/txline-client/` | TxLINE auth flow (subscribe → activate) + data endpoints + SSE |
| `crank/` | Permissionless lifecycle daemon + the data proxy |
| `viewer/` | Read-only hosted page: markets, pools, decoded settlement proofs |

---

## 2. On-chain program (`programs/onside/src/lib.rs`)

- **Program id (devnet):** `DhFnzPPgyg77EczxLpmfuT2msD1yHzBLjWfz32q9A4B8`
- **USDC mint (devnet test):** `33WQevmATbd5NPyWpQrWWXRBBYpYdT6F26ZG1wYnb9EX`
- **TxODDS txoracle (devnet):** `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`

### Accounts

- **Market PDA** — seeds `["market", fixture_id_le8, [kind], stat_key_le4]`.
  Holds: authority, fixture_id, `market_kind`, `stat_key`, `stat_key2?`,
  `threshold`, `min_settle_ts`, `finality_window_secs`, `state`
  (Open/Locked/Settled), `pools[3]`, `outcome?`, `settled_data_ts`, `claim_after`,
  `vault`.
- **Bet PDA** — seeds `["bet", market, bettor]`. One position per wallet per
  market (top-ups add to the same side).
- **Vault** — the market's associated USDC token account (parimutuel pool).

### Instructions

- `create_market(fixture_id, kind, stat_key, stat_key2, threshold, min_settle_ts, finality_window)`
- `place_bet(side, amount)` — transfers USDC into the vault, records the position.
- `lock_market()` — Open → Locked (crank calls at full time).
- `settle(outcome, proof)` — the trust core (below).
- `claim()` — pays the winner pro-rata from the winning-side pool; rejects losers.
- `faucet(amount)` — mints ≤100 test USDC (demo/judge convenience).

### Market kinds & how each settles from signed stats

| Kind | Sides | Proof |
|---|---|---|
| `MatchResult` (1X2) | Home/Draw/Away | `Subtract(stat1, stat2)` vs 0 (goal diff) |
| `StatOver` (single) | Over/Under | `stat_key` vs `threshold` (e.g. corners 7/8) |
| `StatOver` (two-stat) | Over/Under | `Add(stat_key, stat_key2)` vs `threshold` (total goals = 1+2) |

The two-stat total-goals path was added by making `StatOver` prove the **sum** of
two stats via the txoracle `Add` binary expression when `stat_key2` is present —
an additive change; single-stat corners markets are untouched.

### Settlement trust model (`settle`)

1. Require market Locked/Settled; require valid side; require the proof is about
   this fixture and `data_ts >= min_settle_ts` (and strictly newer on re-settle).
2. Require the proven stat key(s) equal the market's `stat_key`/`stat_key2`.
3. **Derive the predicate + op the claimed outcome implies** from the market's own
   mapping (`predicate_for`) and **overwrite** them in the proof args — a settler
   cannot claim an outcome the proof doesn't support.
4. **CPI into `txoracle::validate_stat`** to verify the Merkle proof against the
   daily roots TxODDS anchors on-chain; `require!(verdict, ProofRejected)`.
5. Set `outcome`, open a "later proof wins" finality window; claims unlock after it.

Cost ≈ 139k CU (≈10× headroom). Anyone can call settle; correctness is enforced
by the proof, not the caller.

---

## 3. The extension (MV3, `extension/`)

- **`content.tsx`** — injected into `youtube.com/watch`, `*.ceskatelevize.cz`,
  `*.nova.cz`, `*.tipsport.cz` in **all frames**. Top frame mounts the full
  `Overlay`; player iframes mount a `FrameTracker`. A full-cover root with
  absolutely-positioned children + a `fullscreenchange` reparent make the overlay
  survive fullscreen even when the site fullscreens a transformed wrapper.
- **`overlay/Overlay.tsx`** — slim brand bar (logo · played live · devnet ·
  balance · 🎯 tracking · 👥 rails), match auto-select, chain data polling, and
  the on-stream `StreamBoard`. Publishes the active match + a rails-collapse flag
  to `chrome.storage` for cross-frame sync.
- **`overlay/StreamBoard.tsx`** — the goal.live-style board rendered on the video:
  a large top strip (1X2 + total goals + live score/clock + ⇄ change-sides), and
  a full-height column per team (name header · players stretched · in-play props
  (fullscreen) · corners), with click-to-tag next scorer.
- **`chain/onside.ts`** — dependency-free client: decodes market/bet accounts by
  fixed borsh layout (avoids bundling Anchor), builds `place_bet`/`claim`/`faucet`
  transactions signed by the burner wallet.
- **`chain/live.ts`** — talks to the local data proxy for live scores, StablePrice
  odds and goalscorer odds; fetches route through the **background service worker**
  so an https stream page can reach `http://127.0.0.1` (page-CSP / Private Network
  Access safe).
- **`chain/wallet.ts`** — burner keypair in extension storage (demo/judge mode,
  free devnet SOL + faucet USDC). No real keys ever handled.

### Player tracking (`extension/src/tracking/`)

Three-tier graceful degradation:

- **Tier A — full CV:** a canvas-readback probe (`capture.ts`) confirms the
  `<video>` is readable (non-DRM), then **YOLOv8n** on **TensorFlow.js WebGL**
  (`detector.ts`) detects the `person` class at 640×640, ~7 Hz. A dependency-free
  **ByteTrack-lite** (`tracker.ts`) — greedy IoU association with high/low
  confidence buckets, constant-velocity prediction, occlusion buffer, proximity
  re-capture — gives players stable identities through crossings/occlusions. Chips
  are positioned by projecting each track to screen space every frame.
- **Tier B — tap-to-pin:** on DRM/tainted/embedded video, tap a player to anchor a
  chip at a normalized video coordinate (survives resize/fullscreen).
- **Tier C — off:** rails only.

TF.js WebGL uses no WASM/eval/workers, so it is immune to page CSP in the content-
script world; frames go GPU-direct via `tf.browser.fromPixels(video)`. The model
(~12 MB) ships in `web_accessible_resources` and loads lazily on toggle.

---

## 4. Data proxy & crank (`crank/`)

- **`crank/src/proxy.ts`** (localhost:8787) — read-only HTTP bridge so the TxLINE
  api token never reaches the browser. Serves: `/live` (scores/phase/clock/
  corners), `/odds/:fx` (accumulated StablePrice lines), `/goalscorer/:fx`
  (the-odds-api anytime-goalscorer, keyed by first-initial+surname), `/lineups/:fx`
  (hot-reloaded from `crank/fixtures/lineups.json` — edit, no restart). Sends
  `Access-Control-Allow-Private-Network`, binds all interfaces (WSL→Windows).
- **`crank/src/main.ts`** — the lifecycle daemon: derives tracked markets per
  fixture, **keeps markets open through the match** (locks only at full time so
  betting is genuinely in-play), then settles each with a TxLINE proof and exits
  when all are settled.
- **`crank/src/create-markets.ts`** — publishes 1X2 + home/away corners + total
  goals for a fixture. **`seed-pools.ts`** seeds starter liquidity so pool odds are
  meaningful from the first view. **`test-totalgoals.ts`** — end-to-end proof of
  the Add-op settlement.

---

## 5. Viewer (`viewer/`)

A static React page (GitHub Pages) that reads every Onside market straight from
devnet RPC (no server, no wallet), groups by fixture, shows pools/odds/state, and
for settled markets pulls the **settle transaction and displays the txoracle CPI
verification logs** — a judge can confirm any settlement is proof-verified on-chain
in one click. Deployed at https://beerslothcoder.github.io/onside/.

---

## 6. Data sources & odds format

- **TxODDS TxLINE** — fixtures, live scores & stats, StablePrice odds, and the
  on-chain Merkle proofs used for settlement. Odds are **decimal**, delivered as
  integer prices scaled ×1000 (e.g. `4003` → 4.00), plus a `Pct` array of implied
  percentage price-shares. Not fractional.
- **the-odds-api** (secondary, display only) — anytime-goalscorer prices for the
  player rails; held server-side by the proxy, never shipped to the client.
- **Lineups** — pasted per match (TxLINE has no player names/numbers) and hot-
  loaded into the proxy; flow into the rails and the tap-to-tag picker.

---

## 7. Build & run

```bash
npm install
npm run build -w extension     # load extension/dist as an unpacked MV3 extension
npm run proxy                  # localhost:8787 data proxy (needs .env credentials)
npm run crank                  # lock-at-FT + proof settlement daemon
npm run dev:viewer             # local viewer, or the hosted URL above
anchor build && anchor deploy  # program (upgrade authority = crank wallet)
```

Secrets (TxLINE JWT/token, the-odds-api key, GitHub token, wallet paths) live in a
gitignored `.env`; never shipped to the client.

---

## 8. Security notes

- Burner wallets only; the extension never asks for or handles a user's real
  private key.
- The TxLINE api token and the-odds-api key are held **server-side** by the proxy.
- Settlement correctness is enforced **on-chain** by the Merkle-proof CPI, not by
  whoever runs the crank — the crank is fully permissionless.
- Parimutuel design means the program never has to price odds or hold house risk;
  winners split the pool pro-rata.
