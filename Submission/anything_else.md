# Anything Else? — Player-level markets & clickable players (the roadmap)

_Other links / information we'd like to share._

---

## The direction: tap any player, bet on them

Onside's signature move is **player-level, in-play markets you place by tapping
the actual player on the live stream**. We built the hard client-side half of
this already:

- **In-browser computer vision** — YOLOv8n running on TensorFlow.js (WebGL, no
  server, no WASM/eval, immune to page CSP) detects the players in the video at
  ~7 Hz.
- **A dependency-free ByteTrack-lite tracker** gives each player a stable
  identity through crossings and short occlusions, so a chip *sticks* to a
  moving player.
- **Tap-to-tag** — click any player's box to name them from the lineup; tag a
  striker as **next goalscorer** and their frame turns lime.
- On DRM streams where we can't read pixels, a **tap-to-pin** fallback anchors
  chips to normalized video coordinates instead.

On top of that we mocked the market surface so judges can see the intent:
**next-goalscorer** odds pulled per player (name-matched), and **in-play prop
markets** in fullscreen — "next shot on target", "goal in the next 10′",
"next corner", "card in the next 10′".

## Why these aren't settled on-chain yet

**We are honest that TxODDS/TxLINE does not support this today**, and that's the
only reason these markets are display-only:

- The scores feed carries **opaque internal player IDs**, with **no names, no
  shirt numbers, and no players/squad endpoint** to resolve them.
- There is therefore **no player-level signed stat** (e.g. "player X had a shot
  on target", "player X scored") that we could Merkle-prove on-chain the way we
  already prove goals and corners.

So the next-scorer tag and the SIM props are **explicitly the roadmap**, not a
claim of current capability. The trustless settlement machinery is already built
and working for match result, corners, and total goals — the *moment* TxLINE
exposes player- and event-level signed data keyed to resolvable player
identities, these markets settle through the exact same
`txoracle::validate_stat` CPI, with zero new trust assumptions.

## What we'd need from TxLINE to ship it

1. **A player reference** (id → name + shirt number + team) so we can label the
   tracked players and match them to markets.
2. **Player-level signed stats** in the Merkle tree — anytime goalscorer, shots
   on target, cards — with the same `stat-validation` proof shape we already
   consume for team stats.
3. Optionally, **event-timestamped micro-stats** ("shot in minute N") to settle
   the in-play "next X in the next N minutes" props.

That's it. The CV, the tracking, the tap-to-bet UX, the parimutuel vaults, the
proof-verified settlement and the claim flow are all done. Player-level markets
are a data unlock away — and we think they're the breakout category for
signed-data sports markets.

## Links

- **Live viewer (markets + on-chain settlement proofs):** https://beerslothcoder.github.io/onside/
- **Repo:** https://github.com/BeerSlothCoder/onside
- **Onside program (devnet):** `DhFnzPPgyg77EczxLpmfuT2msD1yHzBLjWfz32q9A4B8`
