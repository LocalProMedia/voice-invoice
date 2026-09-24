# Quote Assistant — LocalPro Media

Three modes in one tool:
- **Quote** — describe a job by voice or text, get a structured invoice back
- **Ask a Question** — quick field Q&A for your trade (codes, specs, pricing)
- **Marketing Audit** — attach a screenshot (reviews, social post), get feedback + ready-to-post templates

## Files
- `index.html` — the whole frontend (chat UI, mode tabs, test password gate)
- `server.js` — backend, calls Gemini, no license check (test password in index.html covers access for now)
- `package.json` — dependencies
- `Dockerfile` — needed for Render deploys

## Setup
1. Upload all 4 files to your GitHub repo, overwriting what's there
2. On Render: Environment Variables → add `GEMINI_API_KEY` with your real key from aistudio.google.com/app/apikey
3. Deploy

## The test password
Open `index.html`, find near the top:
```
var TEST_PASSWORD = "changeme123";
```
Change it to whatever you want. This gates the tool until Gumroad licensing is wired up — swap it for real license checking later.

## Adding Gumroad back later
When ready, the license check goes in `server.js`'s `/api/generate-quote` route,
verified against Gumroad's API using `product_id` (not `product_permalink` —
Gumroad changed this for products made in 2023+).
