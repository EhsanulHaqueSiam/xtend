# Costs and budget

Xtend has no wallet of its own. X API calls and model calls go through treg and are paid from
your treg balance. Settings holds the token and a **monthly budget** in USD; the service will
not start a paid call that would overshoot it, and the Settings meter shows this month's spend.

## Before a paid click

Every button that costs shows its price before you click. The price is what the rate card says
for that action; where the read cache would make a click free, the button says so.

| action                                  | price (USD) |
| --------------------------------------- | ----------- |
| post, like, repost, follow, DM          | 0.015       |
| post with a link                        | 0.20        |
| delete                                  | 0.01        |
| search page                             | 0.00075     |
| profile read                            | 0.01        |
| followers page                          | 0.001       |
| trending                                | 0.001       |
| likers page (X bills per user, 20 each) | 0.20        |
| reposters page                          | 0.001       |

Posts with media through your x.com session are not billed (see
[x.com inside Xtend](./x-view.md)).

Model calls (assist actions, labels, drafts) reserve a small amount from the budget and settle
what the call cost. They show a price on their button too.

## What is free

- Browsing X, the Seen feed, the metrics rows and hover cards.
- Drafts, queue, slots, calendar.
- Lists, collections, the swipe file, watching a handle.
- Stored reports, cached searches, cached trends, best time from observed posts.
- Rules themselves, dry runs over stored data.

## What runs without you

These spend on the service's clock once you turn them on, so each is off until you do:

- Queued drafts post at their slot.
- Library's morning jobs (Settings: **Daily Library jobs**).
- Leads agents on their schedule.
- Automation rules, each with its own daily cap and budget.
- The nightly private-metrics read for Analyze.

`xtend spend` prints this month's spend from a terminal.
