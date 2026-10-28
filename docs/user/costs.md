# Costs and the budget

Browsing X in Xtend is free. So is everything built from what your session saw: Seen, the
numbers under posts, your own posts in Analyze, mentions and replies the session loaded, and
the Home companion cards.

Paid actions call X's API or a model through treg, and your treg balance pays:

| action                                              | charged for                                                     |
| --------------------------------------------------- | --------------------------------------------------------------- |
| Post now, queued posts, likes and replies by a rule | the X API write                                                 |
| Refresh posts, fetch a competitor, follower pages   | the X API read                                                  |
| Library search, picks, trends                       | the search or the scrape                                        |
| Score a handle, bot check                           | the follower sample                                             |
| Any assist: hook, rewrite, reply draft, ask, why    | the model call, unless Settings points assist at your own model |

Assist is free when Settings > AI assist points at your own model: a local Ollama, or your own
key at OpenAI, Anthropic, Groq or OpenRouter, which then bills you directly and never through
Xtend. Every paid button shows its price before you press it. A price that says "cached, free" means
the same read is still in the cache and will not be charged again.

## Budget

Settings, treg and budget: your treg token and a monthly budget in USD. Paid calls stop before
this month's spend would pass the budget. The sidebar's Today block shows spend against it,
and Settings, Spend shows today and this month.

Rules carry their own limits too: a price per fire, a budget per day and per month, and an
"ask first" switch that queues the action in Automate, Needs you until you approve it.

## What is never charged

Reading your own session. Opening a post on X. Saving to the Library. Drafting. Scheduling.
Anything the session already observed.
