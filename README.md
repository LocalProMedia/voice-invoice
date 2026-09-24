# Quote Assistant — LocalPro Media

## 4 modes
- **Quote** — describe a job, get a structured invoice
- **Ask a Question** — field Q&A for your trade
- **Marketing Audit** — attach a screenshot, get feedback + post templates
- **Reply to Customer** — paste a customer's message, get a professional reply back (with Copy / Text buttons)

## Also includes
- 5-trade dropdown: Home Cleaning, Plumbing, Electrical, Landscaping, Flooring
- Real trade knowledge baked into the AI (common services + typical pricing per trade)
- Conversation memory — if info's missing, it asks ONE follow-up question instead of guessing
- Copy / Text to Client buttons on quotes and customer replies
- Editable line items on quotes — tap to fix, totals recalculate live
- Remembers your selected trade between visits

## Files
- `index.html` — full frontend
- `server.js` — backend (no license check — password screen in index.html covers access for now)
- `package.json`, `Dockerfile` — unchanged

## Upload instructions (all 5 files, every time)
1. Unzip this
2. GitHub repo → Add file → Upload files
3. Drag in all 5 — GitHub auto-replaces files with matching names
4. Scroll down, click green "Commit changes"
5. Wait ~1-2 min for Render to auto-redeploy
6. Visit your live URL, enter the test password, try it

## Test password
Open `index.html`, near the top:
```
var TEST_PASSWORD = "changeme123";
```

## Adding a new trade later
In `server.js`, add an entry to `TRADE_KNOWLEDGE`, and add a matching
`<option>` in `index.html`'s trade dropdown. Nothing else needs to change.

## Adding Gumroad back in later
License check goes back into `server.js`'s `/api/generate-quote` route,
verified against Gumroad's API using `product_id` (not `product_permalink`).
