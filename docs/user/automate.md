# Automate

Automate is rules: when something happens, if conditions hold, do an action, within limits.
Rules run on the service's clock, so they fire with the app closed when the service runs on its
own (see [Install](./install.md)). Rules only ever act through the X API; they never use your
x.com session.

## Rules

The list shows each rule's switch, what it does in one line ("When my post reaches 5,000
views, if no link, reply with …"), its price per firing and what it has spent. Opening a rule,
or **New rule**, adds the editor beside the list: a properties list with When, Only if, Then,
Limits, and what one firing costs beside Save.

**When** (the trigger):

| trigger         | fires                                                        |
| --------------- | ------------------------------------------------------------ |
| my post crosses | one of your posts passes a views, likes or reposts threshold |
| schedule        | at a time on chosen days                                     |
| new engager     | someone likes or reposts you for the first time              |
| keyword post    | a search query finds a new post                              |
| post engaged    | one named post gets a like or a repost                       |
| new follower    | someone follows you                                          |
| agent match     | a Leads agent finds someone above a score                    |
| webhook         | an outside system calls the rule's URL                       |

**Only if** (all optional): within so many hours of the post, has or has no link, author not in
a list, not a reply, author has at least N followers.

**Then** (the action): reply with a plug, DM a template, repost (optionally an evergreen post),
clean the profile after N hours, delete the post, like, unrepost, add to a list, notify you,
follow.

**Limits**: a budget per day and per month in USD, how many minutes a subject must be old
before the action runs, and for like, repost and follow, how many hours later to undo it. A
rule stops firing when a budget is reached.

Two switches change what a firing does: **Dry run** logs what it would have done without
doing it, and **Ask first** parks each firing in Needs you until you approve it.

Watching a trigger costs too: the engine polls X on its own clock for triggers that need fresh
data, and the editor prices that per day from the rate card. Triggers over stored data (new
followers, agent matches, schedules, webhooks) cost nothing to watch.

## Needs you

Ask-first requests. **Approve** performs the action at the price shown on the button;
**Dismiss** closes it for good. The same requests appear under Compose's Automatic section and
as OS notifications.

## Dry run

What every enabled rule would do right now, each firing with its price and the total, without
doing any of it. One rule can also be replayed over the last 7 days of stored posts, engagers
and followers to see when it would have fired.

## Runs

The runs log, newest first: which rule, what it did, what it cost, what failed. Filter by rule
and outcome. Deleting a rule deletes its runs with it.

## Webhooks

A rule with the webhook trigger has a URL under the service. The caller signs the body with the
rule's secret and sends it as `X-Xtend-Signature: sha256=<HMAC-SHA256 of the body>`. The
service refuses unsigned or oversized bodies. The service must be reachable from the caller,
so see [Remote service](./remote-service.md).
