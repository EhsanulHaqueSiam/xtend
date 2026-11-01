// How often the engine bench may load X on one account: each run is a few hundred calls, and X
// rate-limits an account per 15 minutes. engine-bench.mjs asks before it starts, from the
// results files every earlier run wrote (any branch), matched by a hash of the account's user id.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const MINUTE = 60_000;
const GAP_MS = 5 * MINUTE;
const WINDOW_MS = 30 * MINUTE;
const MAX_IN_WINDOW = 4;

/** The account's key in results files: never its handle or raw id. */
export const accountKey = (userId) =>
  NodeCrypto.createHash("sha256").update(`xtend-bench:${userId}`).digest("hex").slice(0, 16);

/**
 * Whether a run may start at `now` given earlier runs' start times (ms): not within GAP_MS of the
 * last, and not while more than MAX_IN_WINDOW started in the last WINDOW_MS. `until` is when it may.
 */
export function pace(starts, now) {
  const recent = starts.filter((t) => t > now - WINDOW_MS && t <= now).toSorted((a, b) => a - b);
  const waits = [];
  if (recent.length > 0 && now - recent.at(-1) < GAP_MS)
    waits.push({ until: recent.at(-1) + GAP_MS, why: "the last run started under 5 minutes ago" });
  if (recent.length > MAX_IN_WINDOW)
    waits.push({
      // Once enough of the oldest leave the window that MAX_IN_WINDOW remain.
      until: recent[recent.length - MAX_IN_WINDOW - 1] + WINDOW_MS,
      why: `${recent.length} runs started in the last 30 minutes`,
    });
  if (waits.length === 0) return { ok: true };
  const latest = waits.reduce((a, b) => (b.until > a.until ? b : a));
  return { ok: false, until: latest.until, why: waits.map((w) => w.why).join(" and ") };
}

/**
 * Every round's start time in the results under `dir`, for `account` (any account when it is
 * undefined: the bench could not tell, so it paces against all of them).
 */
export function readStarts(dir, account) {
  let branches = [];
  try {
    branches = NodeFS.readdirSync(dir);
  } catch {
    return [];
  }
  return branches.flatMap((branch) => {
    let files = [];
    try {
      files = NodeFS.readdirSync(NodePath.join(dir, branch)).filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }
    return files.flatMap((file) => {
      try {
        const report = JSON.parse(NodeFS.readFileSync(NodePath.join(dir, branch, file), "utf8"));
        if (account !== undefined && report.account !== account) return [];
        const rounds = Array.isArray(report.runs) ? report.runs.map((r) => r.startedAt) : [];
        // A run that died before its first round still loaded X.
        return (rounds.length > 0 ? rounds : [report.startedAt])
          .map((at) => Date.parse(at))
          .filter((t) => !Number.isNaN(t));
      } catch {
        return [];
      }
    });
  });
}

/** Many checks failing with the engine's lists empty: what X answering nothing looks like. */
export const looksRateLimited = (failuresWithEmptyLists) => failuresWithEmptyLists >= 5;
