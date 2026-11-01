# Xtend

A desktop-first X growth suite. One app whose sidebar holds both X and the tools: x.com runs inside
it as your own logged-in session, Xtend draws its own Home, posts, profiles, search and lists from
it, and a local service adds analytics, a composer with a queue, a viral library, engagement
targets, lead lists, automations and account scores. A headless service owns the data and every X
call; the Electron app and the web app are clients, as in T3 Code.

## Run

```sh
pnpm i
pnpm dev                          # service + web, seeded demo data, treg and AI faked
pnpm dev --fixture x-screens      # a named UI state; X screens replayed without the desktop
pnpm dev:desktop                  # the Electron shell against the running dev service
pnpm check:changed                # CI's checks for what you changed
```

## Where to read next

- [CONTRIBUTING.md](CONTRIBUTING.md): the path a change takes, from problem to release.
- [AGENTS.md](AGENTS.md): the rules, the glossary and where code lives.
- [Development](docs/operations/development.md): setup, dev data and fixtures, checks, CI and
  releases.
- [Internals](docs/internals/): the architecture's decisions (`overview.md`, `native-shell.md`,
  `effect-services.md`, `testing.md`).
