# Quote Assistant — LocalPro Media

Now with:
- **5-trade dropdown**: Home Cleaning, Plumbing, Electrical, Landscaping, Flooring
- **Real trade knowledge**: each trade has actual common services + typical pricing logic baked into the AI's instructions, so quotes are grounded instead of generic
- **Conversation memory**: if you don't give enough info (no address, unclear scope), the assistant asks ONE follow-up question instead of guessing — your answer gets remembered and used
- **Copy / Text to Client** buttons on every quote
- **Editable line items** — tap any price or description to fix it, totals update live
- **Remembers your trade** between visits

## Files
- `index.html` — full frontend
- `server.js` — backend (no license check — the password screen in index.html covers access for now)
- `package.json`, `Dockerfile` — unchanged from before

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
In `server.js`, add an entry to the `TRADE_KNOWLEDGE` object near the top, and
add a matching `<option>` in `index.html`'s trade dropdown. That's it — no
other changes needed.

## Adding Gumroad back in later
The license check goes back into `server.js`'s `/api/generate-quote` route,
verified against Gumroad's API using `product_id` (not `product_permalink` —
Gumroad changed this for products made in 2023+).
