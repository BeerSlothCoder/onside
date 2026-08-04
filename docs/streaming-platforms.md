# Streaming a match on pump.fun / Twitch / Kick — us clicking, viewers clicking too

Question: if we stream a match on pump.fun, Twitch, or Kick, can we (the
streamer) click our own buttons, but *also* have each person watching get
their own independent clickable buttons and place their own bets over our
stream?

**Short answer: the viewer side is not a new integration — it's exactly what
the Onside extension already does.** The real open questions are (1) whether
each platform's video is even readable for local CV, (2) how to sync the
VAR-moment feature across many independent viewers, and (3) each platform's
gambling-content policy. Nothing here is implemented — this is the
research/decision doc.

---

## Why this "just works" on the viewer side

The extension anchors to *any* `<video>` element on *any* page —
`extension/src/tracking/geometry.ts` (`anchorRect`/`contentRect`) has no
notion of which site it's running on, and `useDetector`/`useTracking` run
in-browser YOLO detection against whatever `<video>` it finds. That's the
same mechanism already working on ceskatelevize.cz, nova.cz, tipsport.cz,
and YouTube (see the `onside-stream-capabilities` memory). Watching a match
on twitch.tv, kick.com, or pump.fun in a browser tab means there's a
`<video>` element there too — the extension doesn't need to know or care
that it's a Twitch stream instead of a broadcaster's own site.

So: **any viewer who installs the extension and watches the stream on the
platform's own page already gets their own independent clickable overlay,
today, with no new engineering** — same as any other supported stream.

## Two distinct roles

1. **Us clicking our own buttons, captured into the outgoing stream** — this
   is the same as Google Meet's Path A (`docs/google_meet.md`): run the
   extension on the actual source feed (an OBS browser source, or the tab
   being captured), and the overlay is baked into the pixels that go out.
   Works for the streamer only.
2. **Each viewer getting their own buttons** — every viewer runs the
   extension themselves while watching on the platform's page. No platform
   integration needed; this is the extension's existing, general-purpose
   design.

## Does it actually work per-platform? (canvas readability)

Local YOLO detection needs the video frames to be readable
(`extension/src/tracking/types.ts` — `ReadbackResult`: `ok` / `black`
(DRM) / `tainted` (cross-origin) / `embedded` (cross-origin iframe) /
`novideo`). If frames aren't readable, the extension already degrades
gracefully to pins-only manual tagging — no crash, no dead feature, exactly
the same fallback already used for Tipsport's iframe today.

