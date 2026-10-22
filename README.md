# Corvid

X, with a second brain. A desktop app that embeds x.com and adds analytics, a scheduler, a viral library, engagement targets, lead lists, automations and account scores around it. A headless service owns the data; the Electron app and a web app are clients.

Status: scaffold. The desktop opens x.com in the middle of the window and records the posts and metrics that scroll past into the local service, which the web UI lists.

## Run

```sh
pnpm i
pnpm dev          # service on 4820 + web on 5820
pnpm dev:desktop  # Electron shell against the dev web server
```

See `AGENTS.md` for the rules.
