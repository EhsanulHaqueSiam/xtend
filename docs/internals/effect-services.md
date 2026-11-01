# Effect services

Service features are Effect services. Transports call them: WebSocket RPC handlers (each area's
`<Area>Handlers.ts`, merged in [`ws.ts`](../../apps/server/src/ws.ts)), HTTP routes
([`http.ts`](../../apps/server/src/http.ts)), MCP tools and CLI commands
([`cli/`](../../apps/server/src/cli)), and scheduled jobs. This page holds the rules for writing
them, adapted from T3 Code's. Lint enforces part of it (`xtend/prefer-effect-fn`,
`xtend/prefer-catch-tags`, `xtend/no-inline-schema-compile`, `xtend/namespace-node-imports`).

## Where a feature lives

A capability is a method on a service in its area folder (`compose/`, `library/`, `automate/`, ...).
Extend the service that already owns the area; add a new one only when none does.

A transport handler does three things: decode the request, call one service method, and map the
service's typed errors to the transport's error. Nothing else. Persistence, X calls, multi-step
dispatch, retries, budgets and rollback belong in the service.

The reason is reach. The user triggers a capability from a screen, an agent through MCP, a rule or
a scheduled job unattended, the CLI from a terminal. Logic written into one handler is missing from
the others, and testing it needs a socket. Plain functions for pure work are fine next to the
service; the capability itself is the method.

X and treg are reached only through [`x/XClient.ts`](../../apps/server/src/x/XClient.ts) and
[`x/Treg.ts`](../../apps/server/src/x/Treg.ts). No `fetch` to X, treg or a provider anywhere else,
no token read outside `Treg.ts`, and every `XClient` call names its `purpose`.

## Shape of a service module

One module per service, in this order: imports, errors and schemas, the `Context.Service` tag with
its interface inline, `make`, then `layer`.
[`SettingsStore.ts`](../../apps/server/src/settings/SettingsStore.ts) and
[`Treg.ts`](../../apps/server/src/x/Treg.ts) are references.

- **Imports.** Effect modules as namespaces from their subpaths: `import * as Effect from
  "effect/Effect"`, never `import { Effect } from "effect"`. Service modules the same way:
  `import * as DraftStore from "./DraftStore.ts"`, then `yield* DraftStore.DraftStore` and
  `DraftStore.layer`. Never `import { layer as draftLayer }`. Named imports are fine for
  `@xtend/contracts` and for a pure helper, error, schema or type.
- **Interface.** No standalone `FooShape`; name the type `Foo["Service"]`.
- **Dependencies** come from the environment (`yield* SettingsStore.SettingsStore`), never as
  parameters to `make`, so the types of `make` and `layer` show what they need. Never hide one in a
  module global or a closure over a singleton. Tests may pass service instances directly.
  Configuration and immutable values are fine as parameters.
- **`make`** stays private unless another module imports it; knip fails CI on an unused export. Use
  the layer constructor that fits (`Layer.effect`, `Layer.succeed`, `Layer.sync`).
- **Moves.** Moving a service deletes the old file and updates every consumer, tests included. No
  re-export shims.
- **Tests** exercise behavior through the service, with test layers only for external dependencies
  (treg, X, the model CLI). Don't mock the logic under test. See [Testing](testing.md).

## Effect functions and tracing

Reusable functions use `Effect.fn("Service.operation")`, not an arrow returning `Effect.gen`: the
named form creates a span. Keep `Effect.gen` for inline programs and layer construction. Use
`Effect.fnUntraced` only for per-event work or helpers already covered by the operation's span, and
say why beside it. Pass combinators after the generator body; use `Effect.fn.Return<A, E, R>` when
the generator needs an explicit return type.

## Runtime boundaries

`ManagedRuntime.make`, `runPromise` and `runPromiseExit` belong at application boundaries: React
(the web client's atoms), Electron main, the CLI, HTTP adapters. Never in a service, store or
service constructor. Compose a shared resource once in an application-owned layer instead of a
runtime per feature.

## Errors

- **Attributes.** Failures are `Schema.TaggedError` classes with bounded attributes: the operation,
  the entity id, a category or status. The message is fixed or built from those, never from `cause`.
- **Cause.** An error that wraps a failure keeps the underlying error as `cause`.
- **Safe values.** No raw payloads, post text, tokens, cookies, signed URLs or query strings in
  attributes or logs; the exact value lives only in `cause`. Expose a length, count or host instead.
- **Translation.** Construct the error where the failure happens; map it to a transport error only
  in the transport. Don't wrap a whole pipeline in one generic error.
- **Mappers.** No helper that only does `(...args) => new SomeError({ ...args })`.
- **Predicates** are `export const isFoo = Schema.is(Foo)`.
- **Catching.** Known tags with `Effect.catchTags({ ... })`, even for one tag. `Effect.catch` is for
  the whole channel.

## Before you push

- Does any handler you touched do more than decode, call, and map errors?
- Can an agent (MCP), the CLI and a scheduled job reach this capability? If not, is that deliberate?
- Does anything paid run without its cost shown first and a budget cap?
- Did you run knip? A new export with no importer fails it.
- Does every lint, type-checker or LSP suppression you added say why?
