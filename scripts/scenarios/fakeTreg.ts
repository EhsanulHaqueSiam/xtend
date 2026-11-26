// treg, the shared pool and an OpenAI-compatible model in one local server, for the e2e journeys
// and for `pnpm dev`, so neither ever spends the user's balance, writes to other installs' trends
// or runs a model. Only node builtins: the dev runner imports it straight from source.
import * as NodeEvents from "node:events";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";

/** One request the service sent to treg. */
export interface TregCall {
  readonly method: string;
  /** What follows `/call/`: a catalog id or an own-account path such as `x/2/tweets`. */
  readonly endpoint: string;
  readonly body: unknown;
}

/**
 * What the fake bills, deliberately off the rate card: a meter that moves by these amounts read
 * treg's cost header, not the price quoted before the call.
 */
export const CHARGE = { post: 0.25, search: 0.002 } as const;

/** The first search result, as anyapi sends it (XClient's postFromAnyapi reads this shape). */
export const SEARCH_HIT = {
  id: "1990000000000000001",
  url: "https://x.com/builder/status/1990000000000000001",
  text: "Ship small, ship daily. Compounding does the rest.",
  createdAt: "2026-10-20T09:00:00.000Z",
  authorId: "42",
  authorUsername: "builder",
  authorName: "Builder",
  authorFollowers: 12000,
  viewCount: 50000,
  likeCount: 900,
  retweetCount: 80,
  replyCount: 40,
  quoteCount: 5,
  bookmarkCount: 120,
};

const FILLER = [
  "The fastest way to grow is to reply under the people your audience already reads.",
  "Wrote 300 words a day for a year. The archive is now my best salesperson.",
  "Pricing page rewrite took an afternoon and doubled trial starts. Test your copy.",
  "Nobody cares about your launch day. They care about day 30.",
];

/** A few more posts after SEARCH_HIT, so dev screens show a list; ids stay clear of SEARCH_HIT's. */
const morePosts = (handle?: string) =>
  FILLER.map((text, i) => ({
    ...SEARCH_HIT,
    id: `199000000000000010${i}`,
    url: `https://x.com/${handle ?? `founder${i}`}/status/199000000000000010${i}`,
    text,
    authorId: String(100 + i),
    authorUsername: handle ?? `founder${i}`,
    authorName: handle ?? `Founder ${i}`,
    viewCount: 8_000 * (i + 1),
    likeCount: 120 * (i + 1),
  }));

/** The pool worker's answers, empty: an install id, accepted pushes and no trends. */
const POOL_ANSWERS: Record<string, unknown> = {
  "/register": { installId: "fake" },
  "/push": {},
  "/trends/hot": { posts: 0, installs: 0, rows: [] },
  "/trends/rising": { rows: [] },
};

type Json = { readonly [key: string]: unknown };
const isJson = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** The smallest value a JSON Schema accepts, so a structured assist call decodes. */
const sampleOf = (schema: unknown): unknown => {
  if (!isJson(schema)) return null;
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  const branches = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(branches)) return sampleOf(branches[0]);
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === "object" || isJson(schema.properties)) {
    const props = isJson(schema.properties) ? schema.properties : {};
    return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, sampleOf(v)]));
  }
  if (type === "array") {
    const min = typeof schema.minItems === "number" ? schema.minItems : 1;
    return Array.from({ length: Math.max(1, min) }, () => sampleOf(schema.items));
  }
  if (type === "string") return "A sample answer from the fake model.";
  if (type === "number" || type === "integer")
    return typeof schema.minimum === "number" ? schema.minimum : 1;
  if (type === "boolean") return false;
  return null;
};

