# Glossary

Terms whose meaning matters across Xtend. Architecture and constraints belong in the
[overview](./overview.md), not here.

## Surfaces

| Term         | Meaning                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------- |
| Service      | The headless `xtend` process: SQLite, scheduler, automations, treg and X calls, agent runs.         |
| Client       | The web app or the Electron shell around it, connected to one service over WebSocket RPC.           |
| Session view | The x.com `<webview>` in the desktop, on the account's cookie partition. The only X login there is. |
| Skin         | CSS the desktop inserts into the session view. Never script.                                        |
| Overlay      | The preload in the session view's isolated world that draws Xtend's rows under posts. Read-only.    |
| Panel        | The session view docked beside a tool. `⌘\` toggles it; width is one slider.                        |
| Companion    | The column beside a page (or beside X on Home) that holds that page's cards.                        |
| Section      | One row under a tool in the sidebar, `?tab=` in the URL. A page never draws its own tab row.        |

## Data

| Term         | Meaning                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| Observation  | A post, author or metrics row the desktop read from the session view's traffic. Passive.               |
| Account      | One connected X handle. Every per-account table carries its id; a switch is one setting.               |
| Draft        | A post, thread or article in Compose, with a status: draft, queued, posting, posted, failed.           |
| Slot         | A time of week a queued draft may post at.                                                             |
| Saved post   | A post in the Library with its numbers frozen at save time, plus a note and collections.               |
| Collection   | A tag on saved posts. Not a folder: a post can be in many.                                             |
| Person       | A lead, with a stage and notes. Lists group people; agents file into people.                           |
| Signal agent | A saved search the service runs on a cadence and files matches from.                                   |
| Rule         | An automation: a trigger, an action, conditions and limits. Runs through the X API, never the session. |
| Pending      | An ask-first rule's queued action, waiting in Needs you.                                               |
| Mark         | A fact about a post Xtend already knows, shown on the post itself: replied, saved, lead, watching.     |

## Money

| Term   | Meaning                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------ |
| treg   | The one door to X's API and models. The service holds the token; the user pays from their balance.           |
| Quote  | The price of one action before it runs, from the rate card, or "cached, free" when the read cache serves it. |
| Budget | The monthly cap. Reservations under one gate keep concurrent calls from overshooting it.                     |
| Free   | Anything from the session or already stored. The free path is offered before the paid one.                   |

## Pool

| Term     | Meaning                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------- |
| Pool     | The shared Postgres of public posts every install saw, behind a worker. Trends come from it.   |
| Install  | A random id the worker issues to one service for rate limiting. Never joined to content.       |
| Sighting | One install reporting one post, with the numbers it saw. Velocity is the distance between two. |
| Settled  | An install a day old or older. Only settled installs count toward trends.                      |
