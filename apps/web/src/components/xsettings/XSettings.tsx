import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowUpRight, ChevronRight, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { engineAtom } from "../../state/engine";
import { xGo, xOverAtom, xOverEnded } from "../../state/x";
import {
  watchXSettings,
  xPageBarAtom,
  xSettingsAtom,
  xSettingsPress,
  type XSettingsItem,
} from "../../state/xSettings";
import { Section } from "../ui/layout";
import { Switch } from "../ui/switch";
import { XColumn, XTitle } from "../xnative/XColumn";
import { isXOnly, searchXSettings, xSection, type XSectionId } from "./catalog";

/** Where an X settings page lives in Xtend: its section's row, and X's path under it. */
const xSettingsHref = (section: XSectionId, path: string) =>
  `/settings?tab=${section}&x=${encodeURIComponent(path)}`;

/** An x.com path from X's own href (a path, or a full x.com URL); null for a page off X. */
const xPath = (href: string) => {
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  try {
    const url = new URL(href);
    return url.host === "x.com" || url.host === "twitter.com" ? url.pathname + url.search : null;
  } catch {
    return null;
  }
};

const MUTED = "text-[13px] leading-4 text-[#71767b]";
const ROW = "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150";

/**
 * X's page `path` over the main area with Xtend's bar, while `open`: X's own page takes what it
 * asks for there (a password, a payment), and Back returns to Xtend.
 */
