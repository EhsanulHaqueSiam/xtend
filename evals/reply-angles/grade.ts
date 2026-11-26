import type { PostRead } from "@xtend/contracts";

/** What a case adds to the checks every read gets. */
export type Expect = {
  /** The read must match, e.g. it names the sarcasm. */
  readonly read?: RegExp;
  /** Every angle's text must match, e.g. it is written in the post's script. */
  readonly everyAngle?: RegExp;
};

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

/** Share of distinct words two texts have in common (Jaccard). */
const overlap = (a: string, b: string) => {
  const left = new Set(words(a));
  const right = new Set(words(b));
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / (left.size + right.size - shared || 1);
};

// Openers that praise the post instead of replying to it.
const flattery =
  /^(great|love|awesome|amazing|brilliant|so true|well said|spot on|nailed it|this is (so )?(great|gold|spot on|huge)|100%)\b/i;
const hashtag = /(^|\s)#[\p{L}\p{N}_]+/u;
// At this word overlap an angle copies a top reply; below it, the two only share a topic.
const copied = 0.5;

/**
 * Grades one read against what engage.readPost's instructions promise. Returns every broken
 * promise, so a failure says which one.
 */
export const grade = (
  read: PostRead,
  context: { readonly topReplies: ReadonlyArray<string>; readonly expect?: Expect | undefined },
) => {
  const failures: Array<string> = [];
  const fail = (reason: string) => failures.push(reason);
  const readWords = words(read.read).length;
  if (readWords < 2 || readWords > 4) fail(`read is ${readWords} words`);
  if (read.signals.length < 1 || read.signals.length > 3) fail(`${read.signals.length} signals`);
  if (read.angles.length < 3 || read.angles.length > 4) fail(`${read.angles.length} angles`);
  const openings = new Set<string>();
  for (const [i, angle] of read.angles.entries()) {
    const at = `angle ${i + 1}`;
    if (angle.text.length > 280) fail(`${at} is ${angle.text.length} characters`);
    if (hashtag.test(angle.text)) fail(`${at} has a hashtag`);
    if (angle.text.includes("—")) fail(`${at} has an em dash`);
    if (flattery.test(angle.text.trim())) fail(`${at} opens with flattery`);
    if (words(angle.label).length < 2) fail(`${at} label "${angle.label}" is a mood word`);
    const opening = words(angle.text).slice(0, 3).join(" ");
    if (openings.has(opening)) fail(`${at} repeats the opening "${opening}"`);
    openings.add(opening);
    if (context.topReplies.some((reply) => overlap(angle.text, reply) >= copied))
      fail(`${at} repeats a top reply`);
    const every = context.expect?.everyAngle;
    if (every !== undefined && !every.test(angle.text)) fail(`${at} does not match ${every}`);
  }
  const expected = context.expect?.read;
  if (expected !== undefined && !expected.test(read.read))
    fail(`read "${read.read}" does not match ${expected}`);
  return { pass: failures.length === 0, failures };
};
