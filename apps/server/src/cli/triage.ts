import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as ChildProcess from "effect/process/ChildProcess";

import * as Triage from "../triage/Triage.ts";

export const TRIAGE_AGENTS = ["claude", "codex"] as const;
type Agent = (typeof TRIAGE_AGENTS)[number];

/** The agent's interactive session in the triage folder, with the playbook as its first prompt. */
export const agentCommand = (agent: Agent, dir: string) =>
  ChildProcess.make(agent, [Triage.LAUNCH_PROMPT], {
    cwd: dir,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

/** `xtend triage`: writes the folder, then starts the agent named, or says how to. */
export const runTriage = Effect.fn("cli.triage")(function* (agent: Option.Option<Agent>) {
  const triage = yield* Triage.Triage;
  const prepared = yield* triage.prepare("cli");
  yield* Console.log(
    `Wrote ${prepared.dir}\n  context.md   this machine's facts, already scrubbed\n  PLAYBOOK.md  what the agent does`,
  );
  if (Option.isNone(agent))
    return yield* Console.log(
      `\nStart a coding agent there:\n  ${prepared.start.claude}\n  ${prepared.start.codex}\n\nOr run \`xtend triage --agent claude\`, or paste both files into any agent.`,
    );
  yield* Console.log(`\nStarting ${agent.value}. It will ask what went wrong.\n`);
  const exitCode = yield* Effect.scoped(
    Effect.flatMap(agentCommand(agent.value, prepared.dir), (child) => child.exitCode),
  );
  if (exitCode !== 0) yield* Effect.sync(() => (process.exitCode = exitCode));
});