function useXPage(path: string | null, title: string, onBack: () => void) {
  const setOver = useAtomSet(xOverAtom);
  const setBar = useAtomSet(xPageBarAtom);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- shows X's own page (the session view) over the main area while this row is open on it.
  useEffect(() => {
    if (path === null) return;
    void xGo(`https://x.com${path}`);
    setOver(true);
    setBar({ title, back: onBack });
    return () => {
      xOverEnded();
      setOver(false);
      setBar(null);
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- the page is the trigger; a new title or Back for it changes nothing in X.
  }, [path, setOver, setBar]);
}

/**
 * One of X's settings pages, drawn by Xtend from what X's page draws in the engine (X's words, X's
 * order), in X's column. Each control presses X's own for the user's click, one at a time; a page
 * that asks for typing, and the pages X keeps (`isXOnly`), show as X's own page over the main area.
 */
export function XSettingsScreen({
  section: id,
  path: asked,
  onSearch,
}: {
  readonly section: XSectionId;
  /** X's page under the section; null for the section's own page. */
  readonly path: string | null;
  readonly onSearch: (query: string) => void;
}) {
  const section = xSection(id)!;
  const router = useRouter();
  const navigate = useNavigate();
  const claims = useAtomValue(engineAtom).claims;
  // X's Settings links its own Premium page for a subscriber, its sign-up for anyone else.
  const path =
    asked ?? (id === "x-premium" && (claims?.size ?? 0) > 0 ? "/i/premium" : section.path);
  const [reads, setReads] = useAtom(xSettingsAtom);
  const read = reads.get(path);
  const known = section.pages.find((p) => p.path === path)?.title;
  const title = (read?.path === path && read.title !== "" ? read.title : known) ?? section.label;
  const back = asked === null ? undefined : () => router.history.back();
  // A row of X's own page opened from this one: over the main area until its Back.
  const [opened, setOpened] = useState<{ readonly path: string; readonly title: string } | null>(
    null,
  );
  const xOnly = isXOnly(path);
  const typing = read?.path === path && read.typing;
  const over = xOnly ? { path, title } : typing ? { path, title } : opened;
  useXPage(
    isElectron ? (over?.path ?? null) : null,
    over?.title ?? title,
    xOnly || typing ? () => router.history.back() : () => setOpened(null),
  );

  const setOver = useAtomSet(xOverAtom);
  const setBar = useAtomSet(xPageBarAtom);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- reads X's settings page (the session view) while it is open here.
  useEffect(() => {
    if (!isElectron || xOnly) return;
    const stop = new AbortController();
    watchXSettings(path, stop.signal, (next) =>
      setReads((all) => new Map(all).set(next.path, next)),
    );
    return () => {
      stop.abort();
      // A press on the page being left ends with it, and X's answer to it is no longer shown.
      xOverEnded();
      setOver(false);
      setBar(null);
    };
  }, [path, xOnly, setReads, setOver, setBar]);

  const [pressing, setPressing] = useState<number | null>(null);
  const press = (index: number, item: XSettingsItem, value?: string) => {
    if (pressing !== null) return;
    setPressing(index);
    // X's answer (its confirm, or its own page a button opens) gets Xtend's bar and its Back.
    const over = (shown: boolean) => {
      setOver(shown);
      setBar(shown ? { title, back: () => (xOverEnded(), setOver(false), setBar(null)) } : null);
    };
    void xSettingsPress(path, index, item, over, value).finally(() => setPressing(null));
  };
  const open = (href: string, label: string) => {
    const to = xPath(href);
    if (to === null) return window.desktopBridge?.openExternal(href);
    if (isXOnly(to)) return setOpened({ path: to, title: label });
    void navigate({ href: xSettingsHref(id, to) });
  };

  const items = read?.path === path ? read.items : [];
  return (
    <XColumn
      header={
        <>
          <XTitle title={title} detail={`X · ${section.label}`} onBack={back} />
          <label className="no-drag mx-4 mb-2 flex items-center gap-2 rounded-full border border-white/[0.12] px-3.5 py-1.5 text-[14px] text-[#71767b] focus-within:border-[#1d9bf0]">
            <Search aria-hidden="true" className="size-4 shrink-0" />
            <input
              type="search"
              aria-label="Search settings"
              placeholder="Search Xtend and X settings"
              className="min-w-0 flex-1 bg-transparent text-foreground outline-hidden placeholder:text-[#71767b]"
              onChange={(e) => onSearch(e.target.value)}
            />
          </label>
        </>
      }
    >
      {!isElectron ? (
        <p className={cn(MUTED, "px-4 py-5")}>
          X's settings are read from your X session, which lives in Xtend's desktop app.
        </p>
      ) : xOnly || typing ? (
        <div className="flex flex-col items-start gap-3 px-4 py-5">
          <p className={MUTED}>
            {xOnly
              ? "This stays X's own page: Xtend shows it over the main area and reads nothing on it."
              : "X asks for your typing on this page, so it shows as X's own page."}
          </p>
        </div>
      ) : items.length === 0 ? (
        <p className={cn(MUTED, "px-4 py-5")}>
          {read !== undefined && read.path !== path
            ? "X shows another page here."
            : `Loading ${title} from X.`}
        </p>
      ) : (
        <ul className="pb-6">
          {items.map((item, i) => (
            // X's items have no ids; X's order is the key, as a press finds them by it too.
            // oxlint-disable-next-line react/no-array-index-key -- X's page has no ids; its order is the identity a press checks.
            <li key={i} className={cn(pressing === i && "opacity-60")}>
              <Item
                item={item}
                busy={pressing !== null}
                onPress={(value) => press(i, item, value)}
                onOpen={open}
                onX={() => setOpened({ path, title })}
              />
            </li>
          ))}
        </ul>
      )}
    </XColumn>
  );
}

function Item({
  item,
  busy,
  onPress,
  onOpen,
  onX,
}: {
  readonly item: XSettingsItem;
  readonly busy: boolean;
  readonly onPress: (value?: string) => void;
  /** Opens one of X's links: a settings page here, X's own page over the main area, or off X. */
  readonly onOpen: (href: string, label: string) => void;
  /** Shows this page as X's own over the main area, for a control Xtend does not draw. */
  readonly onX: () => void;
}) {
  switch (item.kind) {
    case "heading":
      return <h2 className="px-4 pt-4 pb-1 text-[17px] font-bold">{item.text}</h2>;
    case "text":
      return <p className={cn(MUTED, "px-4 py-2")}>{item.text}</p>;
    case "link": {
      const xOnly = !item.external && isXOnly(xPath(item.href) ?? "");
      return (
        <button
          type="button"
          className={cn(ROW, "cursor-pointer hover:bg-white/[0.03]")}
          onClick={() => onOpen(item.href, item.label)}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[15px]">{item.label}</span>
            {item.hint === "" ? null : <span className={cn(MUTED, "block")}>{item.hint}</span>}
          </span>
          {item.external || xOnly ? (
            <ArrowUpRight aria-label="X's own page" className="size-4 shrink-0 text-[#71767b]" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-[#71767b]" />
          )}
        </button>
      );
    }
    case "check":
      return (
        <label className={cn(ROW, item.disabled ? "opacity-50" : "cursor-pointer")}>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px]">{item.label}</span>
            {item.hint === "" ? null : <span className={cn(MUTED, "block")}>{item.hint}</span>}
          </span>
          {item.toggle ? (
            <Switch
              checked={item.checked}
              label={item.label}
              disabled={item.disabled || busy}
              onChange={() => onPress()}
            />
          ) : (
            <input
              type="checkbox"
              className="size-[18px] shrink-0 cursor-pointer accent-[#1d9bf0]"
              checked={item.checked}
              disabled={item.disabled || busy}
              onChange={() => onPress()}
            />
          )}
        </label>
      );
    case "radio":
      return (
        <label className={cn(ROW, item.disabled ? "opacity-50" : "cursor-pointer")}>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px]">{item.label}</span>
            {item.hint === "" ? null : <span className={cn(MUTED, "block")}>{item.hint}</span>}
          </span>
          <input
            type="radio"
            name={item.group}
            className="size-5 shrink-0 cursor-pointer accent-[#1d9bf0]"
            checked={item.checked}
            disabled={item.disabled || busy}
            onChange={() => onPress()}
          />
        </label>
      );
    case "select":
      return (
        <label className={cn(ROW, "flex-col items-stretch gap-1")}>
          <span className={MUTED}>{item.label}</span>
          <select
            className="rounded-[4px] border border-white/[0.12] bg-black px-2 py-2 text-[15px]"
            value={item.value}
            disabled={item.disabled || busy}
            onChange={(e) => onPress(e.target.value)}
          >
            {item.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      );
    case "button":
      return (
        <div className="px-4 py-2">
          <button
            type="button"
            disabled={busy}
            className="cursor-pointer rounded-full border border-white/[0.2] px-4 py-1.5 text-[14px] font-bold hover:bg-white/[0.06]"
            onClick={() => onPress()}
          >
            {item.label}
          </button>
        </div>
      );
    case "other":
      return (
        <button
          type="button"
          className={cn(ROW, "cursor-pointer hover:bg-white/[0.03]")}
          onClick={onX}
        >
          <span className="min-w-0 flex-1 text-[15px]">{item.label}</span>
          <span className={MUTED}>on X's page</span>
          <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-[#71767b]" />
        </button>
      );
  }
}

/**
 * X's settings pages that match `query`, as X's own settings search finds them, each with its
 * section: Settings search lists them after Xtend's own rows. Nothing is read from X to find them.
 */
export function XSettingsResults({
  query,
  onPick,
}: {
  readonly query: string;
  readonly onPick: () => void;
}) {
  const navigate = useNavigate();
  const found = searchXSettings(query);
  if (found.length === 0) return null;
  return (
    <Section title="X" description="X's own settings">
      <ul>
        {found.map(({ section, page }) => (
          <li key={`${section.id} ${page.title}`} data-row="">
            <button
              type="button"
              className="flex w-full cursor-pointer items-baseline gap-3 border-b border-border py-2.5 text-left text-sm last:border-b-0 hover:text-foreground"
              onClick={() => {
                onPick();
                void navigate({
                  href:
                    page.path === section.path
                      ? `/settings?tab=${section.id}`
                      : xSettingsHref(section.id, page.path),
                });
              }}
            >
              <span className="min-w-0 flex-1 truncate">{page.title}</span>
              <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                X › {section.label}
              </span>
              {isXOnly(page.path) ? (
                <ArrowUpRight aria-label="X's own page" className="size-3 shrink-0" />
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
