# FAQ

## Will Xtend get my account suspended?

Reading what X sends to your own browser is what a browser does; Xtend reads it and never
replays, clicks or posts through your session unless you turn session posting on. Writes go
through X's official API with your treg balance, where they are declared and billed. See
[X inside Xtend](./x-in-xtend.md).

## What does it cost?

Nothing to run. Paid actions pay X or the model through your treg balance, each at the price
shown on the button, within the monthly budget you set. See [Costs](./costs.md).

## Where is my data?

In `~/.xtend` on your machine: the database, the service token, logs and the x.com session
profile. Nothing is sent anywhere except the paid calls you make through treg and, when you
leave sharing on, public posts you saw to the shared pool (see the next answer).

## What is shared?

With "Share what you see" on in Settings, the public posts your session scrolled past, their
authors and their numbers go to a shared database so Trends can come from everyone's timeline
instead of a paid call. No viewer identity, no account, no DMs, no bookmarks, no lists. Off
means your install stops sending and still reads trends.

## Can I use it without the desktop?

The service and the web app run on their own, and the CLI, HTTP API and MCP work without a
window. What you lose without the desktop is the x.com session: no free observations, so
Analyze and Engage fill only from paid reads, and Home shows Seen instead of X.

## Two accounts?

Settings, Accounts. Each account has its own X login, data and schedule; switching rebuilds
the window.
