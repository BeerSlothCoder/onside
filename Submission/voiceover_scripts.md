# Onside — Voiceover scripts (casual, for TTS)

Play the audio, click the demo along to it. Pure spoken text — no stage
directions. Casual, first person, slightly imperfect on purpose.

---

## PART 1 — voiceover (~90s)

hi , my name is peter, let me show you our Onside project.
Prediction markets, played live.
In-play sports markets that settle themselves — on-chain, from signed data by TxOdds.

Okay so... this is a live World Cup match right now — England against France.in our simulation where we can bet pre match on outcome, corners and goals .also in-game betting on next goalscorer . 

But we taking it further.We want real stream with real players as the canvas for the users .here it is.

So again, france england game . 
And look — all these betting buttons? They're sitting right on top of the
stream. I never leave the game. That's Onside.

So basically, we take any football stream and turn it into a live betting market.
And the whole idea is — you don't bet before the match on boring, stale odds. You
bet on the moment, while it's actually happening. Match winner, total goals,
corners for each team... it's all right here, on the video.

And these odds — they're real. Straight from txODDS, live. And see the players
down the sides? Every single one of them has odds too — like, will he score.
That's coming from the odds feed as well.

Let me open it up... there we go — the lineups. England on this side, France on
that side, the real starting elevens loaded in. And every button you see is a
real market, on-chain, in USDC.

So if I want to back England — I just tap, pick my stake, confirm. Without missing
a single second of the game. Alright — let me actually show you how the betting
works, up close.
---

## PART 2 — voiceover (~120s)

So here's the part that nobody else has. I can bet on the players themselves —
by literally tapping them on the pitch. Watch this.

I turn on tracking... and boom — it finds all the players and follows them around.
And this is running right in the browser. No server, nothing. It's just... watching
the video.

Now I click on this guy — I pick him from the lineup — and see? His name sticks to
him. Messi, number ten, and the tag just rides along as he moves around the pitch.

Okay and now the fun part — I tag him as my next goalscorer. And he lights up
green. That's my pick. Now — I'll be honest with you — the next-scorer bet, that
one's our roadmap. We need player-level data from txODDS for that to settle. But
this is the direction. Tap the player, bet on the player.

Okay, let me place some real bets now. Match result — I'll take England. Five
bucks. Confirm. Done — you see my balance go down, and my position pops up here.

Now corners — England, over. Confirm that too.

And if I go fullscreen... look, there's even more. In-play stuff — next shot on
target, goal in the next ten minutes, next corner. All the little moments during
the game. Oh, and this button here — change sides — at half time the teams switch
ends, so I just flip it and everything lines up again.

So yeah — match result, corners, total goals, all real on-chain bets. And every
one of them settles itself. No bookmaker. Let me show you that part — me actually
getting paid.

---

## PART 3 — voiceover (~90s)

Okay, this is the best part. So earlier I bet on Spain to win, and on Spain corners
over — and both of them hit. So watch — I just click claim... and the money goes
straight to my wallet. USDC. See the balance jump? No bookmaker, no waiting three
days, no support ticket.

Now — why can I trust this? Let me show you. This is our viewer page. I find the
settled match, I click verify... and here — this is the actual transaction, on
Solana. The program checks a txODDS Merkle proof against the match data that txODDS
anchors on-chain. So the result is proven. There's no human deciding who won.
Anyone can settle it, and nobody can settle it wrong. The signed data is the
referee.

And where we're going — you saw me tag the players, the next-scorer, the in-play
stuff — all of that becomes real on-chain markets the moment txODDS gives us that
player-level signed data. And the hard part — the tracking, the tap-to-bet — it's
already built.

So... that's Onside. Prediction markets, played live, settled on Solana from
signed data. We built it on txODDS TxLINE for the World Cup. I'm a former pro
player, I spent years in sports data at Sportradar — and honestly, I think this is
the next big thing for live sports betting. Thanks for watching.

---

## Turning these into audio

**Best pick — ElevenLabs** (elevenlabs.io): the most natural, casual, human voice.
- Free tier (~10k characters/month) covers all three of these.
- Paste one part, pick a conversational voice (e.g. "Adam"/"Josh" or a custom one),
  and **turn Stability down (~30–40%)** — that makes it looser and more "imperfect",
  less robotic. Bump "Style" a little for energy.
- Export each part as its own MP3, drop under each video segment.

**Alternatives:** Play.ht, Murf, Speechify, WellSaid — all similar, free tiers vary.

**Most authentic option:** record it in **your own voice** reading these lines —
the judges' notes literally say "human, imperfectly voicing his own video." Your
real voice + these words beats any TTS. Read it once, don't over-rehearse.

**Quick + free:** on Mac, `say -v Daniel -f part1.txt -o part1.aiff`; in the
browser, the built-in Speech Synthesis — but both sound robotic; only for timing.
