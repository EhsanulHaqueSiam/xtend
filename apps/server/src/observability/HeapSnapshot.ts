// @effect-diagnostics nodeBuiltinImport:off -- v8.writeHeapSnapshot has no Effect equivalent.
import * as NodeV8 from "node:v8";

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

const SIGNAL = "SIGUSR2";

const write = Effect.fn("service.heapSnapshot", { root: true })(
  function* (logsDir: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stamp = DateTime.formatIso(yield* DateTime.now).replaceAll(":", "-");
    const file = path.join(logsDir, `service-${process.pid}-${stamp}.heapsnapshot`);
    yield* Effect.annotateCurrentSpan({ path: file });
    yield* fs.makeDirectory(logsDir, { recursive: true });
    yield* Effect.try(() => NodeV8.writeHeapSnapshot(file)).pipe(
      Effect.tapError(() => fs.remove(file, { force: true }).pipe(Effect.ignore)),
    );
    yield* Effect.logInfo("wrote heap snapshot", { path: file });
  },
  Effect.catch((cause) => Effect.logWarning("heap snapshot failed", { cause })),
);

/** `kill -USR2 <pid>` writes a V8 heap snapshot into the logs dir. Windows has no SIGUSR2. */
export const layer = (logsDir: string) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      if (process.platform === "win32") return;
      const runFork = Effect.runForkWith(
        yield* Effect.context<FileSystem.FileSystem | Path.Path>(),
      );
      const onSignal = () => void runFork(write(logsDir));
      yield* Effect.acquireRelease(
        Effect.sync(() => process.on(SIGNAL, onSignal)),
        () => Effect.sync(() => process.off(SIGNAL, onSignal)),
      );
    }),
  );
