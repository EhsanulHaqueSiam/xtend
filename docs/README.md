# Xtend docs

## Using Xtend

New to Xtend? Start with the **[user guide](./user/README.md)**: what Xtend does, how to install
it, what costs money, and a guide for every tool.

---

## Working on Xtend

Start with the [development runbook](./operations/00_development.md),
[CONTRIBUTING.md](../CONTRIBUTING.md) and [AGENTS.md](../AGENTS.md).

Internal docs preserve architectural decisions, trust boundaries, conventions and cross-cutting
traps that the source alone does not explain. Most code changes do not need an internal
documentation update. Follow the [documentation rules](../AGENTS.md#documentation) before adding
anything.

### Internals (in reading order)

- [00 · Glossary](./internals/00_glossary.md)
- [01 · Architecture](./internals/01_architecture.md)
- [02 · Effect services](./internals/02_effect-services.md)
- [03 · Native shell: the app as the window, x.com as a webview in it](./internals/03_native-shell.md)
- [04 · Design system](./internals/04_design.md)
- [05 · The shared pool](./internals/05_pool.md)
- [06 · Hosted web tier, design only](./internals/06_hosted.md)
- [07 · Testing](./internals/07_testing.md)

### Runbooks

- [00 · Development and local builds](./operations/00_development.md)
- [01 · Dev container](./operations/01_devcontainer.md)
- [02 · API, CLI and MCP](./operations/02_api.md)
- [03 · Observability](./operations/03_observability.md)
- [04 · Pool database](./operations/04_pool.md)
- [05 · X parity: finding X's own flows on Mobbin](./operations/05_x-parity-mobbin.md)
