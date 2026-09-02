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
- **Matches** — ranked by **mutual** predicted attraction (you're into them *and*
  they're into you), orientation-aware.

Instead of messaging, two users can **opt in to share socials** — handles unlock
only when *both* sides opt in.

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
- **Mutual attraction** — `matchScore(a, b)` is the harmonic mean of both
  directions of `attractionScore`, which blends an orientation/gender prior
  (`attractedGenders`), learned gender preference, type-fit (`similarity`), and the
  target's attractiveness percentile.
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
| GET    | `/api/users/:id/report`            | attractiveness, your type, matches       |
| GET    | `/api/users/:id/matches`           | ranked mutual matches                    |
| GET    | `/api/match/:a/:b`                  | mutual score between two users           |
| POST   | `/api/users/:id/share`             | `{targetId}` — opt in to share socials   |
| GET    | `/api/users/:id/connections`       | shares; socials revealed on mutual opt-in|
| GET/POST | `/api/guess`                     | serve / answer a guessing round          |
| POST   | `/api/games/reward`                | `{voterId, correct}` — credit if ≥2/3    |

Socials are never returned by `publicView`, matchups, or reports — only through a
**mutual** connection. Data persists to `data/users.json` (git-ignored).

## Privacy note

Orientation and mental-health fields are optional, self-reported, kept private,
and used only to power your own report and match suggestions.
