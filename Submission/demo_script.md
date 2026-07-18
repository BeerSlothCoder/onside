# Onside — Demo Video Script

**Length target:** ~2:30–3:00. **Tone:** confident, broadcast-y, fast.
**Setup:** a live (or replayed) World Cup match on tv.nova.cz / ceskatelevize.cz,
Onside extension loaded, burner wallet funded, `npm run proxy` + `npm run crank`
running. Record in fullscreen for the money shots.

Legend: **[SCREEN]** = what to show · **(VO)** = voiceover.

---

## 0:00 – 0:12 · Hook

**[SCREEN]** Full-screen live match. The Onside board fades in over the stream —
top strip with 1X2 + total-goals odds, both team rails, corners.
**(VO)** "This is a real World Cup match, live. And this is a prediction market —
running *on top of the stream*, settled on Solana, with no oracle to trust."

## 0:12 – 0:35 · The problem

**[SCREEN]** Quick cut: a normal prediction-market UI (static, match-outcome only).
**(VO)** "Every prediction market today stops at 'who wins', and settles through
slow, disputable human oracles. Nothing about the *moment* — the next corner, the
next goal — and nothing you can settle trustlessly in real time."

## 0:35 – 1:05 · The product — bet on the moment

**[SCREEN]** Click **England** in the top strip → stake chips → **CONFIRM
PREDICTION**. Wallet balance ticks down. The position chip appears.
**(VO)** "Onside opens micro-markets on live moments — match result, team corners,
total goals — and you bet them in-play, right on the video."
**[SCREEN]** Click a **corners Over** and a **total-goals Over**. Show the live
score/clock and the 'now 2' live corner count updating.
**(VO)** "Odds are TxODDS StablePrice; the pools are on-chain in devnet USDC."

## 1:05 – 1:40 · The differentiator — tap any player

**[SCREEN]** Toggle 🎯, enable 🤖 Auto. Boxes lock onto the players and track
them. Click a striker's frame → tag from the lineup → tag as **next scorer** →
his chip turns **lime**. Show the goalscorer odds next to the rail names.
**(VO)** "We built player tracking in the browser — no server, pure WebGL. Tap any
player to open a market on them. Next goalscorer, in-play props — this is the
roadmap for player-level markets as signed data expands."
**[SCREEN]** Show the fullscreen in-play props panel (next shot on target, goal in
10′) lighting up lime on click.

## 1:40 – 2:20 · The payoff — trustless settlement + claim

**[SCREEN]** Cut to full time / a settled fixture. Open the viewer
(**beerslothcoder.github.io/onside**). Click **🧾 verify settlement on-chain**.
**(VO)** "At full time the crank fetches a TxLINE Merkle proof and settles every
market on Solana — by CPI into the TxODDS oracle program, which verifies the proof
against the roots TxODDS anchors on-chain."
**[SCREEN]** Show the settle transaction + the `txoracle validate_stat → TRUE`
logs. Then back in the extension, the green **CLAIM** button → winnings paid.
**(VO)** "No human oracle. Anyone can settle; nobody can settle it wrong. Winners
claim pro-rata from the pool, on-chain."

## 2:20 – 2:45 · Close

**[SCREEN]** Wide shot of the full board over the live match; then the Onside logo
on a clean frame.
**(VO)** "Onside. Prediction markets, played live — settled from signed data on
Solana. Built on TxODDS TxLINE for the World Cup hackathon."
**[SCREEN]** End card: logo + "Prediction markets, played live." + viewer URL +
program address.

---

## Shot checklist (capture these clips)

- [ ] Board fading in over a fullscreen live match
- [ ] Placing a 1X2 bet: click → stake → CONFIRM → balance ticks → position chip
- [ ] Corners + total-goals bets with live counts updating
- [ ] 🤖 Auto tracking: boxes sticking to moving players
- [ ] Tag a player from the lineup; tag **next scorer** → lime chip
- [ ] Fullscreen in-play props panel
- [ ] Viewer: settled market → verify settlement → txoracle TRUE logs
- [ ] Green CLAIM → winnings paid on-chain
- [ ] Logo end card

## Talking-point bank (pick the strongest 3–4)

- "In-play micro-markets, not just who wins."
- "Settled from cryptographically-signed match data — the signed data is the referee."
- "On-chain proof verification via CPI into the TxODDS oracle — no multisig, no admin key."
- "Player tracking in the browser; tap any player to bet on them."
- "Everything on Solana devnet, total cost to the user: $0."
