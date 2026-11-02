// How much the engine bench may load X on one account. X rate-limits an account per 15 minutes,
// so the bench counts the X calls each round makes and keeps every checkout's rounds on the
// account under one budget per window. engine-bench.mjs asks before each round, from the results
// files every earlier run wrote (any branch), matched by a hash of the account's user id.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const MINUTE = 60_000;
const WINDOW_MS = 15 * MINUTE;
/** X calls per window: about two full rounds, the most the account has run at without a 429. */
export const BUDGET = 600;
/** A round with no count (recorded before rounds counted, or cut short) is taken as a full one. */
const UNCOUNTED = 300;
/** What a check costs before any round on the account has counted its calls. */
const PER_CHECK = 8;

/** The account's key in results files: never its handle or raw id. */
export const accountKey = (userId) =>
  NodeCrypto.createHash("sha256").update(`xtend-bench:${userId}`).digest("hex").slice(0, 16);

/**
 * Whether a round of about `planned` calls may start at `now`, given what earlier rounds spent
 * (`{ at, calls }`): it may while the window's calls plus `planned` stay within BUDGET, or once the
 * window is empty. Otherwise `until` is when enough of the oldest have left it.
 */
export function pace(spent, now, planned) {
  const recent = spent
    .filter((s) => s.at > now - WINDOW_MS && s.at <= now)
    .toSorted((a, b) => a.at - b.at);
  const used = recent.reduce((sum, s) => sum + s.calls, 0);
  if (recent.length === 0 || used + planned <= BUDGET) return { ok: true, used };
  let left = used;
  const fits = recent.find((s) => ((left -= s.calls), left + planned <= BUDGET || left === 0));
  return { ok: false, used, until: fits.at + WINDOW_MS };
}

/** The results under `dir`, for `account` (every account when it is undefined). */
function reports(dir, account) {
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
        return account === undefined || report.account === account ? [report] : [];
      } catch {
        return [];
      }
    });
  });
}

/**
 * Every round's X calls and when they last ran, in the results under `dir`, for `account` (any
 * account when it is undefined: the bench could not tell, so it paces against all of them). A
 * round still going counts what it planned from its start; a run that died before its first round
 * still loaded X.
 */
export function readSpent(dir, account) {
  return reports(dir, account).flatMap((report) => {
    const rounds = Array.isArray(report.runs) && report.runs.length > 0 ? report.runs : [report];
    return rounds
      .map((r) => ({
        at: Date.parse(r.endedAt ?? r.startedAt),
        calls: r.endedAt === undefined ? Math.max(r.planned ?? UNCOUNTED, r.calls ?? 0) : r.calls,
      }))
      .filter((s) => !Number.isNaN(s.at));
  });
}

/** About how many X calls `checks` checks make, from the account's counted rounds. */
export function estimate(dir, account, checks) {
  const counted = reports(dir, account)
    .flatMap((report) => report.runs ?? [])
    .filter((r) => typeof r.calls === "number" && r.checks?.length > 0);
  const calls = counted.reduce((sum, r) => sum + r.calls, 0);
  const done = counted.reduce((sum, r) => sum + r.checks.length, 0);
  return Math.ceil(checks * (done === 0 ? PER_CHECK : calls / done));
}

/**
 * Runs `fn` holding the pacing lock in `dir`, shared by every checkout, so checking the budget and
 * booking a round are one step. A lock left by a run that died expires after 30 seconds.
 */
export async function locked(dir, fn) {
  const lock = NodePath.join(dir, ".pace-lock");
  NodeFS.mkdirSync(dir, { recursive: true });
  for (;;) {
    try {
      NodeFS.mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - NodeFS.statSync(lock).mtimeMs > 30_000) NodeFS.rmdirSync(lock);
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  try {
    return await fn();
  } finally {
    NodeFS.rmSync(lock, { recursive: true, force: true });
  }
}

/** Many checks failing with the engine's lists empty: what X answering nothing looks like. */
export const looksRateLimited = (failuresWithEmptyLists) => failuresWithEmptyLists >= 5;
