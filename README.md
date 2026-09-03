# TrueHumanNature

An attraction-based matchmaking and self-perception app inspired by
[studyofus.com](https://studyofus.com) — *self discovery, through the eyes of
others, with lots of data.*

You create an account, submit a photo, and answer a battery of political / sexual /
personality questions plus demographics. Strangers then compare your photo against
others and pick who's more attractive. From those choices TrueHumanNature builds:

- **How people see your photo** — an Elo attractiveness rating shown as a
  confidence **band** ("chosen more than 89–95% of photos") that narrows as more
  matchups come in, with a live pairs-collected progress bar.
- **What strangers guess about your photo** — per-game consensus (Bodycount, Net
  worth, Politics, Dominance, Gooner Nature), each **revealed for credits**.
- **Who Likes You?** — a full demographic report on the people who pick your photo
  (politics/beliefs, overrepresented mental-health diagnoses among your fans,
  gender/age/personality lean), **unlocked for credits**.
- **Your type** — learned from *the photos you choose*: gender you're drawn to,
  older/younger age lean, mental-health openness, and political/personality traits.
- **Your Human Nature score** — from a separate **36-question morality quiz**
  (Greed, Betrayal, Cruelty, Deceit, Apathy, Depravity). Every answer scores
  −2…+2, so the total runs −72…+72, and each one comes back with what everyone
  else said: *"61% of people gave the same answer."* The report turns it into a
  verdict — **Sanctimonious / Decent / Compromised / Rotten / Irredeemable** —
  a per-vice breakdown, and where you rank against everyone who's taken it.
- **Matches** — a match takes four things: you both took the morality quiz, you
  each rated the other over other people, you each picked the other **at least
  3 times**, and your Human Nature scores land **within 25 points**. On a match,
  you each see the other's **socials** (Instagram, etc.) so you can reach out.

Socials stay private until you match. Photos are shown only inside the rating
games; questionnaire answers are never shown to anyone.

## Photos: review and storage

**Nothing is auto-approved.** Every photo sits `pending` until an account listed
in `ADMIN_EMAILS` approves it in the **Review** tab — no classifier can publish
one on its own. Automated screening only ever *rejects* (a declared age under 18
is refused outright) or *flags for a human*.

Stored photos never touch `users.json`. On upload each image is re-encoded by
`sharp`, which destroys **EXIF — including the GPS coordinates a phone photo
carries** — then encrypted with AES-256-GCM under a key derived from `PHOTO_KEY`
and written to `$DATA_DIR/photos/`. They're served only through
`/photos/:id?t=…`, where the token is an HMAC over (photo id, viewer's account
id, expiry) valid for ten minutes: a photo link that leaks is dead on arrival
and never worked in anyone else's session. Rejecting a photo deletes the bytes.

The honest limits are written down in [DEPLOY.md](DEPLOY.md) — an admin sees
every photo, a logged-in user can screenshot their screen, and encryption at
rest protects stolen disks and backups rather than a compromised running
server.

## Credits

Credits are deliberately **hard to earn** — you get them by rating other people
(1 credit per **50** votes) and by playing guessing rounds (**3 of 5 → 2 credits**).
New **taste traits** unlock every 75 people you rate.
Each game opens with "the same question about you" — your private self-answer that
feeds the aggregate — before you guess about others:

| Spend | Cost | What you get |
|-------|-----:|--------------|
| Reveal a trait guess | 30✦ | what strangers guessed about you on that game |
| Buy more pairs | 75✦ | +200 prioritized matchup appearances (more data, faster) |
| Unlock "Who Likes You?" | 300✦ | the full demographic report on your fans |

…or **buy** credits outright on the Buy Credits page: $15→100✦, $40→300✦
(most popular), $100→1,000✦. The checkout is a **demo** — it grants credits
without taking payment; wire a real processor (Stripe, etc.) for live billing.

## Run

```bash
npm install
npm run seed       # demo profiles + matchups + a demo login (see below)
npm start          # http://localhost:3000  — open in a browser
npm test           # engine + auth + server tests
```

The UI is responsive: a mobile layout on phones and a wider **desktop layout**
(two-column home, large VS rating pair, floating nav dock, a live "Your type"
panel and personal ranking grid under the rating pair) on computer screens.

`npm run seed` also creates a ready-to-explore login: **demo@truehumannature.com /
hunter2** (already rated, with credits and revealable data).

## Accounts

- **Email + password** — create an account or log in. Works with zero setup
  (passwords hashed with scrypt; sessions are signed, HttpOnly cookies).
- **Google sign-in** — supported but dormant until you provide OAuth credentials.
  Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `OAUTH_REDIRECT`
  (your `…/auth/google/callback` URL, also registered in Google Cloud). The
  "Sign in with Google" button only appears when these are configured.

Voting, reports, matches, and guessing are tied to the signed-in account — the
server derives who you are from the session cookie, never from the client.

## Adding your photo

The onboarding "Add your photo" flow mirrors the site: photo requirements, a real
photo upload (the file is downscaled to a small JPEG data URL in the browser, so
no external storage is needed), a **prediction slider** (how attractive you think
you'll be rated — later shown against the real percentile in your report), a
"ratings from" choice, an expanded gender question (cis/trans, AFAB/AMAB), and
four confirmation checkboxes that gate the **submit my face** button.

## How it works

`src/engine.js`

- **Elo** (`updateElo`, `recordVote`) rates each photo from head-to-head matchups.
- **Learned type** — every vote folds the chosen winner's demographics into the
  voter's type: gender counts, age lean (`winnerAge − voterAge`), mental-health
  openness, and a running trait vector. `typeSummary()` renders it in plain words.
- **Matches (revealed preference)** — every vote records that the voter rated the
  winner over the loser (`ratings[id] = {w, l}`). `likes(a, b)` is true when `a`
  picked `b` over others more often than not; `mutualMatches` returns everyone you
  *and* they both like. That mutual match reveals socials.
- **Suggestions** — `matchScore` (predicted mutual attraction: orientation/gender
  prior, learned preference, type-fit, attractiveness) powers "go rate these next".
- **Guessing games** — `guessOutcome` scores guesses; per-game accuracy is tracked
  (`store.guessStats`), and each guess is also aggregated onto the *target* photo
  (`store.recordGuessAbout`) to power its "what strangers guess" reveals.
- **Report economy** — `attractivenessBand` (confidence band + pairs progress),
  `guessConsensus` (per-game reveal), and `fansReport` (demographics of your fans,
  incl. mental-health overrepresentation vs. the population baseline).
- **Your taste** — `tasteReport` turns your rating choices into taste cards
  (politics/money/bodycount/dominance/mental-health/gooner): which pole you lean
  to, a "more than X% of raters" percentile, and a slider position. Cards **unlock
  progressively** as your `votesCast` passes each `TASTES[].unlockAt`.
- **Guessing rounds** are two-photo comparisons ("who is more X"): `GET /api/versus`
  serves two profiles, `POST /api/versus-guess` scores the higher trait value and
  records a directional guess onto each photo. Pick by click or ←/→ arrow keys,
  with a live accuracy badge and a men/women filter.

`src/questions.js` maps **60 self-report questions — 12 per quiz** onto the five
guessing-game axes (bodycount, net worth, politics, dominance, gooner nature), so
each trait score is measured deeply enough to be accurate. Demographics (age,
gender, orientation, mental health) are structured fields collected separately.

## API

| Method | Route                        | Purpose                                       |
|--------|------------------------------|-----------------------------------------------|
| POST   | `/auth/signup` · `/auth/login` | create / start a session (sets cookie)      |
| POST   | `/auth/logout`               | end the session                               |
| GET    | `/auth/google` · `/auth/google/callback` | Google OAuth (if configured)      |
| GET    | `/auth/config`               | whether Google sign-in is available           |
| GET    | `/api/me`                    | current account + its profile (401 if none)   |
| GET    | `/api/questions` · `/api/meta` | questionnaire, axes                         |
| POST   | `/api/profile`               | create/update the session account's profile   |
| GET    | `/api/matchup?gender=`       | two profiles to compare (optionally filtered) |
| POST   | `/api/vote`                  | `{winnerId, loserId}` — actor = session       |
| GET    | `/api/report`                | attractiveness band, guess reveals, fans, type |
| GET    | `/api/matches`               | mutual matches (**socials revealed**)         |
| GET/POST | `/api/guess`               | serve / answer a guessing round               |
| POST   | `/api/answer`                | `{qid, i}` — save one self-answer (game step)  |
| POST   | `/api/games/reward`          | `{correct}` — 2 credits on 3 of 5 correct      |
| GET    | `/api/guess-stats`           | per-game accuracy for the signed-in user      |
| POST   | `/api/reveal`                | `{game}` — spend 30✦ to reveal a guess         |
| POST   | `/api/buy-pairs`             | spend 75✦ for +200 prioritized matchups        |
| POST   | `/api/unlock-fans`           | spend 300✦ to unlock the demographic report    |
| POST   | `/api/email-pref`            | `{on}` — email me when new data arrives        |
| GET    | `/api/credit-packs`          | purchasable credit packs                       |
| POST   | `/api/buy-credits`           | `{packId}` — demo checkout, grants credits     |

Actions that mutate a user require a session; unauthenticated calls get 401.
Profiles persist to `data/users.json`, accounts to `data/accounts.json`, and the
session secret to `data/.secret` (all git-ignored).

## Privacy note

Orientation and mental-health fields are optional, self-reported, kept private,
and used only to power your own report, matchmaking, and the guessing games.
