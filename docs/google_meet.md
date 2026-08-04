# Pushing the AR clickable overlay into Google Meet

Question: can the Onside clickable-player / offside-line / VAR-moment overlay
show up inside a Google Meet call — either for the presenter, or, ideally,
with every participant getting their own clickable buttons?

Three real paths, in order of effort. None are built yet — this is the
research/decision doc; nothing here has been implemented.

---

## A — Baked-in screen share (zero new code, works today)

The presenter runs the Onside extension on the actual match site
(ceskatelevize.cz / nova.cz / tipsport.cz / etc.) with 🎯 tracking, 🚩 offside
line, and the StreamBoard all rendered as normal DOM on that page. They then
screen-share **that specific tab** (not the full desktop) into the Meet call.

Chrome's tab-capture (`getDisplayMedia`) grabs the tab's *rendered pixels*,
so whatever the extension draws is already composited into what remote
participants see — no Meet-specific engineering at all.

**Tradeoff:** it's presenter-only. Remote participants watch a video; they
can't click a player, drag the offside line, or place their own prediction —
only the person sharing the tab can interact.

## B — Watch-party via a shared broadcast (moderate effort, real per-user interactivity)

Meet stays a plain voice/video call, running alongside the match site in a
separate tab. Every participant runs the Onside extension on their **own**
machine, watching the same match independently — but instead of each
person's `AdminVarEventSource` staying purely local (as it is today), it
publishes to a small relay server, and every viewer's extension subscribes
to that same feed instead of instantiating its own local source.

This reuses the exact architecture already built for VAR-moment markets
(`packages/var-events` — see `docs/var-referee-feature.md`):
`VarEventSource` is already a pluggable interface (`ReplayVarEventSource`,
`AdminVarEventSource`, stub `TxlineVarEventSource`). Adding a
`RelayVarEventSource` that reads from a WebSocket instead of local method
calls is a natural fourth implementation — nothing in `VarMarketController`
or `VarMarketSession` needs to change.

**Tradeoff:** needs a small always-on relay service (not built yet). Real
per-user interactivity, though — every viewer clicks/drags/bets on their own
copy, all settling against the same broadcast state.

The core goal/corner/card markets don't need this at all — they already
settle from TxLINE's Merkle-proof data + the on-chain Anchor program, so any
viewer's extension reads the same on-chain state regardless of what page
they're watching from. Only the VAR-moment (replay/admin) feature is
currently single-browser-local and would need the relay.

## C — Native Meet Add-on (highest effort, the "proper" integration)

Google's [Meet Add-ons SDK](https://developers.google.com/workspace/meet/add-ons/guides/overview)
(GA since [September 2024](https://workspaceupdates.googleblog.com/2024/09/google-meet-add-ons-sdk-is-now-available.html))
lets a hosted web app become part of the meeting UI in one of two places:

- **Main Stage** — the add-on becomes the shared focal point for *every*
  participant simultaneously (its own page, e.g. `mainStage.html`, calling
  `createAddonSession`).
- **Side Panel** — a `MeetSidePanelClient` instance shown alongside the video
  grid, for lighter-weight collaborative widgets.

For syncing state across participants, Google provides:
- [`ActivityStartingState`](https://developers.google.com/workspace/meet/add-ons/reference/websdk/addon_sdk.activitystartingstate) /
  `startActivity()` — initial state shared with anyone who joins the
  activity, updatable via `setActivityStartingState()`.
- The [Co-Doing API](https://developers.google.com/workspace/meet/add-ons/guides/use-CoDoingAPI) —
  built for exactly this: synchronizing arbitrary app data across meeting
  participants in real time.

**Tradeoff:** this is a genuinely separate engineering track, not an
extension. It means building and hosting a standalone web app, registering
it as a Google Workspace add-on (Google Cloud Console / Workspace
Marketplace), and — importantly — Main Stage/Side Panel are iframed content,
not screen-capture composition, so you'd still need to bring the match video
in some other way (embed the stream, or just render clock/market state and
let people watch the match itself in a separate window).

---

## Recommendation

Start with **A** if the near-term need is just demoing/watching together —
it costs nothing and works today. **B** is the natural next build: it's
mostly the relay server, since the client-side plumbing (`VarEventSource`,
`VarMarketController`, `VarMarketSession`) already exists and is
platform-agnostic by design. **C** is worth keeping in mind as the eventual
"real" Meet integration, but it's a separate project (new app, new hosting,
Marketplace registration) — not a next step off the current branch.

## Sources
- [Meet add-ons SDK for Web overview](https://developers.google.com/workspace/meet/add-ons/guides/overview)
- [Meet add-ons quickstart](https://developers.google.com/workspace/meet/add-ons/guides/quickstart)
- [Google Meet Add-ons SDK is now generally available](https://workspaceupdates.googleblog.com/2024/09/google-meet-add-ons-sdk-is-now-available.html)
- [Collaborate using a Meet add-on](https://developers.google.com/workspace/meet/add-ons/guides/collaborate-in-the-add-on)
- [Implement the Co-Doing API](https://developers.google.com/workspace/meet/add-ons/guides/use-CoDoingAPI)
- [`ActivityStartingState` reference](https://developers.google.com/workspace/meet/add-ons/reference/websdk/addon_sdk.activitystartingstate)
