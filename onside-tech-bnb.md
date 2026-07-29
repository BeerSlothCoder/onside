# Onside — Technical Documentation (BNB Smart Chain · StatsPerform)

**Prediction markets, played live.** Onside is a browser-extension overlay that
turns any live football stream into an in-play prediction market, with micro-
markets that open and settle *while you watch* — every settlement proven on-chain
against **StatsPerform (Opta)** signed match data on **BNB Smart Chain**. No oracle
to trust blindly, no waiting, no leaving the stream.

> This is the **BNB Smart Chain edition** of Onside: the same product, tracking and
> UX, ported to **EVM smart contracts** deployed via **thirdweb** on **BNB Smart
> Chain Testnet (chain id 97)**, with **StatsPerform / Opta SDAPI** as the data,
> events and odds source relayed on-chain. (A Solana-native build exists too — see
> the [Solana version](tech.html).)

- **Repo:** https://github.com/BeerSlothCoder/onside
- **Live viewer:** https://beerslothcoder.github.io/onside/
- **Chain:** BNB Smart Chain Testnet — chain id `97`, gas token `tBNB`, explorer `testnet.bscscan.com`, tooling **thirdweb** (`thirdweb.com/binance-testnet`)
- **License:** MIT

---

## 1. System architecture

```
StatsPerform (Opta SDAPI)                          BNB Smart Chain Testnet (EVM)
  live events / scores / stats ─► relayer ─► postRoot() ─► OnsideOracle
  in-play + pre-match odds ──┐                         │  (daily result roots +
  goalscorer props ──────────┤  data proxy (localhost) │   relayer ECDSA signer)
                             └─► /live /odds /events    │        ▲ validateStat()
                                 /goalscorer /lineups   │        │ Merkle proof + sig
  browser extension (MV3 overlay on the stream) ──► OnsideMarket (parimutuel)
    placeBet / claim (test-USDC ERC-20 pools) ────────► pro-rata payout
```

Four workspaces (npm workspaces monorepo):

| Package | Role |
|---|---|
| `contracts/` | Solidity (EVM) — parimutuel markets in test-USDC, StatsPerform-proof-verified settlement, claims; deployed with **thirdweb** |
| `extension/` | MV3 browser extension — the product: markets + tracking rendered over the stream |
| `packages/opta-client/` | StatsPerform **Opta SDAPI** client — fixtures, live events, stats, odds |
| `crank/` | Permissionless lifecycle daemon + the data proxy + the on-chain **relayer** |
| `viewer/` | Read-only hosted page: markets, pools, decoded settlement + oracle verification |

---

## 2. On-chain contracts (Solidity, EVM — deployed via thirdweb on BNB testnet)

Contracts are deployed with `npx thirdweb deploy` to BNB Smart Chain Testnet
(chain id `97`); published addresses live in the repo and the viewer after deploy.

| Contract | Role |
|---|---|
| `OnsideMarketFactory.sol` | Deploys deterministic markets per fixture (CREATE2), keeps the registry |
| `OnsideMarket.sol` | One parimutuel market: pools per side, `placeBet`/`lock`/`settle`/`claim` |
| `OnsideOracle.sol` | StatsPerform result registry + verifier (`postRoot`, `validateStat`) |
| `TestUSD.sol` | ERC-20 test stablecoin (6 decimals) with a capped `faucet` for judges |

### Market state

- **Market** — deterministic address from `keccak256(fixtureId, kind, statKey)`.
  Holds: `authority`, `fixtureId`, `kind`, `statKey`, `statKey2?`, `threshold`,
  `minSettleTs`, `finalityWindow`, `state` (Open/Locked/Settled), `pools[3]`,
  `outcome?`, `settledDataTs`, `claimAfter`, and the ERC-20 pool balance.
- **Bet** — `mapping(address => Position)` per market. One position per wallet
  (top-ups add to the same side).
- **Pool** — test-USDC (ERC-20) held by the market contract (parimutuel).

### Functions

- `createMarket(fixtureId, kind, statKey, statKey2, threshold, minSettleTs, finalityWindow)`
- `placeBet(side, amount)` — `transferFrom` test-USDC into the market, records the position.
- `lock()` — Open → Locked (crank calls at full time).
- `settle(outcome, proof)` — the trust core (below).
- `claim()` — pays the winner pro-rata from the winning-side pool; rejects losers.
- `faucet(amount)` — mints ≤100 test-USDC (demo/judge convenience).

