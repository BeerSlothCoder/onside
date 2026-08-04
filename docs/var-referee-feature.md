# VAR-moment markets + offside-line tool

Branch: `var-moment-replay`, sitting on top of `clickable-players` (the branch
with the real TxLINE integration — crank, `@onside/txline-client`, the Anchor
program, the live extension overlay). No commit history has diverged yet —
`var-moment-replay` is `clickable-players` @ `268a103` plus this feature,
currently uncommitted.

**What this is:** goal / red-card / penalty review markets, fed by a
two-phase report — a *trigger* ("VAR just entered the game, here's the
situation") and, later, a *resolution* ("VAR just announced its decision, at
this exact match timestamp") — plus a **draggable offside line** to help call
it yourself before the real decision lands. Two sources feed it today:

- **Replay** — a scripted JSON file of an already-finished match, played back
  on a timeline.
- **Admin** — a human (you) watching any match by hand, reporting the same
  trigger/resolution shape live. This stands in for TxODDS/oracle access we
  don't have yet for non-World-Cup competitions (see
  `Submission/txline_api_experience.md`).

Nothing in the market logic or UI knows or cares which one is talking to it —
that's what makes the admin tool a faithful rehearsal for the day a real
`TxlineVarEventSource` exists.

**Honesty framing, kept visible throughout:** every screen carries a
persistent badge ("REPLAY — recorded match" / "ADMIN — reported live") and
settles against a *reported* decision, not oracle-free proof — this is a
distinct market type from the Merkle-proof-settled goal/corner/card markets,
and it spends a separate demo ledger, never real on-chain USDC.

**Offside-line limitation, also stated plainly:** the line is a straight
*vertical* line in video-normalized coordinates, draggable left/right only.
This repo has no pitch-corner/camera-calibration pipeline (the tracker only
gives raw video-pixel player boxes), so a vertical line is the honest cheap
approximation of a real offside line — correct only when the camera has
negligible tilt. It's labelled "approx" in the UI. See the doc comment at the
top of `extension/src/tracking/ui/OffsideLineOverlay.tsx`.

---

## Where the code lives

| Piece | Path |
|---|---|
| Data model, sources, market state machine, session wiring, demo ledger | `packages/var-events/src/` (`@onside/var-events`) |
| Sample scripted match | `packages/var-events/sample-events/france-england-var-events.json` (fixture 18257865) |
| Live-stream overlay (bet UI) | `extension/src/overlay/VarMomentOverlay.tsx` |
| Offside-line tool | `extension/src/tracking/ui/OffsideLineOverlay.tsx` |
| Always-on 🚩 toggle in the real extension | `extension/src/overlay/Overlay.tsx` |
| Standalone replay demo | `viewer/var-replay.html` / `viewer/src/var-replay.tsx` |
| Standalone admin tool | `viewer/var-admin.html` / `viewer/src/var-admin.tsx` |
| Repeatable functional check | `packages/var-events/scripts/smoke-test.ts` |

---

## Build & load

```bash
cd onside
npm install                      # links the @onside/var-events workspace package
npm run build -w viewer          # → viewer/dist/{index,var-replay,var-admin}.html
npm run build -w extension       # → extension/dist (unpacked MV3 extension)
```

**Extension:** `chrome://extensions` → enable *Developer mode* → **Load
unpacked** → select `onside/extension/dist`. This gets you the 🚩 offside-line
toggle live on a real stream (ceskatelevize.cz / nova.cz / tipsport.cz /
YouTube). The VAR-moment betting UI itself is **not** wired into the live
extension yet — only the two standalone viewer pages below have it.

**Viewer pages:** open the built HTML files directly, or `npm run dev -w
viewer` and visit `/var-replay.html` / `/var-admin.html`.

---

## Full flow: admin (`var-admin.html`)

1. **Match** — free text, e.g. `Czech Fortuna Liga: Slavia vs Sparta` (no
   TxLINE coverage needed — this is exactly the point).
2. **"1 · VAR entered the game"** — pick the VAR type (Goal / Red card /
   Penalty review), a one-line situation ("Offside check on the goal"), and
   the match clock you see on the broadcast (e.g. `71:32`). Click **Trigger
   VAR**.
   - The outcome is *not* asked for here — it isn't known yet. The market
     opens instantly in the "what viewers see" preview pane.
   - Triggering a `GOAL_REVIEW` auto-opens the 🚩 offside line in that
     preview so you can drag it onto the last defender before you know the
     real call.
3. It appears under **"2 · Awaiting resolution."** Watch the broadcast; once
   VAR actually rules, fill in the **real outcome** and the **exact match
   clock the decision was announced** (e.g. `73:05`), click **Resolve**.
   - The preview settles immediately: decision revealed, any prediction
     placed there wins/loses, demo balance updates.
