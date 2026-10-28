# CLI, HTTP API and MCP

The service binary doubles as a CLI, serves an HTTP API, and speaks MCP. All three call the same
service methods the app does, so a post from a terminal costs and logs exactly what a click
does.

```
xtend                      run the service
xtend post "<text>"        draft and post now (paid)
xtend queue                drafts waiting in the queue
xtend report <handle>      score report as JSON (paid)
xtend spend                this month's spend against the budget
xtend agents run <name>    run a signal agent (paid)
xtend mcp                  MCP over stdio
xtend service install      keep the service running with the app closed (macOS launchd)
xtend service status | uninstall
```

The HTTP API is `POST /api/rpc/<method>` with the service token from `~/.xtend/auth-token` as
a bearer token. The MCP server offers `draft_post`, `queue_post`, `report_handle`,
`search_library` and `spend_summary` to any agent that speaks stdio. Details, method names and
error shapes are in the [API reference](../operations/api.md).

To reach a service on another machine, start it with `--host <tailnet ip>` and open its URL
once with `?token=` in a browser, or point the desktop at it from Settings, Service.