### Market kinds & how each settles from signed stats

| Kind | Sides | Proof |
|---|---|---|
| `MatchResult` (1X2) | Home/Draw/Away | `sub(stat1, stat2)` vs 0 (goal diff) |
| `StatOver` (single) | Over/Under | `statKey` vs `threshold` (e.g. corners 7/8) |
| `StatOver` (two-stat) | Over/Under | `add(statKey, statKey2)` vs `threshold` (total goals = 1+2) |

The two-stat total-goals path proves the **sum** of two stats via the oracle's
`Add` op when `statKey2` is present — additive; single-stat corners are untouched.

### Settlement trust model (`settle`)

1. Require market Locked/Settled; require valid side; require the proof is about
   this fixture and `dataTs >= minSettleTs` (strictly newer on re-settle).
2. Require the proven stat key(s) equal the market's `statKey`/`statKey2`.
3. **Derive the predicate + op the claimed outcome implies** from the market's own
   mapping and **overwrite** them in the proof args — a settler cannot claim an
   outcome the proof doesn't support.
4. **Call `OnsideOracle.validateStat`**, which verifies (a) a **Merkle proof** of
   the stat against the day's result root and (b) the **relayer's ECDSA signature**
   over that root (`ecrecover`) — `require(ok, "ProofRejected")`.
5. Set `outcome`, open a "later proof wins" finality window; claims unlock after it.

Cost ≈ **~180k gas** (Merkle verify + `ecrecover`) — trivially within BNB block
limits and cents in `tBNB`. Anyone can call `settle`; correctness is enforced by
the proof + signature, not the caller.

### How StatsPerform data reaches the chain (the relayer)

A permissionless **relayer** (`crank/`) subscribes to Opta SDAPI, computes each
market's stat at full time (and mid-match snapshots), builds a **Merkle tree of the
day's fixture results**, and calls `OnsideOracle.postRoot(root, sig)` with an
**ECDSA signature** from the StatsPerform-data signer key. Settlement then verifies
any single result against that posted root — StatsPerform's signed data is the
referee, exactly as the daily roots are on the Solana build.

---

## 3. The extension (MV3, `extension/`)

- **`content.tsx`** — injected into `youtube.com/watch`, `*.ceskatelevize.cz`,
  `*.nova.cz`, `*.tipsport.cz` in **all frames**. Top frame mounts the full
  `Overlay`; player iframes mount a `FrameTracker`. A full-cover root + a
  `fullscreenchange` reparent keep the overlay alive through fullscreen.
- **`overlay/Overlay.tsx`** — brand bar (logo · played live · BNB testnet ·
  balance · 🎯 tracking · 👥 rails), match auto-select, chain-data polling, and the
  on-stream `StreamBoard`.
- **`overlay/StreamBoard.tsx`** — the board rendered on the video: 1X2 + total
  goals + live score/clock + ⇄ change-sides, and a full-height column per team
  (players · in-play props · corners), with click-to-tag next scorer.
- **`chain/onside.ts`** — EVM client via **viem** + the **thirdweb SDK**:
  ABI-encodes `placeBet`/`claim`/`faucet`, reads market/bet state through BNB
  testnet RPC (`eth_call`), decodes with the contract ABI.
- **`chain/live.ts`** — talks to the local data proxy for live scores, Opta odds
  and events; fetches route through the **background service worker** so an https
  stream page can reach `http://127.0.0.1` (page-CSP / Private Network safe).
- **`chain/wallet.ts`** — a **thirdweb in-app (embedded) wallet** or a burner EVM
  keypair in extension storage (demo/judge mode): funded with `tBNB` from the BNB
  faucet + `TestUSD` faucet, with optional **gasless** UX via thirdweb account
  abstraction + paymaster. No real keys ever handled.

### Player tracking (`extension/src/tracking/`)

Three-tier graceful degradation (chain-agnostic — unchanged from the Solana build):

- **Tier A — full CV:** a canvas-readback probe confirms the `<video>` is readable
  (non-DRM), then **YOLOv8n** on **TensorFlow.js WebGL** detects the `person` class
  at 640×640, ~7 Hz. A dependency-free **ByteTrack-lite** (greedy IoU association,
  constant-velocity prediction, occlusion buffer) gives stable identities through
  crossings. Chips project to screen space every frame.
- **Tier B — tap-to-pin:** on DRM/tainted/embedded video, tap a player to anchor a
  chip at a normalized video coordinate (survives resize/fullscreen).
