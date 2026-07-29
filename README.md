# shorts-radar

Finds YouTube Shorts that **overperform relative to their channel size**, every day, for $0.

This is a *niche discovery* tool. It narrows the search space; it does not make the decision.
The decision comes from the `HOOK_MECHANIC` / `AI_FEASIBLE_1_5` / `VERDICT` columns you fill in by hand.

## Setup

1. Google Cloud Console → new project → enable **YouTube Data API v3** → create an API key
   (restrict it to that one API).
2. Locally: copy `.env.example` to `.env` and paste the key in. `.env` is gitignored.
   On Windows, write it **without a BOM** — `Out-File`/`>` in PowerShell 5.1 adds one and Node's
   `--env-file` parser then reads the first key as `﻿YT_API_KEY` and silently ignores it.
   Use `[System.IO.File]::WriteAllText("$PWD\.env", "YT_API_KEY=...`n")` or any editor set to UTF-8.
3. On GitHub: Settings → Secrets and variables → Actions → add `YT_API_KEY`.

## Commands

```bash
npm test
```

```bash
npm run dry-run
```

```bash
npm run scan
```

`dry-run` executes the whole pipeline against `test/fixtures/` with global `fetch` disabled —
no network, no quota, no API key needed. Use it to check a config or scoring change before spending quota.

## How it works

```
GitHub Actions cron 23:00 UTC
   -> src/scan.js
   -> search.list per seed (100 units each)
   -> videos.list in batches of 50 (1 unit)
   -> channels.list in batches of 50 (1 unit)
   -> filter (duration, views, channel size) -> score -> dedupe
   -> data/raw.json, committed back to the repo
```

**The viewer never calls the API.** It reads `data/raw.json` and nothing else. Putting an API key
in frontend code leaks it the moment the page loads.

### The `videoDuration=short` trap

`search.list?videoDuration=short` means *under 4 minutes*. It does **not** mean *is a Short*.
The real filter is `contentDetails.duration` parsed client-side and capped at `FILTERS.MAX_SECONDS`.
See `src/duration.js`.

### Scoring

```
outlier = views / max(subs, 500)
vph     = views / max(hours_since_publish, 1)
score   = outlier * log10(vph + 10)
```

These weights are an **assumption**, not a finding. The API exposes no retention, loop rate, or
swipe-away data, so `score` is a proxy for hook quality, never the truth about it. Recalibrate
against your hand-tagged `VERDICT` column after ~14 days of real data.

### Quota

Free tier is 10,000 units/day. Twenty seeds costs ~2,060. The guard in `src/quota.js` stops
starting new searches at 80% of budget and exits **cleanly with a loud log line** — the failure
being prevented is a silent quota burn that looks identical to "there are no trends today".

## Viewer

Mở [viewer.html](viewer.html) trực tiếp bằng double-click. Nó tự thử `fetch('data/raw.json')`;
nếu trình duyệt chặn đọc file cục bộ (Chrome qua `file://` thường bị), bấm **Chọn file khác**
và tự chọn `data/raw.json`.

Lọc theo score / khoảng subs / seed, gắn tag một chạm (`HOOK_MECHANIC`, `AI_FEASIBLE_1_5`,
`VERDICT`). Tag lưu trong `localStorage` của trình duyệt — mất khi xoá dữ liệu duyệt web, nên
bấm **Xuất tag (JSON)** định kỳ để backup. Viewer không gọi API, không cần key; ảnh thumbnail
tải trực tiếp từ CDN công khai của YouTube (`i.ytimg.com`).

## Roadmap gates

| Stage | Unlocks when |
|---|---|
| `viewer.html` | 7 straight days of data **and** you actually opened it on 4 of those 7 days |
| Scoring recalibration | 14 days of data and ≥ 30 hand-tagged rows |

The viewer gate is deliberate. If you don't open the raw data in week one, the problem is the
habit, not the interface, and building a UI is productive procrastination.
