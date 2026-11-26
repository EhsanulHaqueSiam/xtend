import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

// `alchemy dev` runs the worker on this machine against a local Postgres: Cloudflare never returns
// the live Hyperdrive origin's password, so dev needs one of its own.
//   XTEND_POOL_DEV_URL=postgres://postgres:pass@127.0.0.1:5432/pool pnpm --filter @xtend/pool dev
const devOrigin = ({ hostname, port, username, password, pathname }: URL) => ({
  scheme: "postgres" as const,
  host: hostname,
  port: Number(port || 5432),
  // Kept percent-encoded: alchemy splices them into the connection string the driver parses.
  user: username,
  password: Redacted.make(password),
  database: pathname.slice(1),
  sslmode: "disable" as const,
});

const limit = (name: string, namespaceId: string, perMinute: number) =>
  Cloudflare.RateLimit(name, { namespaceId, simple: { limit: perMinute, period: 60 } });

const pool = (dev: ReturnType<typeof devOrigin> | undefined) =>
  Cloudflare.Worker("Pool", {
    // The live worker's name, never derived from the stage: another name would be a second worker.
    name: "xtend-pool",
    main: "./src/index.ts",
    // nodejs_compat is on by default from this date; naming it too is rejected by Cloudflare.
    compatibility: { date: "2026-10-01" },
    observability: { enabled: true },
    // Neon bills by the minute awake and sleeps 5 minutes after the last query: one wake an hour.
    crons: ["0 * * * *"],
    env: {
      // The Neon pool through Hyperdrive. Alchemy only reads this config, never creates, changes or
      // deletes it: the connection string stays in Cloudflare.
      POOL: Cloudflare.Hyperdrive.lookup("POOL", {
        hyperdriveId: "395fa092434e4c5db9ae48c478653157",
        ...(dev === undefined ? {} : { dev }),
      }),
      REGISTER: limit("REGISTER", "1001", 5),
      PUSH: limit("PUSH", "1002", 30),
      PUSH_ADDRESS: limit("PUSH_ADDRESS", "1003", 60),
      // Pushes wait in one SQLite-backed object (free plan) until the hourly flush. The adopting
      // deploy finds the live object by this binding name and class, so both must stay as they are.
      BUFFER: Cloudflare.DurableObject("PoolBuffer"),
    },
  });

// Plan and deploy keep state in the account, as T3 Code does, so it outlives the worktree that ran
// them. Dev keeps it in .alchemy/ (gitignored): dev would otherwise create the store in the account.
const state = Layer.unwrap(
  Effect.map(Alchemy.AlchemyContext, ({ dev }) =>
    dev ? Alchemy.localState() : Cloudflare.state(),
  ),
);

export default Alchemy.Stack(
  "XtendPool",
  { providers: Cloudflare.providers(), state },
  Effect.gen(function* () {
    // The dev URL is read only under dev: a plan or deploy would save its password in the state.
    const { dev } = yield* Alchemy.AlchemyContext;
    const devUrl = dev ? process.env.XTEND_POOL_DEV_URL : undefined;
    // Never deleted, even by `alchemy destroy` or a rename: it holds the buffered pushes.
    const worker = yield* pool(devUrl === undefined ? undefined : devOrigin(new URL(devUrl))).pipe(
      Alchemy.RemovalPolicy.retain(),
    );
    return { workerName: worker.workerName, url: worker.url };
  }),
);
