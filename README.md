# StudyMatch

An attraction-based matchmaking app inspired by [studyofus.com](https://studyofus.com).

You create an account, submit a photo, and answer a battery of political / sexual /
personality questions plus demographics. Strangers then compare your photo against
others and pick who's more attractive. From those choices StudyMatch builds:

- **How you're perceived** — an Elo attractiveness rating and percentile.
- **Your type** — learned from *the photos you choose*: gender you're drawn to,
  older/younger age lean, openness to partners with mental-health conditions, and
  political/personality traits.
- **Who's attracted to you** — the trait profile of people who pick you.
- **Matches** — a match happens when **you both rate each other's photo over other
  people's** (mutual revealed preference, like a double opt-in). On a match, you
  each see the other's **socials** (Instagram, etc.) so you can reach out.

Socials stay private until you match — they're never shown in matchups, reports,
or public profiles, only to a confirmed mutual match.

## Run

```bash
npm install
npm run seed       # optional: 12 demo profiles + simulated matchups to rate
npm start          # http://localhost:3000
npm test           # engine + auth + server tests
```

## Accounts

- **Email + password** — create an account or log in. Works with zero setup
  (passwords hashed with scrypt; sessions are signed, HttpOnly cookies).
- **Google sign-in** — supported but dormant until you provide OAuth credentials.
  Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `OAUTH_REDIRECT`
  (your `…/auth/google/callback` URL, also registered in Google Cloud). The
  "Sign in with Google" button only appears when these are configured.

Voting, reports, matches, and guessing are tied to the signed-in account — the
server derives who you are from the session cookie, never from the client.

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
- **Guessing games** — `guessOutcome` scores guesses of a person's trait axis, age
  bracket, gender, or whether they report a mental-health condition; per-game
  accuracy is tracked (`store.recordGuess` / `store.guessStats`).

`src/questions.js` maps ~30 self-report questions onto 10 trait axes.
Demographics (age, gender, orientation, mental health) are structured fields.

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
| GET    | `/api/report`                | attractiveness, your type, matches, crushes   |
| GET    | `/api/matches`               | mutual matches (**socials revealed**)         |
| GET/POST | `/api/guess`               | serve / answer a guessing round               |
| POST   | `/api/games/reward`          | `{correct}` — credit if ≥2/3                   |
| GET    | `/api/guess-stats`           | per-game accuracy for the signed-in user      |

Actions that mutate a user require a session; unauthenticated calls get 401.
Profiles persist to `data/users.json`, accounts to `data/accounts.json`, and the
session secret to `data/.secret` (all git-ignored).

## Privacy note

Orientation and mental-health fields are optional, self-reported, kept private,
and used only to power your own report, matchmaking, and the guessing games.
