import { defaultStringifySearch, useNavigate } from "@tanstack/react-router";
import type { EngineEntities, TextStyle } from "@xtend/contracts";
import type { MouseEvent } from "react";

import { styledRuns } from "../compose/textStyles";

/** t.co links, @mentions, #hashtags and $cashtags, for text that comes without X's entities. */
// A hashtag needs a letter (a bare year is not one); a cashtag is letters only ($5,000 is not one).
const TOKEN =
  /(https:\/\/t\.co\/\w+)|(^|[^\w@])(@\w{1,15})|(^|[^\w&])(#[\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*|\$[A-Za-z]{1,6}(?![\w]))/gu;

/**
 * Where an x.com link opens inside Xtend: every x.com page Xtend draws gets its own screen;
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
    // X's Admin tools list and its General settings; X's other tools stay X's own.
    const rest = url.pathname.split("/").filter(Boolean).slice(4).join("/");
    if (fourth === "tools" && (rest === "" || rest === "settings"))
      return `/communities/${third}/tools${rest === "" ? "" : "/settings"}`;
    // Its queues: Member requests and Reported posts; the Moderation log stays X's.
    if (fourth === "moderation" && (rest === "member_requests" || rest === "reported_tweets"))
      return `/communities/${third}/moderation/${rest}`;
    return ["latest", "media", "about"].includes(fourth)
      ? `/communities/${third}?tab=${fourth}`
      : null;
  }
  if (second === "communities" && first !== undefined && /^\w{1,15}$/.test(first))
    return third === "explore" ? "/communities?tab=explore" : "/communities";
  // X's news story, and its NBA league page by tab.
  if (first === "i" && second === "trending" && third !== undefined && /^\d+$/.test(third)) {
    // The story itself, on the tab its link names; its history is X's own page.
    if (fourth !== undefined) return null;
    const timeline = url.searchParams.get("timeline");
    return timeline
      ? `/trending/${third}?timeline=${encodeURIComponent(timeline)}`
      : `/trending/${third}`;
  }
  if (first === "i" && second === "nba" && fourth === undefined) {
    const tab = third === "standings" || third === "players" ? third : "games";
    return third === undefined || ["home", "games", "standings", "players"].includes(third)
      ? `/nba?tab=${tab}`
      : null;
  }
  if (first === "i" && second === "lists" && third !== undefined && /^\d+$/.test(third)) {
    if (fourth === undefined) return `/lists/${third}`;
    return fourth === "members" || fourth === "followers"
      ? `/lists/${third}/people?of=${fourth}`
      : null;
  }
  if (first === "i" && second === "spaces" && third !== undefined && fourth === undefined)
    return /^\w+$/.test(third) ? `/spaces/${third}` : null;
  if (first === "i" && second === "bookmarks" && fourth === undefined) {
    if (third === undefined) return "/bookmarks";
    return /^\d+$/.test(third) ? `/bookmarks${defaultStringifySearch({ folder: third })}` : null;
  }
  if (first === "explore") return second === undefined ? "/explore" : null;
  if (first === "notifications") {
    if (second === undefined) return "/notifications";
    return second === "mentions" ? "/notifications?tab=mentions" : null;
  }
  if (first === undefined || first === "i" || first === "home") return null;
  if (second === "status" && third !== undefined && /^\d+$/.test(third)) {
    const activity = fourth === undefined ? undefined : ACTIVITY.get(fourth);
    return activity === undefined
      ? `/post/${third}?h=${first}`
      : `/post/${third}/activity?h=${first}&tab=${activity}`;
  }
  // An X Article's reader, by the post that carries it.
  if (second === "article" && third !== undefined && /^\d+$/.test(third))
    return `/article/${third}?h=${first}`;
  if (!/^\w{1,15}$/.test(first) || third !== undefined) return null;
  if (second === undefined) return `/u/${first}`;
  if (PEOPLE.has(second)) return `/u/${first}/people?tab=${second}`;
  const tab = PROFILE_TABS.get(second);
  return tab === undefined ? null : `/u/${first}?tab=${tab}`;
}

/** X's Post activity pages under a post, by the tab Xtend's activity screen calls each. */
const ACTIVITY: ReadonlyMap<string, string> = new Map([
  ["quotes", "quotes"],
  ["retweets", "reposts"],
  ["likes", "likes"],
]);
/** X's people pages under a profile; each is the tab id of Xtend's people screen. */
const PEOPLE: ReadonlySet<string> = new Set([
  "followers",
  "following",
  "verified_followers",
  "followers_you_follow",
]);
/** X's profile tab paths, by the tab Xtend's profile screen calls each. */
const PROFILE_TABS: ReadonlyMap<string, string> = new Map([
  ["with_replies", "replies"],
  ["reposts", "reposts"],
  ["subs", "subs"],
  ["highlights", "highlights"],
  ["articles", "articles"],
  ["media", "media"],
  ["likes", "likes"],
]);

type Piece =
  | { readonly kind: "text"; readonly text: string; readonly at: number }
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
    out.push({ kind: "text", text: text.slice(last, e.at[0]), at: last });
    out.push({ kind: "link", text: e.text, href: e.href, at: e.at[0] });
    last = e.at[1];
  }
  out.push({ kind: "text", text: text.slice(last), at: last });
  return out;
}

/** The same, found by pattern, for text X sends without entities (bios, notification lines). */
function byPattern(text: string): ReadonlyArray<Piece> {
  const out: Array<Piece> = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const [whole, tco, lead1 = "", mention, lead2 = "", tag] = m;
    const start = m.index + lead1.length + lead2.length;
    out.push({ kind: "text", text: text.slice(last, start), at: last });
    last = m.index + whole.length;
    const token = tco ?? mention ?? tag ?? "";
    out.push({
      kind: "link",
      text: token,
      at: start,
      href: tco ?? (mention !== undefined ? `https://x.com/${mention.slice(1)}` : xSearch(token)),
    });
  }
  out.push({ kind: "text", text: text.slice(last), at: last });
  return out;
}

/** Text in X's bold and italic where `styles` say; `at` is where it starts in the post. */
export function StyledText({
  text,
  at = 0,
  styles,
}: {
  readonly text: string;
  readonly at?: number;
  readonly styles: ReadonlyArray<TextStyle>;
}) {
  return styledRuns(text, at, styles).map((r) =>
    r.bold ? (
      <b key={r.start}>{r.italic ? <i>{r.text}</i> : r.text}</b>
    ) : r.italic ? (
      <i key={r.start}>{r.text}</i>
    ) : (
      r.text
    ),
  );
}

/**
 * Text as X draws it: links show X's short form and open where they point (x.com ones in Xtend's
 * own screens), mentions open the profile, hashtags and cashtags a search. A post passes X's
 * entities; text without them (a bio) is read by pattern. A long post's bold and italic are
 * drawn on its text, never on a link, as X does.
 */
export function RichText({
  text,
  entities,
  styles = [],
}: {
  readonly text: string;
  readonly entities?: EngineEntities | undefined;
  readonly styles?: ReadonlyArray<TextStyle> | undefined;
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
          styles.length === 0 ? (
            p.text
          ) : (
            <StyledText key={`t${p.at}`} text={p.text} at={p.at} styles={styles} />
          )
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
