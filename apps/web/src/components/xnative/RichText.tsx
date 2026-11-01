import { useNavigate } from "@tanstack/react-router";
import type { EngineEntities } from "@xtend/contracts";
import type { MouseEvent } from "react";

/** t.co links, @mentions, #hashtags and $cashtags, for text that comes without X's entities. */
// A hashtag needs a letter (a bare year is not one); a cashtag is letters only ($5,000 is not one).
const TOKEN =
  /(https:\/\/t\.co\/\w+)|(^|[^\w@])(@\w{1,15})|(^|[^\w&])(#[\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*|\$[A-Za-z]{1,6}(?![\w]))/gu;

/**
 * Where an x.com link opens inside Xtend: a post, a profile, a search or a Community get Xtend's own screen;
 * anything else on x.com, or off it, is null and opens in the browser.
 */
export function xtendRoute(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!/^(www\.|mobile\.)?(x|twitter)\.com$/.test(url.hostname)) return null;
  const [first, second, third, fourth] = url.pathname.split("/").filter(Boolean);
  if (first === "search") return `/search?q=${encodeURIComponent(url.searchParams.get("q") ?? "")}`;
  if (first === "i" && second === "connect_people")
    return url.searchParams.get("is_creator_only") === "true" ? "/follow?tab=creators" : "/follow";
  // A Community on its tab, and X's Communities page, which X keeps under the account's own handle.
  // Its other pages (the full Members list) are X's own.
  if (first === "i" && second === "communities") {
    if (third === undefined) return "/communities";
    if (!/^\d+$/.test(third)) return null;
    if (fourth === undefined) return `/communities/${third}`;
    return ["latest", "media", "about"].includes(fourth)
      ? `/communities/${third}?tab=${fourth}`
      : null;
  }
  if (second === "communities" && first !== undefined && /^\w{1,15}$/.test(first))
    return third === "explore" ? "/communities?tab=explore" : "/communities";
  if (first === undefined || first === "i" || first === "home") return null;
  if (second === "status" && third !== undefined && /^\d+$/.test(third))
    return `/post/${third}?h=${first}`;
  return second === undefined && /^\w{1,15}$/.test(first) ? `/u/${first}` : null;
}

type Piece =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "link"; readonly text: string; readonly href: string; readonly at: number };

const xSearch = (q: string) => `https://x.com/search?q=${encodeURIComponent(q)}`;

/** Cuts a post's text where X's entities say: UTF-16 offsets, which are JS string offsets. */
function byEntities(text: string, entities: EngineEntities): ReadonlyArray<Piece> {
  const spans = [
    ...entities.urls.flatMap((u) =>
      u.indices === null ? [] : [{ at: u.indices, text: u.display, href: u.expanded }],
    ),
    ...entities.mentions.map((m) => ({
      at: m.indices,
      text: text.slice(...m.indices),
      href: `https://x.com/${m.handle}`,
    })),
    ...entities.hashtags.map((h) => ({
      at: h.indices,
      text: text.slice(...h.indices),
      href: xSearch(`#${h.tag}`),
    })),
    ...entities.cashtags.map((c) => ({
      at: c.indices,
      text: text.slice(...c.indices),
      href: xSearch(`$${c.tag}`),
    })),
  ]
    // A clamped text ("Show more") ends early; entities past its end are not drawn.
    .filter((e) => e.at[1] <= text.length)
    .toSorted((a, b) => a.at[0] - b.at[0]);
  const out: Array<Piece> = [];
  let last = 0;
  for (const e of spans) {
    if (e.at[0] < last) continue;
    out.push({ kind: "text", text: text.slice(last, e.at[0]) });
    out.push({ kind: "link", text: e.text, href: e.href, at: e.at[0] });
    last = e.at[1];
  }
  out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** The same, found by pattern, for text X sends without entities (bios, notification lines). */
function byPattern(text: string): ReadonlyArray<Piece> {
  const out: Array<Piece> = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const [whole, tco, lead1 = "", mention, lead2 = "", tag] = m;
    const start = m.index + lead1.length + lead2.length;
    out.push({ kind: "text", text: text.slice(last, start) });
    last = m.index + whole.length;
    const token = tco ?? mention ?? tag ?? "";
    out.push({
      kind: "link",
      text: token,
      at: start,
      href: tco ?? (mention !== undefined ? `https://x.com/${mention.slice(1)}` : xSearch(token)),
    });
  }
  out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/**
 * Text as X draws it: links show X's short form and open where they point (x.com ones in Xtend's
 * own screens), mentions open the profile, hashtags and cashtags a search. A post passes X's
 * entities; text without them (a bio) is read by pattern.
 */
export function RichText({
  text,
  entities,
}: {
  readonly text: string;
  readonly entities?: EngineEntities | undefined;
}) {
  const navigate = useNavigate();
  const go = (href: string) => (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const inside = xtendRoute(href);
    if (inside !== null) void navigate({ href: inside });
    else window.desktopBridge?.openExternal(href);
  };
  const pieces = entities === undefined ? byPattern(text) : byEntities(text, entities);
  return (
    <>
      {pieces.map((p) =>
        p.kind === "text" ? (
          p.text
        ) : (
          <a
            key={p.at}
            href={p.href}
            className="text-[#1d9bf0] hover:underline"
            onClick={go(p.href)}
          >
            {p.text}
          </a>
        ),
      )}
    </>
  );
}
