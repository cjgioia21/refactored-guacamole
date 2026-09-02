# StudyMatch

A study-partner matchmaking platform inspired by [studyofus.com](https://studyofus.com).
Members create a profile (subjects, goals, availability, level, study style) and
the engine scores compatibility to surface the best study partners — or auto-pairs
the whole group into buddies.

## Run

```bash
npm install
npm start        # http://localhost:3000
npm test         # matchmaking engine tests
```

## Matchmaking

`src/matchmaking.js` scores two profiles 0–100 across weighted factors:

| Factor       | Weight | Basis                                   |
|--------------|:------:|-----------------------------------------|
| subjects     |   35   | Jaccard overlap of subjects             |
| availability |   25   | shared day/time-slot cells              |
| goals        |   15   | Jaccard overlap of goals                |
| style        |   10   | matching study style                    |
| level        |   10   | closeness of experience level           |
| language     |    5   | shared languages                        |

- `compatibility(a, b)` — score + per-factor breakdown + shared subjects
- `findMatches(user, candidates)` — ranked partner list for one user
- `pairAll(users)` — greedy global pairing maximizing total compatibility

## API

| Method | Route                          | Purpose                        |
|--------|--------------------------------|--------------------------------|
| GET    | `/api/users`                   | list members                   |
| POST   | `/api/users`                   | create profile                 |
| GET    | `/api/users/:id`               | get member                     |
| PUT    | `/api/users/:id`               | update profile                 |
| DELETE | `/api/users/:id`               | remove member                  |
| GET    | `/api/users/:id/matches`       | ranked matches for a member    |
| GET    | `/api/compatibility/:a/:b`     | score between two members      |
| GET    | `/api/pairings`                | auto-pair all members          |
| GET    | `/api/meta`                    | days / slots / levels          |

Data persists to `data/users.json` (git-ignored).
