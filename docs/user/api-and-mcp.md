# CLI, HTTP API and MCP

Everything a click does is one service method, so the same thing can be done from a terminal,
a script or an agent, and costs and logs exactly what the click would.

## CLI

The service binary doubles as the CLI. On its own, `xtend` runs the service (`--host`,
`--port` and `--base-dir` set where it listens and keeps its data). The commands below drive a
running service: they read the token from `~/.xtend` and the URL from `XTEND_SERVICE_URL` or
`--port`.

```
xtend post "<text>"        draft the text and post it now (paid)
xtend queue                drafts waiting in the queue
xtend report <handle>      the stored score report as JSON
xtend spend                this month's spend against the budget
xtend agents run <name>    run a Leads agent by name (paid)
xtend mcp                  serve MCP over stdio
xtend service install      keep the service running with the app closed (macOS launchd)
xtend service uninstall
xtend service status
xtend triage               a scrubbed folder for a coding agent to investigate a problem
```

## HTTP API

```
POST http://127.0.0.1:4820/api/rpc/<method>
Authorization: Bearer <token>
Content-Type: application/json
```

```sh
TOKEN=$(cat ~/.xtend/auth-token)
curl -s -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:4820/api/rpc/spend.summary
```

Method names and payloads are the ones in `packages/contracts`; the full table of statuses
is in [the API reference](../operations/api.md).

## MCP

`xtend mcp` lets any agent that speaks the Model Context Protocol over stdio use Xtend as
tools:

```json
{ "mcpServers": { "xtend": { "command": "xtend", "args": ["mcp"] } } }
```

| tool             | does                                         |
| ---------------- | -------------------------------------------- |
| `draft_post`     | saves a draft                                |
| `queue_post`     | saves a draft and queues it on the next slot |
| `report_handle`  | a handle's score report                      |
| `search_library` | X search (paid unless cached)                |
| `spend_summary`  | this month's spend                           |

Paid tools charge your treg balance under the same budget as the app.
