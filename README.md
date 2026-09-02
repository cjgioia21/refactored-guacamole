# StudyMatch

An attraction-based matchmaking app inspired by [studyofus.com](https://studyofus.com).

You submit a photo and answer a battery of political / sexual / personality
questions plus demographics. Strangers then compare your photo against others and
pick who's more attractive. From those choices StudyMatch builds:

- **How you're perceived** — an Elo attractiveness rating and percentile.
- **Your type** — learned from *the photos you choose*: gender you're drawn to,
  older/younger age lean, openness to partners with mental-health conditions, and
  political/personality traits.
- **Who's attracted to you** — the trait profile of people who pick you.
- **Matches** — a match happens when **you both rate each other's photo over other
  people's** (mutual revealed preference, like a double opt-in). A match **unlocks
  messaging** between the two of you, and shows their socials.

You can't message anyone until you've matched — the server rejects messages
between users who aren't a mutual match.

## Run

```bash
npm install
node src/seed.js   # optional: 12 demo profiles + simulated matchups
npm start          # http://localhost:3000
npm test           # engine tests
```

## How it works

`src/engine.js`

- **Elo** (`updateElo`, `recordVote`) rates each photo from head-to-head matchups.
- **Learned type** — every vote folds the chosen winner's demographics into the
  voter's type: gender counts, age lean (`winnerAge − voterAge`), mental-health
  openness, and a running trait vector. `typeSummary()` renders it in plain words.
- **Matches (revealed preference)** — every vote records that the voter rated the
  winner over the loser (`user.ratings[id] = {w, l}`). `likes(a, b)` is true when
  `a` picked `b` over others more often than not; `mutualMatches` returns everyone
  you *and* they both like. That mutual match is what unlocks messaging.
- **Suggestions** — `matchScore(a, b)` (harmonic mean of both directions of a
  predicted `attractionScore`: orientation/gender prior, learned gender preference,
  type-fit, attractiveness) powers "go rate these next", not the match itself.
- **Guessing games** — `guessOutcome` scores guesses of a person's trait axis,
  age bracket, gender, or whether they report a mental-health condition.

`src/questions.js` maps ~30 self-report questions onto 10 trait axes.
Demographics (age, gender, orientation, mental health) are structured fields.

## API

| Method | Route                              | Purpose                                  |
|--------|------------------------------------|------------------------------------------|
| GET    | `/api/questions`                   | questionnaire + axes                     |
| GET    | `/api/meta`                        | genders, orientations, MH flags, axes    |
| POST   | `/api/users`                       | create profile (photo, demographics, socials, answers) |
| GET/PUT/DELETE | `/api/users/:id`           | read / update / delete                   |
| GET    | `/api/matchup?voter=:id`           | two profiles to compare                  |
| POST   | `/api/vote`                        | `{voterId, winnerId, loserId}`           |
| GET    | `/api/users/:id/report`            | attractiveness, your type, matches, crushes |
| GET    | `/api/users/:id/matches`           | mutual matches (socials revealed)        |
| GET    | `/api/match/:a/:b`                  | predicted score + whether it's mutual    |
| GET    | `/api/users/:id/messages/:otherId` | message thread — **403 unless matched**  |
| POST   | `/api/users/:id/messages/:otherId` | `{text}` — send a message (matched only) |
| GET/POST | `/api/guess`                     | serve / answer a guessing round          |
| POST   | `/api/games/reward`                | `{voterId, correct}` — credit if ≥2/3    |

Socials are never returned by `publicView`, matchups, or reports — only to a
**mutual match**. Messaging is refused (403) between non-matched users. Profiles
persist to `data/users.json` and threads to `data/threads.json` (both git-ignored).

## Privacy note

Orientation and mental-health fields are optional, self-reported, kept private,
and used only to power your own report and match suggestions.
