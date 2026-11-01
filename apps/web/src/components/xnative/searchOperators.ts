/** Replies or links: in with the rest, the only thing shown, or left out. */
export type Include = "include" | "only" | "exclude";

/** X's advanced search form. Lists are typed space separated, as on X; dates are YYYY-MM-DD. */
export interface AdvancedSearch {
  readonly all: string;
  readonly phrase: string;
  readonly any: string;
  readonly none: string;
  readonly hashtags: string;
  readonly lang: string;
  readonly from: string;
  readonly to: string;
  readonly mentioning: string;
  readonly replies: Include;
  readonly links: Include;
  readonly minReplies: string;
  readonly minLikes: string;
  readonly minReposts: string;
  readonly since: string;
  readonly until: string;
}

export const EMPTY_SEARCH: AdvancedSearch = {
  all: "",
  phrase: "",
  any: "",
  none: "",
  hashtags: "",
  lang: "",
  from: "",
  to: "",
  mentioning: "",
  replies: "include",
  links: "include",
  minReplies: "",
  minLikes: "",
  minReposts: "",
  since: "",
  until: "",
};

/** The `lang:` codes X's Language list offers. */
export const LANGUAGES = [
  "ar",
  "bn",
  "eu",
  "bg",
  "ca",
  "hr",
  "cs",
  "da",
  "nl",
  "en",
  "fi",
  "fr",
  "de",
  "el",
  "gu",
  "he",
  "hi",
  "hu",
  "id",
  "ga",
  "it",
  "ja",
  "kn",
  "ko",
  "mr",
  "no",
  "fa",
  "pl",
  "pt",
  "ro",
  "ru",
  "sr",
  "zh",
  "sk",
  "es",
  "sv",
  "ta",
  "th",
  "tr",
  "uk",
  "ur",
  "vi",
];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COUNT = /^(min_replies|min_faves|min_retweets):(\d+)$/;
const COUNT_FIELD = {
  min_replies: "minReplies",
  min_faves: "minLikes",
  min_retweets: "minReposts",
} as const;

/**
 * A query's terms as X reads them, each whole: words, `op:"quoted value"`, "phrases", and
 * (groups), nested ones included, each with an optional leading -. A stray ) is its own term.
 */
function scan(text: string): Array<string> {
  const terms: Array<string> = [];
  // The index past the quote closing the one at `i`, or the end when none closes it.
  const pastQuote = (i: number) => {
    const end = text.indexOf('"', i + 1);
    return end === -1 ? text.length : end + 1;
  };
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i]!)) {
      i++;
      continue;
    }
    const start = i;
    if (text[i] === "-") i++;
    if (text[i] === "(") {
      for (let depth = 0; i < text.length;) {
        const c = text[i];
        i = c === '"' ? pastQuote(i) : i + 1;
        if (c === "(") depth++;
        else if (c === ")" && --depth === 0) break;
      }
    } else if (text[i] === ")") i++;
    else
      while (i < text.length && !/[\s()]/.test(text[i]!))
        i = text[i] === '"' ? pastQuote(i) : i + 1;
    terms.push(text.slice(start, i));
  }
  return terms;
}

/** Terms as typed in a field. An unclosed quote would swallow the rest of the query, so it goes. */
const words = (text: string) =>
  scan(text.split('"').length % 2 === 0 ? text.replace(/"(?=[^"]*$)/, "") : text).filter(
    (w) => w !== "-" && w !== '""' && w !== '-""',
  );
/** Handles typed with or without @, apart by spaces or commas. */
const handles = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((h) => h.replace(/^@+/, ""))
    .filter((h) => h !== "");
const either = (parts: ReadonlyArray<string>) =>
  parts.length > 1 ? `(${parts.join(" OR ")})` : (parts[0] ?? "");
const digits = (text: string) => text.replace(/\D/g, "").replace(/^0+/, "");
const filter = (name: string, mode: Include) =>
  mode === "only" ? `filter:${name}` : mode === "exclude" ? `-filter:${name}` : "";

