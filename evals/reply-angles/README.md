# Reply angles

Runs the Angles chooser's request (`readPostRequest` in [`apps/server/src/engage/Engage.ts`](../../apps/server/src/engage/Engage.ts), task `engage.readPost`) through Assist on invented posts, and checks each answer against what the instructions promise.

Every answer gets these checks (`grade.ts`): a read of 2 to 4 words, 1 to 3 signals, 3 or 4 angles, each under 280 characters, no hashtag, no em dash, no flattering opener, a label that names a move rather than a mood word, no two angles opening with the same three words, and no angle that copies a top reply (half its words or more). A case can add its own: what the read must say (a sarcastic post, a user's correction), or a pattern every angle must match (the post's language).

Assist runs on an empty settings store, so the user's voice notes and keywords are blank, and no images are sent. Checks measure the rules, not taste: read `results.ndjson` to judge whether the angles are any good.

## Run

```sh
cd evals
pnpm reply-angles --out runs/baseline
pnpm reply-angles --out runs/after --case skip-top-replies --baseline runs/baseline/results.ndjson
```

- `--provider claude|codex` (default `claude`) picks the CLI login, as Settings, Writing does. `--model <id>` passes a model to it; the default is the CLI's own.
- `--case <id>` (repeatable), `--samples N` (default 3), `--concurrency N` (default 3).
- `summary.md` gives the instructions' hash and word count, then per case: pass or FAIL with passing samples, the baseline's, and every distinct failure.
- Cost: one CLI call per sample, about 10 seconds each. A full run is 18 calls on your login's quota, no API key.

## Add a case

Add an entry to `cases.ts` with an invented post. Name the PR or commit whose behavior it guards, or `control`. Put what the case needs beyond the shared checks in `expect`.
