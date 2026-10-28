# FAQ

**Will this get my account suspended?**
Browsing through the session view is your own browser session doing what a browser does;
nothing is injected into X's page and nothing is replayed. Everything that writes to X goes
through the official API, declared and billed, unless you turn on posting media through the
session. Automations never touch the session.

**Why does a button show a price?**
Because that click pays X or a model through treg. The number is what you will be charged. A
button that says free is served from the cache or from what the session already saw.

**Where is my treg token stored?**
Encrypted in the service's database with a key in `~/.xtend`. A copied database does not leak
it.

**Does Xtend read my DMs?**
The DMs section reads DM history through the X connection on your click. The session view
does not capture Messages.

**Can I use the tools without the desktop app?**
Yes, from a browser against a running service (see [Remote service](./remote-service.md)).
You lose the x.com panel and the free observations the desktop captures.

**Nothing shows in Seen, Targets or Best time.**
They are built from what the session view observed. Browse X in the desktop app for a while.

**A queued post did not go out.**
The service must be running at the slot: the app open, or `xtend service install` done, or a
remote service. Check Compose's Failed section for the reason, and Settings for the budget.

**How do I move Xtend to another machine?**
Copy `~/.xtend`. The X session is not in it; sign in again in the new app.
