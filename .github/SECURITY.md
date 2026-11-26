# Security policy

Report a vulnerability privately through
[GitHub's advisory form](https://github.com/EhsanulHaqueSiam/xtend/security/advisories/new)
(Security, Report a vulnerability). Do not open a public issue, PR or comment about it until a fix
has shipped. Include the version, the steps, and what an attacker gains. Leave out your own
tokens, cookies and handles; a reproduction on a fresh `pnpm dev` home is enough.

## In scope

- **The service's auth.** The token in `<base dir>/auth-token`, device tokens from pairing links,
  the Origin check, and anything that lets a web page, another local user or a network peer call
  the service's WebSocket or `/api/rpc` without them, including a service started with `--host`.
- **The session view's gating.** Anything that loads a non-x.com page into the X webview, reaches
  the account's cookie partition from outside it, gives the webview Node access, or makes the
  session press like, reply, post or follow without the user's click.
- **treg token handling.** The treg token leaking into traces, `service.log`, `desktop.log`, a
  triage folder, an OTLP export, the WebSocket or HTTP API, or past the monthly budget check.
- **Secrets in diagnostics.** Tokens, X cookies, assist keys or webhook secrets surviving the
  scrubbing in `packages/contracts/src/redact.ts`.
- **Automation webhooks.** Firing a rule without a valid signature.
- **The pool worker** (`infra/pool`): reading or writing data you should not, defeating its rate
  limits, or tying an install id to a person.

## Out of scope

- X's own site and API, treg's service, and the model CLIs Xtend calls; report those to their
  owners.
- Anything that needs the attacker to already read the user's base dir, browser profile or memory
  (a heap snapshot holds every token by design).
- A service the user exposed beyond loopback or their tailnet on purpose.
- Spending within a budget the user set, and X account limits or suspensions.
- Missing hardening without a working attack, and automated scanner output.