- **Tier C — off:** rails only.

TF.js WebGL uses no WASM/eval/workers, so it is immune to page CSP; frames go
GPU-direct via `tf.browser.fromPixels(video)`. The model (~12 MB) ships in
`web_accessible_resources` and loads lazily on toggle.

### Honest scope — what the tracking is (and isn't)

It's **client-side person detection + short-term multi-object tracking with
human-assigned identities** — a tap-to-bet *interaction layer*, not a
player-position *data product*.

- **Detects people, not players.** YOLOv8n finds the generic `person` class — no
  jersey-number OCR, no kit/face re-identification.
- **2D screen space, not pitch XY.** No camera calibration / homography.
- **Identity is assigned by the user** (tap a track → pick from the lineup).
- **Not a settlement source.** Next-goalscorer bets settle only when StatsPerform
  player-event data is relayed on-chain; tracking is the UX substrate that makes
  tap-to-bet work today and plugs into real markets the moment that data exists.
- **Best-effort:** identities can swap on heavy occlusion / hard zoom / cuts.

---

## 4. Data proxy, relayer & crank (`crank/`)

- **`crank/src/proxy.ts`** (localhost:8787) — read-only HTTP bridge so the Opta
  SDAPI key never reaches the browser. Serves `/live` (scores/phase/clock/corners),
  `/odds/:fx` (StatsPerform decimal odds), `/events/:fx` (goals/corners/cards/
  shots), `/goalscorer/:fx`, `/lineups/:fx` (hot-reloaded from
  `crank/fixtures/lineups.json`). Sends `Access-Control-Allow-Private-Network`.
- **`crank/src/relayer.ts`** — subscribes to Opta events, builds the daily result
  Merkle tree, and posts roots to `OnsideOracle` with the signer key (the on-chain
  bridge for StatsPerform data).
- **`crank/src/main.ts`** — the lifecycle daemon: derives tracked markets per
  fixture, **keeps markets open through the match** (locks only at full time so
  betting is genuinely in-play), then settles each against the posted root.
- **`crank/src/create-markets.ts`** — publishes 1X2 + home/away corners + total
  goals per fixture. **`seed-pools.ts`** seeds starter liquidity so pool odds are
  meaningful from the first view.

---

## 5. Viewer (`viewer/`)

A static React page (GitHub Pages) that reads every Onside market straight from a
BNB testnet RPC (no server, no wallet), groups by fixture, shows pools/odds/state,
and for settled markets pulls the **settle transaction + the `OnsideOracle`
verification event** — a judge can confirm any settlement is proof-verified
on-chain in one click. Deployed at https://beerslothcoder.github.io/onside/.

---

## 6. Data sources & odds format

- **StatsPerform (Opta SDAPI)** — fixtures, live scores, match events (goals,
  corners, cards, shots), player events, and pre-match + in-play odds. Odds are
  **decimal**. Opta SDAPI is already integrated on trial keys.
- **Lineups** — from Opta squad/lineup feeds, hot-loaded into the proxy; flow into
  the rails and the tap-to-tag picker.
- The relayer signs and posts the results used for settlement; the Opta key stays
  server-side and never ships to the client.

---

## 7. Build & run

```bash
npm install
npx thirdweb deploy                 # deploy contracts to BNB testnet (chain 97)
npm run proxy                       # localhost:8787 Opta data proxy (.env key)
npm run relayer                     # posts signed StatsPerform roots to OnsideOracle
npm run crank                       # lock-at-FT + proof settlement daemon
npm run build -w extension          # load extension/dist as an unpacked MV3 extension
npm run dev:viewer                  # local viewer, or the hosted URL above
```

Get `tBNB` from the BNB testnet faucet (`testnet.bnbchain.org/faucet-smart`), then
`faucet()` 100 test-USDC in the extension. Secrets (Opta key, relayer signer key,
deployer key) live in a gitignored `.env`; never shipped to the client.

---

## 8. Security notes

- Burner / thirdweb in-app wallets only; the extension never handles a real key.
- The Opta SDAPI key and the relayer signer key are held **server-side**.
- Settlement correctness is enforced **on-chain** by the `OnsideOracle` Merkle +
  ECDSA verification, not by whoever runs the crank — the crank is permissionless.
- Parimutuel design means the contracts never price odds or hold house risk;
  winners split the pool pro-rata.
