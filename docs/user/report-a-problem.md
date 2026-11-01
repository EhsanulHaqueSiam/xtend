# Report a problem

When Xtend misbehaves (the app will not open, the service will not start, a screen fails, a post
did not go out), triage hands the problem to a coding agent on your own machine. It reads the
logs, finds the cause in Xtend's source, tells you how to fix it, and drafts a GitHub issue if one
is warranted.

## Start it

From a terminal:

```sh
xtend triage                  # writes the triage folder and prints how to start an agent
xtend triage --agent claude   # or --agent codex: starts that CLI in the folder
```

From the app: **Settings**, Diagnostics, **Start triage**. It writes the same folder and shows the
line to paste into a terminal. **Copy triage context** copies the facts alone, for any agent or
chat you prefer.

If the app cannot reach its service, the page it shows instead says the same: run
`xtend triage` in a terminal on the service's machine.

## What it collects

A folder under `~/.xtend/triage/<time>/` with two files:

- `context.md`: the Xtend, Node and OS versions; whether the app, launchd or a shell runs the
  service and whether it answers; where the database, trace file and logs are; the checks
  `xtend doctor` runs; a summary of the last hour of the trace file (which operations ran, how
  long they took, which failed); and the service's memory and CPU.
- `PLAYBOOK.md`: what the agent does and the lines it never crosses.

Tokens, cookies, keys and post text are scrubbed before anything is written. The agent then reads
the trace file, `service.log` and the desktop's `desktop.log` itself, on your machine.

## What stays on your machine

Triage sends nothing anywhere and costs nothing. The agent runs on your own `claude` or `codex`
login. It is told never to act on X, never to spend from your treg balance, never to write to
your database, never to read your tokens or X cookies, and to show you any issue in full and wait
for your yes before posting it.