/** The reply for one treg call: status, billed cost and body, in the shapes XClient parses. */
const answerFor = (call: TregCall, posted: Array<string>, nextPostId: () => string) => {
  const ok = (body: unknown, cost = 0) => ({ status: 200, cost, body });
  const { method, endpoint } = call;
  const body = isJson(call.body) ? call.body : {};
  if (method === "POST" && endpoint === "x/2/tweets") {
    posted.push(nextPostId());
    return { status: 201, cost: CHARGE.post, body: { data: { id: posted.at(-1) } } };
  }
  if (endpoint === "anyapi.x.search.posts")
    return ok(
      { output: { data: { items: [SEARCH_HIT, ...morePosts()], nextCursor: null } } },
      CHARGE.search,
    );
  if (endpoint === "anyapi.x.user.posts.timeline") {
    const handle = typeof body.handle === "string" ? body.handle : "builder";
    return ok({ output: { data: { tweets: morePosts(handle), nextCursor: null } } }, CHARGE.search);
  }
  if (endpoint === "anyapi.x.user.profile") {
    const handle = typeof body.handle === "string" ? body.handle : "builder";
    return ok({
      output: {
        found: true,
        data: {
          id: "42",
          handle,
          displayName: handle,
          bio: "Building small products in public.",
          followers: 12_000,
          following: 640,
          tweets: 4_200,
          verified: false,
          createdUtc: 1_420_070_400,
          location: "",
          website: "",
        },
      },
    });
  }
  if (endpoint.startsWith("tikhub.x.twitter-web-fetch-user-followers"))
    return ok({ data: { followers: [], more_users: false } });
  if (endpoint.startsWith("tikhub.x.twitter-web-fetch-trending"))
    return ok({ data: { trends: [{ name: "#buildinpublic", context: null, tweet_count: 1200 }] } });
  if (endpoint === "x/2/users/me")
    return ok({ data: { id: "1234567", username: "siam", name: "Siam" } });
  if (/^x\/2\/users\/\d+\/mentions$/.test(endpoint))
    return ok({ data: [], includes: { users: [] }, meta: { result_count: 0 } });
  return { status: 404, cost: 0, body: { error: `not faked: ${method} ${endpoint}` } };
};

/**
 * Starts the fake on a free loopback port. Every treg call is recorded so a test can assert what
 * was, and was not, paid for; pool and model requests are answered but not recorded.
 */
export async function startFakeTreg(port = 0) {
  const calls: Array<TregCall> = [];
  /** The post ids X "returned", in order, so a test checks the app against X rather than itself. */
  const posted: Array<string> = [];
  let nextPostId = 1990000000000000100n;
  const server = NodeHttp.createServer(async (request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://treg");
    // XTEND_POOL_URL points here too, so nothing reads or writes the shared pool.
    const pool = POOL_ANSWERS[pathname];
    if (pool !== undefined) return void response.end(JSON.stringify(pool));
    let text = "";
    for await (const chunk of request) text += chunk;
    const parsed: unknown = text === "" ? null : JSON.parse(text);
    // The assist endpoint (`assist_base_url` = this server): any schema gets its smallest answer.
    if (pathname.endsWith("/chat/completions")) {
      const format = isJson(parsed) && isJson(parsed.response_format) ? parsed.response_format : {};
      const schema = isJson(format.json_schema) ? format.json_schema.schema : {};
      const content = JSON.stringify(sampleOf(schema));
      response.writeHead(200, { "content-type": "application/json" });
      return void response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    }
    // Only the service's /call/ requests count: other local processes probe a reused port too.
    if (!pathname.startsWith("/call/")) return void response.writeHead(404).end();
    const call: TregCall = {
      method: request.method ?? "GET",
      endpoint: pathname.slice("/call/".length),
      body: parsed,
    };
    calls.push(call);
    const { status, cost, body } = answerFor(call, posted, () => String(nextPostId++));
    response.writeHead(status, {
      "content-type": "application/json",
      "x-treg-cost-usd": String(cost),
    });
    response.end(JSON.stringify(body));
  });
  server.listen(port, "127.0.0.1");
  await NodeEvents.EventEmitter.once(server, "listening");
  const address = server.address() as NodeNet.AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    calls,
    posted,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
