# Leads

Leads is people: everyone the screens have found, the lists you build, the signal agents that
fill them, and your new followers.

## People

Everyone found, as a table filtered by stage: new, contacted, replied, customer, ignored. The
selected person opens beside it: who they are, their stage and notes, and two actions through
the X connection, each priced on its button:

- **DM** them. Without their user id the service reads their profile first; that read is in the
  price.
- **Reply** to their latest post, with an AI draft to start from.

What happened so far (replies, DMs, which agent found them) lists under the person.

## Lists

One list's people, with a switcher for the others in the header. Lists are free; only filling
them costs. Two builders fill a list from the detail column:

- **Search**: criteria, a paid preview of who matched, then everyone into the list in one click.
- **Engagers of a post**: who reposted or liked one post, priced by the service before the
  fetch, then into the list.

Each builder shows what it found and what it cost before you add anyone.

## Agents

Signal agents are saved searches the service runs on a schedule and files into People. The
selected agent shows its last run, **Run now**, **Pause**, and its settings in place: the query,
the schedule, the minimum score, whether to drop bots. The price of one run is a search page
plus a profile read per new author when it drops bots, and it shows beside Run. A match raises
an OS notification. **Suggested agents** are queries the model proposes from your posts.

Agents also run from the terminal: `xtend agents run <name>`.

## New followers

Followers gained since the last check. One check reads one followers page of your handle,
priced up front; a check under 10 minutes old serves free. A follower is in People once you
add them.
