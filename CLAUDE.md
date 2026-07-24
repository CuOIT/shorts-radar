# shorts-radar

YouTube Shorts outlier scanner. Runs daily on GitHub Actions, commits results as JSON.
Purpose: **niche discovery** (find repeating visual hook mechanics), not niche exploitation.

## Rules

- Never hardcode a secret. Always read from environment variables (`process.env.YT_API_KEY`).
- Do not add a dependency without asking first. Current dependency count: **0**.
- Every filter threshold lives in `src/config.js`. Do not scatter magic numbers through the logic.
- Never call the real API in tests — use the fixtures in `test/fixtures/`.
- Any change to the scoring formula must come with an updated test.
- Never commit a data file larger than 5 MB; `data/raw.json` rotates monthly into `data/archive/`.
- The viewer only reads the JSON file. It must never call an external API.
- Prefer readable code over short code.

## Layout

| Path | Role |
|---|---|
| `src/config.js` | All tunables: seeds, thresholds, quota budget |
| `src/duration.js` | ISO 8601 duration → seconds |
| `src/score.js` | Outlier scoring formula |
| `src/quota.js` | Daily quota accounting + guard |
| `src/youtube.js` | YouTube Data API v3 client (injectable `fetch`) |
| `src/pipeline.js` | search → videos → channels → filter → score → dedupe |
| `src/scan.js` | CLI entry point, wires real client + store |
| `src/store.js` | Reads/writes `data/*.json`, monthly rotation |

## Commands

```
npm test              # node:test, zero network
npm run dry-run       # full pipeline against offline fixtures
npm run scan          # live run, needs YT_API_KEY
```