4. Resolved reviews collect under **"Resolved this session."** **Export as
   VarEvent[] JSON** turns the session into a ready-to-save block for
   `packages/var-events/sample-events/` — a real match you watched by hand
   becomes a new scripted replay.

## Full flow: simulated game (`var-replay.html`)

1. Loads with the France–England fixture queued, running match clock in the
   corner. Default speed 12× (`?speed=1` for real-time pacing).
2. At `23:41` (scripted), a **GOAL_REVIEW** market appears top-left: context,
   two outcome buttons, a live countdown. The 🚩 offside line auto-opens at
   the same moment — drag it to the last defender and make your own call.
3. Click an outcome + stake (10/25/50/100) to predict. Window closes → state
   flips to **LOCKED** ("REVIEWING…") → **RESOLVED**, the real recorded
   decision is revealed, your bet is marked won/lost, balance updates.
4. Three more scripted moments follow (red card, penalty, second goal
   review) at the same pace; each drops into the "earlier" history strip once
   resolved.
5. Balance persists in `localStorage` across reloads (the replay itself
   restarts from `23:41` on refresh).

---

## Testing

### Automated (repeatable)

```bash
npm run typecheck -w packages/var-events
npm run typecheck -w extension
npm run typecheck -w viewer
npm run build -w viewer            # both viewer pages bundle cleanly
npm run build -w extension         # popup.js + content.js bundle cleanly
npm run smoke -w packages/var-events
```

`smoke-test.ts` exercises both sources end to end against real assertions —
run it after any change to `packages/var-events/src/`:

- **Replay path** — plays the France–England sample file at 300× speed,
  auto-predicts the first outcome option on every market, and asserts all 4
  scripted events resolve and export back out as valid `VarEvent[]` JSON
  (round-trip check: what `toVarEvents()` produces must be re-playable).
- **Admin path** — asserts, in order: (1) the market is OPEN with the
  outcome genuinely undetermined right after `triggerVar()`, before
  `resolveVar()` is ever called; (2) a prediction placed in that OPEN window
  is accepted; (3) after `resolveVar(triggerId, "PENALTY_AWARDED", "73:05")`,
  the market's `resolvedOutcome` matches and `resolvedTimestamp` ("73:05") is
  distinct from `trigger.timestamp` ("71:32") — proving trigger-time and
  resolution-time are never conflated; (4) the winning stake pays out at the
  correct fixed odds (1.9×) through the demo ledger.

Current output: `SMOKE TEST OK` — all 10 checks pass.

### Manual — offside-line tool

1. Extension: load a supported stream, click 🚩 — line appears mid-frame,
   drag it left/right; confirm it never rotates and stays clamped to the
   video's edges (can't be dragged off-picture) even during fullscreen /
   theater-mode resize.
2. Toggle 🎯 tracking on with 🚩 also on — confirm a moving player box under
   the line doesn't steal the drag (the wide invisible rail should still
   grab the pointer).
3. `var-replay.html`: reach `23:41` (or `?speed=1` and wait) and confirm the
   line **auto-opens** exactly when the GOAL_REVIEW market appears, and that
   manually closing it (✕) doesn't get force-reopened until the *next*
   GOAL_REVIEW.
4. `var-admin.html`: trigger a `GOAL_REVIEW` → confirm the line auto-opens in
   the preview pane only (not in the admin form column). Resolve it →
   confirm the line stays as you left it (dismissal doesn't get undone by
   resolution).

### Manual — admin ↔ preview consistency

1. In `var-admin.html`, trigger a review, place no predictions.
2. Resolve it with an outcome.
3. Confirm the **preview pane** (a second, independent `VarMarketSession`
   subscribed to the same `AdminVarEventSource`) shows the identical
   resolved outcome and timestamp — this checks that resolution really does
   broadcast to every subscriber, not just the admin's own session (the two
   sessions never touch each other's controllers directly; only the shared
   `AdminVarEventSource` connects them).

### Known gaps / not covered by this pass

- No automated UI/browser test (Playwright etc.) — everything above is
  manual for the React components; only the headless `@onside/var-events`
  logic has a repeatable script.
- Offside line has no perspective correction — see the limitation note
  above. Fine for a head-on tactical camera, visibly wrong on an angled
  broadcast camera close to a corner flag.
- `TxlineVarEventSource` is a documented stub (throws on `subscribe()`) —
  wiring a real feed needs (1) TxLINE tier upgrade past World Cup/Friendlies
  and (2) TxODDS exposing a VAR-review signal, neither of which exists today.
