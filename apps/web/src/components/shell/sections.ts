import { useLocation } from "@tanstack/react-router";

/**
 * Each tool's sections. They are rows under the tool in the sidebar, never a
 * tab row inside the page: the page reads which one is open from `?tab=`.
 * The first section is the default.
 */
export const SECTIONS = {
  "/compose": [
    { id: "drafts", label: "Drafts" },
    { id: "queued", label: "Queued" },
    { id: "automatic", label: "Automatic" },
    { id: "failed", label: "Failed" },
    { id: "posted", label: "Posted" },
  ],
  "/plan": [
    { id: "calendar", label: "Calendar" },
    { id: "queue", label: "Queue" },
    { id: "slots", label: "Slots" },
  ],
  "/library": [
    { id: "picks", label: "Picks" },
    { id: "search", label: "Search" },
    { id: "archive", label: "Archive" },
    { id: "trends", label: "Trends" },
    { id: "collections", label: "Collections" },
    { id: "swipe", label: "Swipe file" },
  ],
  "/engage": [
    { id: "targets", label: "Targets" },
    { id: "mentions", label: "Mentions" },
    { id: "inbox", label: "Inbox" },
    { id: "sent", label: "Sent" },
    { id: "follow-ups", label: "Follow-ups" },
    { id: "dms", label: "DMs" },
  ],
  "/leads": [
    { id: "people", label: "People" },
    { id: "lists", label: "Lists" },
    { id: "agents", label: "Agents" },
    { id: "followers", label: "New followers" },
  ],
  "/automate": [
    { id: "rules", label: "Rules" },
    { id: "needs-you", label: "Needs you" },
    { id: "dry-run", label: "Dry run" },
    { id: "runs", label: "Runs" },
  ],
  "/analyze": [
    { id: "overview", label: "Overview" },
    { id: "posts", label: "Posts" },
    { id: "audience", label: "Audience" },
    { id: "best-time", label: "Best time" },
    { id: "competitors", label: "Competitors" },
    { id: "ask", label: "Ask" },
  ],
  "/scores": [
    { id: "mine", label: "Mine" },
    { id: "watchlist", label: "Watchlist" },
    { id: "report", label: "Report" },
    { id: "trending", label: "Trending" },
    { id: "bot-check", label: "Bot check" },
  ],
} as const;

export type SectionRoute = keyof typeof SECTIONS;
export type SectionId<R extends SectionRoute> = (typeof SECTIONS)[R][number]["id"];

export const isSectionRoute = (to: string): to is SectionRoute => to in SECTIONS;

/** Where a section lives: the tool's route with `?tab=`. */
export const sectionHref = <R extends SectionRoute>(route: R, id: SectionId<R>) =>
  `${route}?tab=${id}`;

/** The open section of a tool, from `?tab=`; an unknown or missing one is the first. */
export function useSection<R extends SectionRoute>(route: R): SectionId<R> {
  const searchStr = useLocation({ select: (l) => l.searchStr });
  const tab = new URLSearchParams(searchStr).get("tab");
  const sections: ReadonlyArray<{ readonly id: SectionId<R> }> = SECTIONS[route];
  return sections.find((s) => s.id === tab)?.id ?? sections[0]!.id;
}

/** The label of a tool's open section, for its page header. */
export const sectionLabel = <R extends SectionRoute>(route: R, id: SectionId<R>): string =>
  (SECTIONS[route] as ReadonlyArray<{ readonly id: string; readonly label: string }>).find(
    (s) => s.id === id,
  )?.label ?? "";
