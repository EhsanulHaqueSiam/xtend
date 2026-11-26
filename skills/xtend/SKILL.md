---
name: xtend
description: Drive the user's own Xtend (an X growth app running on their machine) through its CLI, HTTP API and MCP tools - drafts, the posting queue and slots, automation rules with dry runs, analytics, account scores and spend. Use when the user asks their agent to write or queue X posts, plan the calendar, set up or check an automation, or read their X numbers through Xtend.
---

# Xtend

Xtend is a local service (`xtend`, port 4820 by default, data in `~/.xtend`) that the desktop app
and every agent share. Each surface below calls the same service method a click in the app calls,
so it costs, logs and budgets exactly the same.

## Three rules

1. **Price first, then ask.** Before any paid call, get its price and say it to the user; run it
   only after they agree. The service refuses a call that would overshoot their monthly budget:
   report that and stop. Do not retry, split the call, or change the budget unless they ask.
2. **No session, no cookies.** The x.com session inside the app acts only for the user's own
   clicks. An agent never uses it, never reads the app's browser profile, and never handles X
   cookies. Everything an agent does goes through the X API, paid from the user's treg balance.
   That is why there is no tool to edit a post: edits go through the session (`compose.editPost`
   is for the app's own button; never call it).
3. **Don't print the service token.** It is `~/.xtend/auth-token` (or `<base dir>/auth-token`).
   Read it into a variable for the `Authorization` header and nothing else.

## Connect

MCP, as a stdio server (`xtend mcp` reads the token and URL itself):

```json
{ "mcpServers": { "xtend": { "command": "xtend", "args": ["mcp"] } } }
```

| tool             | cost                                        |
| ---------------- | ------------------------------------------- |
| `draft_post`     | free                                        |
| `queue_post`     | free to queue; the post is paid at its slot |
| `report_handle`  | free (stored samples)                       |
| `search_library` | paid per page unless cached                 |
| `spend_summary`  | free                                        |

CLI, against the running service (`--base-dir` or `XTEND_SERVICE_URL` to pick another one):

```sh
xtend queue                # drafts waiting in the queue
xtend spend                # month and today against the budget
xtend report <handle>      # stored score report, JSON
xtend post "<text>"        # paid: posts right now
xtend agents run <name>    # paid: runs a Leads agent
```

HTTP, for everything else: `POST http://127.0.0.1:4820/api/rpc/<method>`, JSON body (`{}` for
methods without input), `Authorization: Bearer <token>`. A 422 is the method's own error, in the
body's `error`.

```sh
TOKEN=$(cat ~/.xtend/auth-token)
rpc() { curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "$2" "http://127.0.0.1:4820/api/rpc/$1"; }
rpc spend.summary '{}'
```

Method payloads are the schemas in
[packages/contracts](https://github.com/EhsanulHaqueSiam/xtend/tree/main/packages/contracts/src)
(`compose.ts`, `plan.ts`, `automate.ts`, `analyze.ts`, `costs.ts`).

## Pricing a call

`costs.quote` prices actions before they run and says when a cache makes them free:

```sh
rpc costs.quote '{"actions":[{"kind":"post","text":"..."},{"kind":"search","query":"from:someone"}]}'
```

Kinds include `post`, `like`, `repost`, `dm`, `search`, `profile`, `analyzeRefresh`,
`competitorFetch`, `scoreRun` and `assist`. A post with a link costs far more than one without;
quote the final text. Check what is left with `spend.summary` before a batch.

## Drafts and the queue (free until something posts)

- `compose.draftCreate` `{"blocks":[{"text":"..."}]}` (one block per post of a thread),
  `compose.draftsList`, `compose.draftUpdate`, `compose.draftDelete`.
- `plan.queue` `{"id"}` puts a draft in the next free slot; `plan.schedule` `{"id","at"}` sets a
  time; `plan.unschedule` and `plan.skip` undo or move it. `plan.slotsGet` / `plan.slotsSet` edit
  the weekly slots.
- `plan.calendar` `{"from","to"}` and `plan.ready` show what is lined up; `plan.heatmap` gives the
  best hours from observed posts.
- Queued drafts post on the service's clock and are paid then. Tell the user the price per post
  when you queue. `plan.runNow` and `compose.postNow` post immediately: paid, ask first.

## Automations

A rule is trigger, conditions, action and limits (`automate.ts`'s `RuleInput`). Rules act only
through the X API, on the service's clock, with the app closed.

1. Create it with `"dryRun": true` and real `budgetUsdDay` / `budgetUsdMonth` through
   `automate.ruleUpsert`. Consider `"askFirst": true` so each firing waits for the user's approval.
2. `automate.preview` shows what every enabled rule would do now, each firing with its price.
   `automate.dryRun7d` `{"id"}` replays one rule over the last 7 days of stored data. Both are free.
3. Show the user the firings, the price per firing and the budget. Turn `dryRun` off only after
   they say yes. Watching some triggers polls X and costs per day too; the app shows that price.
4. `automate.runsList`, `automate.pendingList` to check on it. `automate.pendingApprove` and
   `automate.ruleRunNow` spend: ask first.

## Analytics

Free, from stored data: `analyze.data`, `analyze.engagers`, `analyze.competitors`,
`scores.report`. `analyze.themes` adds one model call on the user's own model login unless
cached. Paid reads that refresh them: `analyze.refresh`,
`analyze.competitorFetch`, `analyze.refreshNonPublic`, `scores.run`. Prefer stored data and say
how old it is before offering a paid refresh.

## When it fails

`xtend doctor` checks the base dir, database, service, trace file, treg token (set or not, never
the value) and launchd, read-only. `xtend trace --since 1h` summarizes recent failures. For a bug,
`xtend triage` writes a scrubbed folder for a coding agent. None of them spend.
