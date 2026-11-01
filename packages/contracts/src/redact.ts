/**
 * Credential scrubbing shared by everything that writes diagnostics to disk: the service's trace
 * file and stdout, the desktop's log and the triage context. Pure text work, no Effect services.
 */

export const REDACTED = "<redacted>";

// Matched on a key's last word, so `tregToken` and `auth_token` are credentials and `tokenCount`,
// `token_budget` and `tokens` are not.
const SECRET_WORDS: ReadonlySet<string> = new Set([
  "token",
  "secret",
  "password",
  "passwd",
  "cookie",
  "cookies",
  "authorization",
  "bearer",
  "credential",
  "credentials",
  "ct0",
  "twid",
  "kdt",
  "csrf",
  "xsrf",
]);
// Compounds whose last word alone is harmless (`id`, `hash`, `key`). `refreshToken`,
// `clientSecret`, `set-cookie` and the like already end in a credential word.
const SECRET_KEY_PAIRS: ReadonlySet<string> = new Set([
  "api key",
  "assist key",
  "private key",
  "access key",
  "session id",
  "session key",
  "password hash",
]);

/** Whether an attribute or argument key names a credential, judged by its last word or two. */
export const isSecretKey = (key: string) => {
  const words = (key.split(".").pop() ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
  const last = words.at(-1) ?? "";
  return SECRET_WORDS.has(last) || SECRET_KEY_PAIRS.has(words.slice(-2).join(" "));
};

// Every pattern here is linear: no two adjacent quantifiers can match the same characters.
// The treg token is JWT-shaped and the service token 64 hex chars.
const SECRET_SHAPES: ReadonlyArray<readonly [RegExp, string]> = [
  [/eyJ[\w-]{8,}(?:\.[\w-]+)*/g, REDACTED],
  [/\btrg_[\w-]+/g, REDACTED],
  [/\b[a-f0-9]{64}\b/g, REDACTED],
  [/(Bearer\s+)[\w.~+/=-]+/gi, `$1${REDACTED}`],
];

// A candidate `key: value` or `key=value`, the key starting at a word boundary and bounded.
const PAIR = /(?<![\w.-])(["']?)([A-Za-z_][\w.-]{0,79})\1\s*([:=])\s*/g;
// `key=value` (a query, a cookie) ends at whitespace too; `key: value` (a header) runs on.
const UNQUOTED_END = { ":": /[\n\r,;&#}\]"'\\]/, "=": /[\s,;&#}\]"'\\]/ };

/** Where a pair's value ends: its closing quote, or the first separator. */
const valueEnd = (text: string, start: number, separator: string) => {
  const quote = text[start];
  if (quote === '"' || quote === "'") {
    for (let at = start + 1; at < text.length; at++) {
      if (text[at] === "\\") at++;
      else if (text[at] === quote) return at + 1;
    }
    return text.length;
  }
  if (quote === "[" || quote === "{") return start; // Containers are sanitised before formatting.
  const end = UNQUOTED_END[separator === "=" ? "=" : ":"];
  let at = start;
  while (at < text.length && !end.test(text[at]!)) at++;
  return at;
};

/** One pass over the text: each credential-named pair's value becomes `<redacted>`. */
const redactPairs = (text: string) => {
  let out = "";
  let copied = 0;
  PAIR.lastIndex = 0;
  for (let match = PAIR.exec(text); match !== null; match = PAIR.exec(text)) {
    if (!isSecretKey(match[2]!)) continue;
    const start = match.index + match[0].length;
    const end = valueEnd(text, start, match[3]!);
    if (end === start) continue;
    const quote = text[start] === '"' || text[start] === "'" ? text[start]! : "";
    out += `${text.slice(copied, start)}${quote}${REDACTED}${quote}`;
    copied = end;
    PAIR.lastIndex = end;
  }
  return copied === 0 ? text : out + text.slice(copied);
};

/** Scrubs credential shapes and credential-named pairs. Linear in the text's length. */
export const redactText = (text: string) =>
  redactPairs(
    SECRET_SHAPES.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text),
  );
