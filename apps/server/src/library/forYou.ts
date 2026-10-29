import type { ForYouTopic, ObservedPostSummary, PoolRisingTerm } from "@xtend/contracts";

/**
 * For-you topics: rank what the session and the pool show against the user's own interests,
 * on this machine. Term overlap, no embeddings; nothing about the user leaves the service.
 */

const STOPWORDS = new Set(
  `a about above after again against all also am an and any are aren't as at be because been before being below
between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for
from further get gets got had hadn't has hasn't have haven't having he her here hers herself him himself his how i
if in into is isn't it it's its itself just let's like make made me more most much must my myself no nor not now of
off on once one only or other our ours ourselves out over own really same say says she should shouldn't so some
still such than that that's the their theirs them themselves then there there's these they they're this those
through to too under until up us very was wasn't way we we're were weren't what what's when where which while who
whom why will with won't would wouldn't you you're your yours yourself yourselves yes yeah lol via amp someone
something anyone anything everyone everything here's i'm i've i'll i'd you've you'll he's she's we've they've`.split(
    /\s+/,
  ),
);
/** Too common to be a topic alone, but they make one in a pair: "local first", "best practices". */
const WEAK = new Set(
  `day days today tonight time year years new good great best better people know want need going see look use using
used back first last next many well thing things think every never always`.split(/\s+/),
);

const MAX_TOPICS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A feed term this common in the window is the language, not a topic. */
const MAX_FEED_SHARE = 0.25;
/** A term nobody in the profile shares needs this many accounts before it counts. */
const MIN_AUTHORS_UNRELATED = 3;

