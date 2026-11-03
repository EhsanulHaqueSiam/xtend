import {
  Devices_METHODS,
  DevicesRpcGroup,
  PAIR_PATH,
  PairRedeem,
  PairRedeemed,
} from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as DeviceStore from "./DeviceStore.ts";

export const layer = DeviceStore.layer;

export const layerHandlers = DevicesRpcGroup.toLayer(
  Effect.gen(function* () {
    const devices = yield* DeviceStore.DeviceStore;
    return DevicesRpcGroup.of({
      [Devices_METHODS.list]: () => devices.list,
      [Devices_METHODS.hello]: (input) => devices.hello(input),
      [Devices_METHODS.update]: (input) => devices.update(input),
      [Devices_METHODS.remove]: ({ id }) => Effect.as(devices.remove(id), {}),
      [Devices_METHODS.pair]: () => devices.pair,
    });
  }),
);

const encodeRedeemed = Schema.encodeSync(PairRedeemed);

/** A joining desktop trades its pairing code for a token here; it has no token to send yet. */
export const layerPairRoute = HttpRouter.add(
  "POST",
  PAIR_PATH,
  Effect.gen(function* () {
    const input = yield* HttpServerRequest.schemaBodyJson(PairRedeem);
    const devices = yield* DeviceStore.DeviceStore;
    return yield* HttpServerResponse.json(encodeRedeemed(yield* devices.redeem(input)));
  }).pipe(
    Effect.catchTags({
      SchemaError: () => HttpServerResponse.json({ error: "invalid_pairing" }, { status: 400 }),
      DevicesError: (error) =>
        HttpServerResponse.json(
          { error: error._tag, message: error.detail },
          { status: error.operation === "redeem" ? 403 : 500 },
        ),
    }),
  ),
);
