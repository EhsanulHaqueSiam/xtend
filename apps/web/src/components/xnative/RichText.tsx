import { useNavigate } from "@tanstack/react-router";
import type { EngineLink } from "@xtend/contracts";
import type { MouseEvent, ReactNode } from "react";

/** t.co links, @mentions, #hashtags and $cashtags, in the order they appear. */
// A hashtag needs a letter (#2026 is not one); a cashtag is letters only ($5,000 is not one).
const TOKEN =
  /(https:\/\/t\.co\/\w+)|(^|[^\w@])(@\w{1,15})|(^|[^\w&])(#[\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*|\$[A-Za-z]{1,6}(?![\w]))/gu;

/**
 * Where an x.com link opens inside Xtend: a post, a profile or a search get Xtend's own screen;
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
  const [first, second, third] = url.pathname.split("/").filter(Boolean);
  if (first === "search") return `/search?q=${encodeURIComponent(url.searchParams.get("q") ?? "")}`;
  if (first === undefined || first === "i" || first === "home") return null;
  if (second === "status" && third !== undefined && /^\d+$/.test(third))
    return `/post/${third}?h=${first}`;
  return second === undefined && /^\w{1,15}$/.test(first) ? `/u/${first}` : null;
}

/**
 * A post's text as X draws it: links show X's short form and open where they point (x.com ones
 * in Xtend's own screens), mentions open the profile, hashtags and cashtags a search.
 */
export function RichText({
  text,
  links,
}: {
  readonly text: string;
  readonly links: ReadonlyArray<EngineLink>;
}) {
  const navigate = useNavigate();
  const go = (href: string) => (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const inside = xtendRoute(href);
    if (inside !== null) void navigate({ href: inside });
    else window.desktopBridge?.openExternal(href);
  };
  const out: Array<ReactNode> = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const [whole, tco, lead1 = "", mention, lead2 = "", tag] = m;
    const lead = lead1 + lead2;
    const start = m.index + lead.length;
    out.push(text.slice(last, start));
    last = m.index + whole.length;
    const cls = "text-[#1d9bf0] hover:underline";
    if (tco !== undefined) {
      const link = links.find((l) => l.url === tco);
      out.push(
        <a
          key={start}
          href={link?.expanded ?? tco}
          className={cls}
          onClick={go(link?.expanded ?? tco)}
        >
          {link?.display ?? tco}
        </a>,
      );
    } else if (mention !== undefined) {
      out.push(
        <a
          key={start}
          href={`https://x.com/${mention.slice(1)}`}
          className={cls}
          onClick={go(`https://x.com/${mention.slice(1)}`)}
        >
          {mention}
        </a>,
      );
    } else if (tag !== undefined) {
      const search = `https://x.com/search?q=${encodeURIComponent(tag)}`;
      out.push(
        <a key={start} href={search} className={cls} onClick={go(search)}>
          {tag}
        </a>,
      );
    }
  }
  out.push(text.slice(last));
  return <>{out}</>;
}