/** Lowercased terms of one post: words and hashtags, then adjacent-word pairs. Each at most once. */
export const terms = (text: string): ReadonlyArray<string> => {
  const words: Array<string | null> = [];
  for (const m of text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/@\w+/g, " ")
    .matchAll(/[#$]?[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)) {
    const raw = m[0].replace(/['’]s$/, "");
    const word = raw.toLowerCase();
    // Two letters only as an acronym the author capitalised: AI, UX, VC.
    const short = word.length < 3 && !(raw.length === 2 && raw === raw.toUpperCase());
    words.push(STOPWORDS.has(word) || short || /^[\d#$]+$/.test(word) ? null : word);
  }
  const out = new Set<string>();
  words.forEach((w, i) => {
    if (w === null) return;
    if (!WEAK.has(w)) out.add(w);
    const next = words[i + 1];
    if (
      next != null &&
      !(WEAK.has(w) && WEAK.has(next)) &&
      !w.startsWith("#") &&
      !next.startsWith("#")
    )
      out.add(`${w} ${next}`);
  });
  return [...out];
};

export interface Interests {
  readonly keywords: ReadonlySet<string>;
  readonly own: ReadonlyMap<string, number>;
  readonly saved: ReadonlyMap<string, number>;
  /** Accounts the user replies to or saves; their posts count double in the feed. */
  readonly close: ReadonlySet<string>;
}

const count = (texts: ReadonlyArray<string>) => {
  const counts = new Map<string, number>();
  for (const t of texts) for (const term of terms(t)) counts.set(term, (counts.get(term) ?? 0) + 1);
  return counts;
};

export const interests = (input: {
  readonly keywords: ReadonlyArray<string>;
  readonly ownTexts: ReadonlyArray<string>;
  readonly savedTexts: ReadonlyArray<string>;
  readonly closeHandles: ReadonlyArray<string>;
}): Interests => ({
  keywords: new Set(input.keywords.flatMap((k) => [k.toLowerCase().trim(), ...terms(k)])),
  own: count(input.ownTexts),
  saved: count(input.savedTexts),
  close: new Set(input.closeHandles.map((h) => h.toLowerCase())),
});

/** 0 to 1, and the plain words saying why. */
const relevance = (profile: Interests, term: string) => {
  const why: Array<string> = [];
  let r = 0;
  // A pair counts for what either of its words counts for: "effect schema" is about "effect".
  const forms = [term, ...(term.includes(" ") ? term.split(" ") : [])];
  const most = (counts: ReadonlyMap<string, number>) =>
    Math.max(...forms.map((f) => counts.get(f) ?? 0));
  if (forms.some((f) => profile.keywords.has(f))) {
    r += 1;
    why.push("in your keywords");
  }
  const own = most(profile.own);
  if (own > 0) {
    r += Math.min(1, own / 3);
    why.push("you post about it");
  }
  const saved = most(profile.saved);
  if (saved > 0) {
    r += Math.min(0.5, saved / 4);
    why.push("in posts you saved");
  }
  return { score: Math.min(1, r), why };
};

/**
 * Feed topics (terms several accounts in the user's session posted in the last day) and pool
 * rising terms, both kept only when they touch the profile, best first; plus one `outside`
 * topic off the user's lane so the list does not become an echo chamber.
 */
export const rankTopics = (input: {
  readonly profile: Interests;
  readonly feed: ReadonlyArray<ObservedPostSummary>;
  readonly rising: ReadonlyArray<PoolRisingTerm>;
  readonly self: string | null;
  readonly nowMs: number;
}): ReadonlyArray<ForYouTopic> => {
  const { profile } = input;
  const recent = input.feed.filter(
    (p) =>
      input.nowMs - Date.parse(p.createdAt) < DAY_MS &&
      p.author.handle.toLowerCase() !== input.self?.toLowerCase(),
  );
  const authorsByTerm = new Map<string, Set<string>>();
  for (const p of recent)
    for (const t of terms(p.text)) {
      const set = authorsByTerm.get(t) ?? new Set();
      set.add(p.author.handle.toLowerCase());
      authorsByTerm.set(t, set);
    }

  const relevant: Array<ForYouTopic> = [];
  const outside: Array<ForYouTopic> = [];
  for (const [term, authors] of authorsByTerm) {
    if (authors.size < 2 || authors.size > Math.max(3, recent.length * MAX_FEED_SHARE)) continue;
    const breadth = [...authors].reduce((n, a) => n + (profile.close.has(a) ? 2 : 1), 0);
    const rel = relevance(profile, term);
    const reason = [`${authors.size} accounts in your feed today`, ...rel.why].join(" · ");
    // A pair is the more specific topic, so it wins a tie with its own word.
    const specific = term.includes(" ") ? 1.2 : 1;
    if (rel.score > 0)
      relevant.push({
        term,
        source: "feed",
        reason,
        score: specific * breadth * (1 + 2 * rel.score),
      });
    else if (authors.size >= MIN_AUTHORS_UNRELATED)
      outside.push({ term, source: "outside", reason, score: specific * breadth });
  }
  for (const r of input.rising) {
    const term = r.word.toLowerCase();
    const rel = relevance(profile, term);
    const reason = [`rising across Xtend, ${r.lift.toFixed(1)}× last week`, ...rel.why].join(" · ");
    const lift = Math.min(5, r.lift);
    if (rel.score > 0)
      relevant.push({ term, source: "pool", reason, score: lift * (1 + 2 * rel.score) });
    else outside.push({ term, source: "outside", reason, score: lift });
  }

  // One entry per term, and a word drops out once a pair holding it is already listed.
  const picked: Array<ForYouTopic> = [];
  const covered = (t: string) =>
    picked.some(
      (p) => p.term === t || p.term.split(" ").includes(t) || t.split(" ").includes(p.term),
    );
  for (const topic of relevant.sort((a, b) => b.score - a.score)) {
    if (picked.length >= MAX_TOPICS) break;
    if (!covered(topic.term)) picked.push(topic);
  }
  const off = outside.sort((a, b) => b.score - a.score).find((t) => !covered(t.term));
  return off === undefined
    ? picked
    : [...picked, { ...off, reason: `outside your usual topics · ${off.reason}` }];
};
