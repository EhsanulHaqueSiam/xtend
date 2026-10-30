import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as ChildProcess from "effect/process/ChildProcess";
import * as Stream from "effect/Stream";

const MARKER = "__XTEND_PATH__";

/** The login shell's PATH entries first, then the service's own, each once. */
export const mergePath = (login: string | undefined, current: string | undefined) =>
  [...new Set([...(login ?? "").split(":"), ...(current ?? "").split(":")])]
    .filter((entry) => entry !== "")
    .join(":");

/**
 * PATH as the user's login shell sets it, the way T3 Code's desktop hydrates its own. A service
 * the desktop started from Finder, or launchd started, inherits `/usr/bin:/bin`, where neither
 * `claude` nor `codex` (npm under mise or nvm, Homebrew) lives. Falls back to the service's PATH.
 */
export const loginPath = Effect.gen(function* () {
  const shell = process.env.SHELL ?? "/bin/zsh";
  const child = yield* ChildProcess.make(
    shell,
    // The marker keeps rc-file chatter on stdout out of the value.
    ["-ilc", `printf '\\n${MARKER}%s\\n' "$PATH"`],
    { stdin: "ignore", stderr: "ignore" },
  );
  const out = yield* child.stdout.pipe(Stream.decodeText(), Stream.mkString);
  return new RegExp(`${MARKER}(.*)`).exec(out)?.[1];
}).pipe(
  Effect.scoped,
  Effect.timeoutOrElse({ duration: Duration.seconds(5), orElse: () => Effect.undefined }),
  Effect.orElseSucceed(() => undefined),
  Effect.map((login) => mergePath(login, process.env.PATH)),
);
