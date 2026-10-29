# Costs and budget

Xtend has no wallet of its own. X API calls go through treg and are paid from your treg
balance. Settings, Money, holds the token and a **monthly budget** in USD; the service
will not start a paid call that would overshoot it. The Spend group on that page shows this
month, today, a bar against the budget and what the month went on; the sidebar's Today block
shows the month against the budget too.

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

Posts with media and replies sent from Engage go through your x.com session and are not
billed (see [x.com inside Xtend](./x-view.md)).

Model calls (assist actions, labels, drafts) are free through Xtend. They run on the Claude or
Codex login on the machine running the service, or another model you set in Settings, Writing;
your plan's limits apply, or that provider bills you directly. Nothing is reserved from the
budget or logged.

In the desktop app the free way sits beside the paid fetch: **Profile on X** beside Analyze's
refresh and a competitor's Fetch, **Notifications on X** beside Engage's Fetch new, **Search on
X** beside Library's paid search. Each opens the page in the X panel at no cost.

## What is free

- Browsing X, the Seen feed, the metrics rows, marks and hover cards.
- Saving from Seen, drops on the sidebar, and the pool in Library's Trends.
- Drafts, queue, slots, calendar.
- Lists, collections, the swipe file, watching a handle.
- Stored reports, cached searches, cached trends, best time from observed posts.
- Rules themselves, dry runs over stored data.

## What runs without you

These spend on the service's clock once you turn them on, so each is off until you do:

- Queued drafts post at their slot.
- Library's morning jobs (Settings, Writing: **Daily Library jobs**).
- Leads agents on their schedule.
- Automation rules, each with its own daily cap and budget.
- The nightly private-metrics read for Analyze.

`xtend spend` prints this month's spend from a terminal.
