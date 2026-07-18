# Our experience with the TxLINE API

_Share your team's experience using the TxLINE API. What did you like the most,
and where did you hit friction?_

---

## What we liked most

**The on-chain Merkle-proof verification is the whole reason Onside exists.**
Being able to CPI into `txoracle::validate_stat` and have a Solana program prove
a match stat against roots TxODDS anchors on-chain — with no trusted oracle,
no multisig, no admin key — is genuinely novel settlement infrastructure. It let
us build a prediction market where *anyone can settle and nobody can settle it
wrong*, which is not possible on the generic-oracle rails every other Solana
prediction market uses.

Specific things that worked well:

- **`/api/scores/stat-validation`** returns exactly the argument set the
  `settle` instruction needs (fixture summary, sub-tree proof, main-tree proof,
  per-stat proofs). The mapping from API payload → on-chain instruction args was
  clean once we understood the shape.
- **The `Add`/`Subtract` binary-expression support** in `validate_stat` let us
  build both match-result (goal difference, Subtract) and total-goals (sum of
  two stats, Add) markets from the same primitive — a small program change, no
  new oracle surface.
- **Free World Cup service tiers** and a working devnet program made it possible
  to build and demo the entire trustless loop at zero cost.
- **The StablePrice (demargined) odds feed** gave us real, meaningful reference
  prices (decimal, scaled ×1000, plus percentage price-shares) to display next
  to our parimutuel pools.
- **Real fixtures with real stats** — corners, goals, cards, per-period keys —
  were enough to build genuine in-play micro-markets, not just match outcome.

## Where we hit friction

- **Odds snapshot returns only recently-updated lines.** A single call rarely
  has the full board; we had to run a small server that accumulates lines per
  market (type + line + period) and keeps the freshest of each. A "full snapshot"
  option, or a documented "return all current lines" flag, would have saved us a
  polling layer.
- **Discovering the exact `settle` arg shape was trial-and-error.** The biggest
  time sink was matching the Merkle-proof JSON to the on-chain
  `ValidateStatArgs` struct — byte-32 encodings, sibling ordering, the
  fixture-summary sub-fields, and which proof feeds `stat_a` vs `stat_b`. A
  reference "here is the raw API response, here is the exact instruction it maps
  to" example (ideally a copy-paste TS snippet) would have cut a day.
- **No lineups / player reference.** The feed carries opaque internal player IDs
  (e.g. `539318`) with no names or shirt numbers, and there is no players /
  participants / squad endpoint. Our signature feature — tap a player on the
  pitch — therefore can't be settled from TxLINE yet, and lineups have to come
  from elsewhere. Player-level stats keyed to resolvable identities would unlock
  a whole category of markets (see our "player-level markets" note).
- **No corners odds in the odds feed.** Scores expose corners (so we can *settle*
  a corners market), but the odds feed prices only result / goals / handicap —
  so corners markets show parimutuel pool odds only, never a StablePrice.
- **Window/latency for replays.** For demo recordings on delayed/replayed
  broadcasts, the live-window assumptions in the feed meant odds/props for a past
  fixture had aged out — expected for a real-time feed, but a note on historical
  access for player-props would help demo workflows.
- **The odds snapshot is SSE for some routes and JSON for others** — minor, but
  worth documenting per-endpoint so clients know when to parse `data:` lines.

## Net

The friction was almost entirely *documentation and shape-matching*, not the
core capability. The moment `validate_stat` returned `true` on-chain for a real
World Cup result, it was obvious this is the missing settlement layer for live
sports markets. We'd happily build the player-level roadmap on it the day the
signed data exists.
