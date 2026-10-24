# API, CLI and MCP

Every capability of the service is one rpc method (`packages/contracts/src/rpc.ts` and the
area contracts). The WebSocket client, the HTTP API, the `xtend` CLI and the MCP server all
call the same handlers, so a post made from a terminal costs and logs exactly what a click
in the app does.

## HTTP API

```
POST http://127.0.0.1:4820/api/rpc/<method>
Authorization: Bearer <token>
Content-Type: application/json

<payload JSON, or an empty body for methods that take {}>
```

The token is `<base dir>/auth-token` (`~/.xtend/auth-token` by default). Answers:

| status | body                                                                                        |
| ------ | ------------------------------------------------------------------------------------------- |
| 200    | the method's success value, encoded with its contract schema                                |
| 400    | `{ "error": "invalid_payload", "message" }`, or `stream_only_over_ws` for streaming methods |
| 401    | `unauthorized` (missing or wrong token, or a browser Origin the service does not trust)     |
| 404    | `{ "error": "unknown_method" }`                                                             |
| 422    | `{ "error": <the method's tagged error, e.g. { "_tag": "ComposeError", ... }> }`            |
| 500    | `{ "error": "defect", "message" }`                                                          |

```sh
TOKEN=$(cat ~/.xtend/auth-token)
curl -s -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:4820/api/rpc/spend.summary
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"query":"from:levelsio min_faves:200","mode":"top"}' \
  http://127.0.0.1:4820/api/rpc/library.search
```

Streaming methods (`events.subscribe`, `desktop.subscribeCommands`) stay on the WebSocket.
A service started with `--host <tailnet ip>` answers the same API on that interface;
everything but `GET /api/health` still needs the token (`apps/server/src/rpc/HttpRpc.test.ts`
and `auth/ServiceAuth.test.ts` pin that).

## CLI

The service binary doubles as the CLI. With no subcommand it runs the service; with one it
talks to the running service over the HTTP API, reading the token from the base dir
(`--base-dir`, `XTEND_HOME`, `~/.xtend`) and the URL from `XTEND_SERVICE_URL` or `--port`.

```
xtend post "<text>"        create a draft from the text and post it now (paid)
xtend queue                drafts waiting in the queue
xtend report <handle>      score report as JSON
xtend spend                this month's spend against the budget
xtend agents run <name>    run a signal agent by name
xtend mcp                  serve MCP over stdio
xtend service install      launchd agent that keeps the service running with the app closed
xtend service uninstall
xtend service status
```

In dev: `node apps/server/src/bin.ts --base-dir .xtend spend`. Packaged:
`Xtend.app/Contents/Resources/apps/server/dist/bin.mjs`.

`service install` writes `~/Library/LaunchAgents/com.xtend.service.plist` pointing at the
binary that ran the command, with the same `--base-dir`, `--port` and `--host`, `KeepAlive`,
`RunAtLoad`, logs in `<base dir>/service.log`, and `XTEND_SUPERVISOR=launchd` so Settings can
show the mode. The desktop sees the loaded agent and stops spawning its own child.

## MCP

`xtend mcp` speaks the Model Context Protocol over stdio (newline-delimited JSON-RPC:
`initialize`, `tools/list`, `tools/call`, `ping`). Register it with an agent as a stdio
server:

```json
{
  "mcpServers": {
    "xtend": { "command": "node", "args": ["/path/to/xtend/apps/server/src/bin.ts", "mcp"] }
  }
}
```

| tool             | arguments                          | rpc                                     |
| ---------------- | ---------------------------------- | --------------------------------------- |
| `draft_post`     | `text`                             | `compose.draftCreate`                   |
| `queue_post`     | `text`                             | `compose.draftCreate` then `plan.queue` |
| `report_handle`  | `handle`                           | `scores.report`                         |
| `search_library` | `query`, `mode?` (`top`, `latest`) | `library.search` (paid unless cached)   |
| `spend_summary`  |                                    | `spend.summary`                         |

Tool results are the rpc's JSON as text content; an rpc error comes back as `isError: true`
with the message, never as a protocol error. A line that is not JSON or a request without a
method gets a JSON-RPC error (-32700, -32600), so a client never waits on an answer. The implementation is
`apps/server/src/cli/mcp.ts`; it is hand-rolled because the three methods above are the whole
protocol surface this needs.
