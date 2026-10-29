# Settings

Settings is six pages, each a row under Settings in the sidebar: Account, Money, Writing,
X session, Pool and Service. **Search settings** in the header finds any setting on any page by
its name or its hint, with the page it lives on above it.

Changes wait in a bar at the bottom that says **Unsaved changes** until you **Save**. On Money,
Writing, X session and Pool, **Restore defaults** at the top right puts that page back to how it
shipped (on Writing that clears your voice notes and keywords); it asks for a second click
(**Confirm restore**).

## Account

- **Handle**: taken from your X session when empty. Scores, analytics and mentions are about it.
- **Accounts**: every connected X handle, **Switch** on the others, and a label and optional
  handle to **Add** one. See [Accounts](./accounts.md).

## Money

- **treg token**: every paid call uses it. It is encrypted at rest. Not set, the service falls
  back to `XTEND_TREG_TOKEN` or the treg CLI login on its machine.
- **Monthly budget (USD)**: paid calls stop before this month's spend would pass it. It starts
  at $50.
- **Spend**: this month, today and the budget, a bar for how much of the budget is gone, and
  what the month went on, by purpose. See [Costs](./costs.md).

## Writing

- **AI assist**: where assist runs. **Xtend** is metered per call against the budget. A preset
  makes every assist free through Xtend: **Local (Ollama)**, or your own key at **OpenAI**,
  **Anthropic**, **Groq** or **OpenRouter**, which bill you directly. A preset fills
  **Endpoint** (any OpenAI-compatible URL ending in `/v1`) and **Model name**; paste the
  **API key** for a provider. The key is stored encrypted and is dropped if you change the
  endpoint without pasting a new one.
- **Time zone**: an IANA zone (`Europe/Berlin`). Posting slots, the calendar, schedule
  triggers, the best-time grid and the spend meter's day and month use it. Defaults to the
  service machine's zone.
- **Voice notes**: one paragraph on what you post about and how you sound. The assistant writes
  in this voice.
- **Keywords**: comma separated. Library, Engage and Leads search these by default.
- **Daily Library jobs**: the morning picks, hook detection and three ready posts, at the
  prices shown. Off until turned on, since they spend with nobody clicking.

## X session

Desktop only, where your X session lives.

- **Act through X for what I click**: on by default. Replies you send from Engage and posts with
  media go through your own X session, one at a time at a human pace, free. Off, replies go
  through the API at the listed price. Rules never use your session. See
  [x.com inside Xtend](./x-view.md).
- **Clean X**: one switch per part of x.com to hide, with CSS only. Applied at once; it is a
  preference of this window. The switches and their defaults are in
  [x.com inside Xtend](./x-view.md#clean-x).

## Pool

**Share what you see with the pool**, on by default. It sends public posts you scroll past to
the shared pool behind Library's Trends: their text, the author's handle, name and follower
count, the numbers you saw, and a random install id. Never ads, reposts, DMs, lists, bookmarks,
posts from protected accounts or from your notifications, your handle, or which account saw
what. Off stops sending; Library's Trends reads the pool for free either way.

## Service

Shows whether this is the desktop or a browser, the service's name and version, how this
window reached it (child of the app, launchd, remote) and the data directory.

**Remote service** points the desktop at a service on another machine: a URL such as
`http://mac-mini:4820` and that machine's service token. **Check** tests both; **Connect and
relaunch** switches to it, and **Use local service** switches back. See
[Remote service](./remote-service.md).
