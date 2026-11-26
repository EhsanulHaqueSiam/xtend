# Evals

An eval runs a real model against Xtend's real model-facing text and scores what the model does. Use one where a unit test cannot help: model output changes from run to run, and a small wording change can move it.

In Xtend that text is the AI assist instructions. Screens call `ai/Assist.ts` with instructions, input and an output schema. Write or run an eval when a change touches what a model sees: a screen's instructions, Assist's base prompt or tones, the input a screen sends, or an output schema.

| Eval                          | Measures                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [reply-angles](reply-angles/) | Whether the Angles chooser (`engage.readPost`) reads the post right and writes replies that keep its rules. |

## Run an eval

1. Run `pnpm i` at the repo root.
2. Sign in to the Claude or Codex CLI on this machine. Evals run through Assist the way the service does, on your own login, so they need no API key.
3. From `evals/`, run `pnpm <eval> --out runs/<name>`. `runs/` is gitignored.

Each eval's README lists its flags and cost. Start with one case and one sample to check the setup.

Evals spend model quota and vary from run to run, so CI does not run them. CI typechecks this package and runs the graders' unit tests.

## The shape of an eval

- `evals/<eval>/run.ts` is the entry point. `package.json` has a script with the eval's name.
- `evals/<eval>/README.md` says what the eval measures, how to run it, how to add a case, and what a run costs.
- Cases are data, in `cases.ts`. Each case has an `id`, names its source (a PR or commit, or `control`), and its checks.
- The eval imports the code under test from source: the screen's exported request builder and Assist's own layer. Never copy instructions or schemas into an eval. Then the eval always tests the current text. If a screen builds its request inline, export the builder from the screen's module without changing behavior.
- Flags: `--out <dir>` (required), `--model <id>`, `--case <ids>`, `--samples N`, and `--baseline <earlier results.ndjson>` to compare.
- A run writes `results.ndjson` (one row per sample, with the model's answer) and `summary.md` to `--out`.
- `grade.ts` is plain logic, and `run.test.ts` tests it. It runs in CI.

## Rules for cases

- A case reproduces a real bad experience, or guards a real good one. Name its source.
- Add the case before the fix. It must fail on the old text and pass on the new text.
- If you change a case, the changed case must still fail on the text it was written against. Prefer fixing the instructions over loosening a case.
- Add controls: ordinary posts where the right answer is ordinary work. They catch a fix that overcorrects.
- Model output varies. Run each case several times. A case fails when half or more of its samples fail. Compare against a baseline on the same model, not against an absolute score.
- No user data in cases. Invent handles like `acme_dev` and write the posts yourself. Never paste a real account's posts or replies.

## Cost

A run spends your Claude or Codex login's quota, not treg or an API key. Run only the cases your change touches until they pass, then one full run before the PR merges. Each summary records the sample count and model time.

## Add an eval

1. Copy the shape above from `reply-angles/`.
2. Add a script to `package.json`, a README, and a row to the table above.
3. When a second eval needs code that one eval already has (the Assist layer, sampling, the summary), move it to `evals/shared/` and use it from both. Do not build shared code before a second eval needs it.