What research turned up per platform (treat as a starting point, not a
guarantee — the extension's own probe will report the real answer live the
moment it's tested on each site):

- **Twitch** — mainstream public channels are generally not DRM-locked, but
  Twitch does use Widevine DRM for at least some content (support docs
  reference Widevine issues specifically on subscriber-only / HEVC-tier
  video). Likely `ok` on typical public streams; needs a per-stream check.
- **Kick** — HLS-based, similar tier to Twitch's public streams. No DRM
  signal turned up in research. Likely `ok`, same caveat.
- **pump.fun** — livestreams are creator-broadcast via RTMP/OBS or in-browser
  capture (`blog.livereacting.com`, `pchojecki.medium.com`), not licensed
  premium content — no indication of DRM. Most likely to be `ok`.

None of this needs a research project to resolve — load the extension, open
each site, and read what `probe` says. That's the whole point of the
existing readback check.

## The real engineering delta: syncing bets across many independent viewers

The **core goal/corner/card markets need nothing new here.** They settle
from TxLINE's oracle-backed Merkle-proof data against the on-chain Anchor
program — any viewer's extension reads the same on-chain state no matter
what page they're watching from. Twitch vs. Kick vs. pump.fun vs. nova.cz
makes zero difference; this already works today.

The **VAR-moment feature** (`packages/var-events`, see
`docs/var-referee-feature.md`) is currently local to one browser tab —
`AdminVarEventSource` has no way to reach anyone else's extension. To have
every viewer across Twitch/Kick/pump.fun see the same admin-triggered
review and resolution, the fix is the same one described for Google Meet
Path B: a small relay service `AdminVarEventSource` publishes to, plus a new
`RelayVarEventSource` implementing the existing `VarEventSource` interface
that viewers' extensions subscribe to instead of a local source. Build once,
works identically regardless of which platform the viewer is on — the
relay is page-agnostic.

## Real money for viewers — how betting actually gets paid, per platform

The betting mechanism itself doesn't change per platform: it's the same
wallet-connect + on-chain USDC vault the extension already uses on
nova.cz/tipsport.cz today (`programs/onside/src/lib.rs` — `place_bet`
transfers from the bettor's token account into the market's vault; `claim`
pays out from it). What's genuinely platform-specific is *how a viewer's
click reaches that flow at all* — same install-friction problem as Google
Meet, with one extra wrinkle on pump.fun.

**Twitch — there's a better path than our Chrome extension.** Twitch has a
native [Extensions](https://dev.twitch.tv/docs/extensions/) framework with a
**Video Overlay Extension** type — a transparent layer rendered on top of
the video for *every* viewer on the channel automatically, once the
broadcaster installs it, with zero install required on the viewer's end
(built/tested via Twitch's [Developer Rig](https://github.com/twitchdev/extension-getting-started)).
This is the same category of "native, no-viewer-install" integration as the
Meet Add-ons SDK — worth building as a real Twitch Extension rather than
leaning on our browser extension for Twitch specifically, since it removes
the single biggest adoption blocker (every viewer having to find and install
a Chrome extension first). Caveat: Extensions run in a Twitch-sandboxed
iframe with their own review/approval process and their own monetization
primitives (Bits, etc.) — wiring a Solana wallet + real-money betting inside
that sandbox needs its own check against Twitch's extension review policy,
on top of the gambling-content policy flagged below.

**Kick — no equivalent found.** Research turned up a general developer
platform ([dev.kick.com](https://dev.kick.com/) / docs.kick.com) — OAuth,
webhooks, chat/channel events — but nothing resembling a native video-overlay
extension SDK. So on Kick, our Chrome extension (each viewer installs it
themselves) is, as far as this research found, the *only* current path to
viewer-side buttons. Tip: since there's no native distribution channel here,
lean on the streamer's own channel panel/links to drive viewers to install
the extension directly, rather than expecting a platform-native integration.

**pump.fun — the coin idea, and what it actually takes on our end.** Every
pump.fun livestream is tied to one specific SPL token (that's the platform's
whole model — the stream promotes a coin). The idea: let bettors stake
*that stream's own coin* instead of USDC, so betting activity generates
real on-chain volume for the coin the stream is already about — which lines
up with pump.fun's actual revenue model (token trading, not ads/donations,
per the Pumpcade research below).

Checked this against our own program rather than assuming it's trivial:
`place_bet` is already mint-agnostic — it just matches whatever
`vault.mint` the market was created with
([lib.rs:490](../programs/onside/src/lib.rs)). But `create_market` currently
**hard-codes** the stake mint:

```rust
/// CHECK: constrained to the fixed devnet USDC mint.
#[account(address = USDC_MINT_DEVNET)]
pub usdc_mint: UncheckedAccount<'info>,
```

So today, every market must use that one fixed USDC mint. Supporting a
per-stream pump.fun coin as stake is a **small, scoped on-chain change** —
drop that `address = USDC_MINT_DEVNET` constraint so `create_market` accepts
any SPL mint account — not a rewrite, since the vault/transfer/settlement
logic downstream already just follows `vault.mint`. It's still a real
program change needing redeploy + security review, though, not a config
flag:

- Payout math would need to read the mint's actual `decimals` instead of
  assuming USDC's 6 (a memecoin's decimals aren't guaranteed to match).
- Needs confirming the specific coin is a standard SPL Token-program mint —
  our program's transfers use the legacy `anchor_spl::token::Transfer` CPI,
  which doesn't handle Token-2022 extensions (transfer fees, etc.) as-is.
  Standard pump.fun bonding-curve coins are typically plain SPL Token
  mints, but this should be confirmed per-coin, not assumed.
- Product-level, not just technical: staking a volatile bonding-curve coin
  (instead of a stablecoin) means bet size and payout value swing with the
  coin's price during the match itself — worth deciding deliberately (do
  winnings pay out in the same coin at settlement, is that the fun part or
  does it undermine trust in the market) rather than treating it as a pure
  wiring change.

## Important: pump.fun already has a native competitor here

pump.fun itself just led a **$1M pre-seed round into Pumpcade** — a
livestream prediction-market product built natively into pump.fun, not a
third-party extension. Pumpcade supports one-click market creation embedded
directly in livestreams, resolving in minutes via "official APIs and
deterministic data sources... no human arbiters, no traditional oracles" —
notably similar framing to Onside's own oracle-settled (no-human-in-the-loop)
design philosophy for goal/corner/card markets.

**What this means:** on pump.fun specifically, an extension-based overlay
would be layered on top of a platform that's actively backing (and
promoting) its own first-party version of this exact idea. Worth deciding
whether that's a partnership angle (Pumpcade resolving *football* markets
via Onside's TxLINE pipeline) or a reason to prioritize Twitch/Kick instead,
where no equivalent native feature exists.

## Platform policy — flag, not a green light

- **Twitch** actively enforces a gambling-content policy, refreshed with
  detailed enforcement notes as of January 2026. Direct promotion of many
  gambling categories (notably skins gambling) is banned; sports betting,
  fantasy, and poker content are currently treated more permissively, but
  Twitch's own "Channel Points Predictions" mechanic is already under
  regulatory scrutiny as a prediction-market gray area. Real-money/crypto
  betting via a third-party extension overlaid on a Twitch stream needs a
  real compliance read (Twitch's current Community Guidelines + gambling
  policy) before going live publicly — this is not something to infer from
  the above summary.
- **Kick** was founded by the co-founders of crypto-gambling platform
  Stake.com (same parent company, Easygo Entertainment) and launched with
  permissive content policies generally — but Kick has since tightened rules
  specifically around *promoting real-money gambling*: streamers can't say
  things like "click my link to bet real money" without holding a valid
  gambling license, and some creators have publicly argued the changes
  favor Stake's own product over competitors. So "permissive" is not the
  same as "no rules" — check Kick's current gambling broadcast rules before
  assuming it's the easy option.
- **pump.fun** paused its livestream feature entirely for five months in
  2024 after moderation incidents, and relaunched it with stricter
  moderation and human review — no specific gambling-content policy turned
  up in research, but given that history and the Pumpcade backing above,
  check directly with pump.fun before launching a competing betting overlay
  there.

None of the above is legal advice — it's a starting point for a real
compliance check (per platform, per jurisdiction, per token/currency used)
before any public launch.

## Recommendation

Technically, the viewer-side overlay is close to free on Kick and pump.fun —
same extension, unmodified, tested against each platform's `<video>`
element. On Twitch specifically, build a real Video Overlay Extension
instead of relying on the Chrome extension: it removes the install-friction
problem entirely and is the closer analog to what a native, low-friction
rollout should look like. The remaining new work: (1) the relay for syncing
VAR-moment state across independent viewers (shared with the Google Meet
Path B build), (2) if the pump.fun-coin idea is worth pursuing, the scoped
`create_market` mint change above plus the product decision on volatile
payouts, and (3) a compliance pass per platform before going public —
Twitch's is the strictest and most actively enforced, Kick's is nuanced
(Stake-linked, tightening around real-money promotion), and pump.fun's is
unclear but has a recent moderation-incident history plus a funded native
competitor already in the space.

## Sources
- [What Is Pumpcade? The Livestream Prediction Market Built on Pump.fun](https://www.kucoin.com/blog/what-is-pumpcade-the-livestream-prediction-market-built-on-pumpfun-explained)
- [Pump.fun leads $1M pre-seed round into Pumpcade](https://www.theblock.co/post/396213/pump-fun-pre-seed-funding-round-livestream-prediction-markets-pumpcade)
- [How to Stream on Pump.fun](https://blog.livereacting.com/how-to-stream-on-pump-fun/)
- [Pumpfun fully restores streaming feature with stricter moderation policy](https://cryptoslate.com/pumpfun-fully-restores-streaming-feature-with-stricter-moderation-policy/)
- [Twitch clarifies gambling rules with detailed enforcement notes (Jan 2026)](https://tribuna.com/en/casino/news/2026-01-08-twitch-clarifies-gambling-rules-with-detailed-enforcement-notes-specifying-skin-betting-r/)
- [Twitch Introduces Betting Advertisements in the United States](https://www.igamingtoday.com/twitch-introduces-betting-advertisements-in-the-united-states-marking-a-shift-in-its-gambling-policy/)
- [Twitch's gamification of prediction markets puts youth at risk](https://www.compliancecorylated.com/news/twitch%CA%BCs-gamification-of-prediction-markets-puts-youth-at-risk/)
- [Who Owns Kick.com? Everything To Know About Stake And Kick](https://www.streamscheme.com/who-owns-kick-streaming/)
- [Kick changes gambling policy as they clamp down on harmful content](https://www.dexerto.com/kick/kick-changes-gambling-policy-as-platform-clamps-down-on-harmful-content-2991333/)
- [Kick Introduces New Gambling Broadcast Rules — Audience Protection or Stake Business?](https://igamingexpress.com/kick-introduces-new-gambling-broadcast-rules-audience-protection-or-stake-business/)
- [Twitch Extensions overview](https://dev.twitch.tv/docs/extensions/)
- [Twitch Extensions getting-started (video overlay type)](https://github.com/twitchdev/extension-getting-started)
- [Kick Dev — developer platform](https://dev.kick.com/)
