import { Events_METHODS, WsRpcGroup } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Atom from "effect/reactivity/Atom";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcTest from "effect/rpc/RpcTest";
import * as Stream from "effect/Stream";

import { clientRuntime, XtendClient } from "../src/rpc/client";

type Rpcs = RpcGroup.Rpcs<typeof WsRpcGroup>;
/** Like RpcGroup.HandlersFrom, but a fake needs no services. */
type Handlers = { readonly [Current in Rpcs as Current["_tag"]]: Rpc.ToHandlerFn<Current, never> };

/** The rpcs a test answers, typed by the contracts: `{ "plan.slotsGet": () => Effect.succeed({ slots }) }`. */
export type FakeService = Partial<Handlers>;

/**
 * The real rpc client and server, in memory, with `handlers` behind them. Live events
 * default to none; any other rpc dies with its name, so a test that forgot one says which.
 */
const layerFakeClient = (handlers: FakeService) => {
  const answered: FakeService = { [Events_METHODS.subscribe]: () => Stream.never, ...handlers };
  // The proxy fills in every rpc the test left out, which the type cannot see.
  const all = new Proxy(answered as Handlers, {
    get: (target, tag) =>
      target[tag as keyof Handlers] ??
      (() => Effect.die(new Error(`fake service: unexpected rpc ${String(tag)}`))),
  });
  return Layer.effect(XtendClient, RpcTest.makeClient(WsRpcGroup)).pipe(
    Layer.provide(WsRpcGroup.toLayer(Effect.succeed(all))),
  );
};

/**
 * Registry seed that swaps the socket client for the fake one, so every atom built on
 * clientRuntime reads from `handlers`. Used by render's `service` option.
 */
export const fakeServiceValues = (handlers: FakeService) => [
  Atom.initialValue(clientRuntime.layer, layerFakeClient(handlers)),
];