/** The query X's own advanced search writes for the form, operators in X's order. */
export function writeQuery(form: AdvancedSearch): string {
  // X has no escape inside a phrase, so a quote in one can only be dropped.
  const phrase = form.phrase.replace(/"/g, "").trim();
  const count = (op: string, value: string) =>
    digits(value) === "" ? "" : `${op}:${digits(value)}`;
  const all = words(form.all);
  const rest = [
    phrase === "" ? "" : `"${phrase}"`,
    either(words(form.any).filter((w) => w !== "OR")),
    ...words(form.none).map((w) => `-${w.replace(/^-+/, "")}`),
    either(words(form.hashtags).map((t) => `#${t.replace(/^#+/, "")}`)),
    either(handles(form.from).map((h) => `from:${h}`)),
    either(handles(form.to).map((h) => `to:${h}`)),
    either(handles(form.mentioning).map((h) => `@${h}`)),
    count("min_replies", form.minReplies),
    count("min_faves", form.minLikes),
    count("min_retweets", form.minReposts),
    form.lang === "" ? "" : `lang:${form.lang}`,
    DATE.test(form.until) ? `until:${form.until}` : "",
    DATE.test(form.since) ? `since:${form.since}` : "",
    filter("replies", form.replies),
    filter("links", form.links),
  ].filter((part) => part !== "");
  // A bare OR's reach over what follows is X's to decide, so other fields never join its run.
  const typed = all.join(" ");
  return [all.includes("OR") && rest.length > 0 ? `(${typed})` : typed, ...rest]
    .filter((part) => part !== "")
    .join(" ");
}

type Field = keyof AdvancedSearch;
/** One term the form can hold, as the field it fills and that field's value. */
type Read = readonly [Field, string];
const ANY_WORD = /^("[^"]+"|[^\s"():-][^\s"():]*)$/;
const LISTS = [
  ["hashtags", /^#([^\s"()]+)$/],
  ["from", /^from:(\w+)$/],
  ["to", /^to:(\w+)$/],
  ["mentioning", /^@(\w+)$/],
] as const;

function readTerm(term: string): Read | undefined {
  if (term.startsWith("(")) {
    // Only a flat (a OR b OR c) fills a field; any other group is not the form's to split.
    const inner = term.endsWith(")") ? scan(term.slice(1, -1)) : [];
    const parts = inner.filter((_, i) => i % 2 === 0);
    if (inner.length % 2 === 0 || inner.some((t, i) => (i % 2 === 1) !== (t === "OR")))
      return undefined;
    for (const [field, re] of LISTS) {
      const found = parts.map((p) => re.exec(p)?.[1]);
      if (found.every((f) => f !== undefined)) return [field, found.join(" ")];
    }
    return parts.every((p) => ANY_WORD.test(p)) ? ["any", parts.join(" ")] : undefined;
  }
  for (const [field, re] of LISTS) {
    const found = re.exec(term)?.[1];
    if (found !== undefined) return [field, found];
  }
  const filtered = /^(-?)filter:(replies|links)$/.exec(term);
  if (filtered !== null)
    return [
      filtered[2] === "links" ? "links" : "replies",
      filtered[1] === "-" ? "exclude" : "only",
    ];
  const count = COUNT.exec(term);
  if (count !== null) return [COUNT_FIELD[count[1] as keyof typeof COUNT_FIELD], count[2] ?? ""];
  const [, op, value = ""] = /^(lang|since|until):(.+)$/.exec(term) ?? [];
  if (op === "lang" && LANGUAGES.includes(value)) return ["lang", value];
  if ((op === "since" || op === "until") && DATE.test(value)) return [op, value];
  if (op !== undefined) return undefined;
  if (/^"[^"]+"$/.test(term)) return ["phrase", term.slice(1, -1)];
  if (/^-[^-(]/.test(term)) return ["none", term.slice(1)];
  return undefined;
}

const include = (mode: string): Include =>
  mode === "only" || mode === "exclude" ? mode : "include";

/**
 * The form a query fills, so editing a search starts from it. Each field takes its operator
 * once; a repeat (`from:a from:b` means both, not either) and anything the form cannot say
 * stay as typed in "All of these words", so writing the form back keeps the search the same.
 * A bare OR ties the terms around it together, so such a query stays whole in that field.
 */
export function readQuery(query: string): AdvancedSearch {
  const terms = scan(query);
  if (terms.includes("OR")) return { ...EMPTY_SEARCH, all: terms.join(" ") };
  const form: Record<Field, string> = { ...EMPTY_SEARCH };
  const all: Array<string> = [];
  for (const term of terms) {
    const read = readTerm(term);
    if (read?.[0] === "none") form.none = `${form.none} ${read[1]}`.trim();
    else if (read !== undefined && form[read[0]] === EMPTY_SEARCH[read[0]]) form[read[0]] = read[1];
    else all.push(term);
  }
  return {
    ...form,
    all: all.join(" "),
    replies: include(form.replies),
    links: include(form.links),
  };
}
