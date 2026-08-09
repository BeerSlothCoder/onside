# Pushing the AR clickable overlay into Google Meet

Question: can the Onside clickable-player / offside-line / VAR-moment overlay
show up inside a Google Meet call — either for the presenter, or, ideally,
with every participant getting their own clickable buttons?

Three real paths, in order of effort.

## Status

- ✅ **Built**: the extension now loads on `meet.google.com`
  (`extension/public/manifest.json` — added to `host_permissions`,
  `content_scripts.matches`, and `web_accessible_resources.matches`). No
  other code changed — `findMainVideo()`/`findAnchor()`
  (`extension/src/tracking/videoFinder.ts`) already scored *any* `<video>`
  element on the page generically (by visible area × playing-state ×
  readyState), so it needed zero Meet-specific logic. This is stronger than
  Path A below: **every Meet participant who has the extension installed
  gets their own independent 🎯/🚩/StreamBoard overlay** on whatever video
  tile scores highest — not just the presenter.
- ❌ **Not built**: the Path B relay (below) — VAR-moment triggers/
  resolutions from `var-admin.html` still don't reach anyone else's browser,
  Meet or otherwise.
- ❌ **Not built**: the Path C native Meet Add-on — a separate hosted app,
  not started.

**What still needs a live check (couldn't be verified from this
environment):** which video tile actually scores highest in a real Meet
call, and whether Meet's WebRTC `<video>` tiles read as `ok` (not `tainted`)
in the extension's canvas-readback probe. Recommend testing this alongside
the VAR feature tomorrow — join a call, screen-share (or have someone else
share) a match, **pin/maximize that tile** so it's unambiguously the largest
video on screen, then open the extension and check the probe badge. Nothing
auto-activates — 🎯/🚩 stay off until a participant clicks them, so there's
no risk of the tracker running against someone's webcam in an ordinary
meeting.

---

## A — Baked-in screen share (zero new code, works today, presenter-only)

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

The client-side prerequisite for **B** is now done — the extension works on
`meet.google.com` today, so any participant with it installed already gets
their own independent overlay on a shared match feed, and the core
goal/corner/card markets are already fully synced across them (same
on-chain state regardless of platform). What's left of **B** is purely the
relay server, so that VAR-moment triggers/resolutions reach every
participant instead of staying local to whoever's running `var-admin.html`
— that's the next real build if synced VAR markets across a Meet call
matters. **A** still stands as the zero-effort fallback for a
presenter-only demo. **C** is worth keeping in mind as the eventual "real,"
natively-embedded Meet integration, but it's a separate project (new
hosted app, new registration) — not a next step off the current branch.

## Sources
- [Meet add-ons SDK for Web overview](https://developers.google.com/workspace/meet/add-ons/guides/overview)
- [Meet add-ons quickstart](https://developers.google.com/workspace/meet/add-ons/guides/quickstart)
- [Google Meet Add-ons SDK is now generally available](https://workspaceupdates.googleblog.com/2024/09/google-meet-add-ons-sdk-is-now-available.html)
- [Collaborate using a Meet add-on](https://developers.google.com/workspace/meet/add-ons/guides/collaborate-in-the-add-on)
- [Implement the Co-Doing API](https://developers.google.com/workspace/meet/add-ons/guides/use-CoDoingAPI)
- [`ActivityStartingState` reference](https://developers.google.com/workspace/meet/add-ons/reference/websdk/addon_sdk.activitystartingstate)
