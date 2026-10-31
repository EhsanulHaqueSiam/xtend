import { useLocation } from "@tanstack/react-router";

/**
 * What each tool is, in one sentence a first visit shows under the header and
 * the sidebar row carries as its title: what it does, where its data comes
 * from, what costs money.
 */
export const ABOUT: Readonly<Record<string, string>> = {
  "/x": "X as you know it, in your own session, with what Xtend noticed beside it. Free.",
  "/today": "What waits on you, what goes out next and how the week went. Free.",
  "/compose":
    "Write posts, threads and articles. What you click posts through your own X session, free; the queue goes through the X API at the price shown. Assist runs on your login.",
  "/plan":
    "When your posts go out: a week of slots, the queue and your best hours, in your time zone. Planning is free; a queued post pays the X API when it goes out.",
  "/library":
    "Posts worth learning from: daily picks for your keywords, search, and what you saved. Fetches are paid; saved posts are free.",
  "/engage":
    "People to reply under and replies to you. Pick a tone for drafts or write your own; a clicked reply goes through your own session, free.",
  "/leads":
    "People worth following up: who they are, which list, which stage. Agents find more for a price.",
  "/automate":
    "Rules that act for you through the X API, each with a price, a budget and an approval step when you want one.",
  "/analyze":
    "How your account is doing, from your posts your session saw, free. Refresh reads your full timeline and follower count, priced on the button.",
  "/scores":
    "Account scores for you and anyone you watch. Stored reports are free; a score run reads their followers through treg, priced on the button.",
  "/settings": "Your handle, token, budget, voice, and the app itself.",
};

/**
 * Each tool's sections. They are rows under the tool in the sidebar, never a
 * tab row inside the page: the page reads which one is open from `?tab=`.
 * The first section is the default. `about` is the section's one line under
 * the header on a first visit.
 */
export const SECTIONS = {
  "/compose": [
    {
      id: "drafts",
      label: "Drafts",
      about: "Yours, and what Library and rules wrote for you, not yet queued.",
    },
    { id: "posted", label: "Posted", about: "On X, with their ids." },
  ],
  "/plan": [
    {
      id: "calendar",
      label: "Calendar",
      about: "Drop a draft on a slot or an hour to schedule it.",
    },
    {
      id: "queue",
      label: "Queue",
      about: "Queued and failed posts in order, with what the week costs.",
    },
    { id: "slots", label: "Slots", about: "The times posts go out, per weekday." },
  ],
  "/library": [
    { id: "picks", label: "Picks", about: "A daily fetch for your keywords, paid." },
    {
      id: "trends",
      label: "Trends",
      about: "Topics for you and the shared pool, free; X trends by country through treg.",
    },
    { id: "search", label: "Search", about: "X search through treg, price before Enter." },
    {
      id: "saved",
      label: "Saved",
      about: "Posts you kept, all of them or by collection; a post can be in many. Free.",
    },
    {
      id: "seen",
      label: "Seen",
      about: "Every post your X session showed you, newest first. Free.",
    },
    { id: "archive", label: "Archive", about: "Every post a search or pick saw, free to browse." },
  ],
  "/engage": [
    {
      id: "targets",
      label: "Targets",
      about: "Fresh posts for your keywords to reply under; Refresh is one paid search each.",
    },
    {
      id: "inbox",
      label: "Inbox",
      about:
        "Mentions, replies and quotes your session saw, free; Fetch new asks X for mentions, paid.",
    },
    {
      id: "sent",
      label: "Sent",
      about: "Replies you made, and the ones worth a follow-up. Free.",
    },
    { id: "dms", label: "DMs", about: "Your direct messages, read through the X API, paid." },
  ],
  "/leads": [
    {
      id: "people",
      label: "People",
      about: "Everyone found, by stage. Free; a profile fetch or a DM is priced on its button.",
    },
    {
      id: "lists",
      label: "Lists",
      about: "Groups of people. Free; building one from a search is priced first.",
    },
    { id: "agents", label: "Agents", about: "Finders that run on a schedule, paid per run." },
  ],
  "/automate": [
    { id: "rules", label: "Rules", about: "What runs, when, and for how much." },
    { id: "needs-you", label: "Needs you", about: "Actions waiting for your yes." },
    { id: "dry-run", label: "Dry run", about: "What a rule would do today; fires nothing." },
    { id: "runs", label: "Runs", about: "What ran, with cost and result." },
  ],
  "/analyze": [
    {
      id: "overview",
      label: "Overview",
      about:
        "Views and activity from your posts your session saw, free; followers come with a paid Refresh.",
    },
    {
      id: "posts",
      label: "Posts",
      about: "Each post's numbers, live from your session; Refresh fills in the rest.",
    },
    {
      id: "audience",
      label: "Audience",
      about:
        "Who followed you since the last check, to add as leads; each check reads a paid follower page.",
    },
    {
      id: "best-time",
      label: "Best time",
      about: "Hours your posts drew views. Free.",
    },
    {
      id: "competitors",
      label: "Competitors",
      about: "Accounts to compare against; each fetch is priced on its row.",
    },
  ],
  "/scores": [
    {
      id: "report",
      label: "Report",
      about: "Yours or any account's score, top followers and bot check; the last report is free.",
    },
    { id: "watchlist", label: "Watchlist", about: "Accounts you watch; each rescore is paid." },
  ],
  "/settings": [
    { id: "account", label: "Account", about: "Your handle and every connected account." },
    {
      id: "money",
      label: "Money",
      about: "The treg token, the monthly budget and what was spent.",
    },
    {
      id: "writing",
      label: "Writing",
      about: "Assist, your voice, keywords, time zone and the morning jobs.",
    },
    { id: "x", label: "X session", about: "What goes through your own X session, and Clean X." },
    { id: "pool", label: "Pool", about: "Sharing public sightings with everyone's trends." },
    { id: "service", label: "Service", about: "Where the service runs and how to reach it." },
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

const section = (route: SectionRoute, id: string) =>
  (
    SECTIONS[route] as ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly about: string;
    }>
  ).find((s) => s.id === id);

/** The label of a tool's open section, for its page header. */
export const sectionLabel = <R extends SectionRoute>(route: R, id: SectionId<R>): string =>
  section(route, id)?.label ?? "";

/** What a tool's open section does, in one line; an unknown or missing id is the first section. */
export const sectionAbout = (route: SectionRoute, id: string) =>
  (section(route, id) ?? SECTIONS[route][0]).about;

/**
 * The x.com page the side panel shows beside a tool, or per section; "@" is the user's profile.
 * A tool or section not listed shows no panel until the user opens one (⌘\, an Open on X link).
 */
const X_PAGES: {
  readonly [R in SectionRoute]?: "@" | Partial<Record<SectionId<R>, string>>;
} = {
  "/compose": "@",
  "/plan": "@",
  "/engage": {
    targets: "/home",
    inbox: "/notifications",
    sent: "/notifications",
    dms: "/messages",
  },
  "/library": {
    search: "/explore",
    trends: "/explore/tabs/trending",
    saved: "/i/bookmarks",
    seen: "/home",
  },
};

/** The x.com path for the panel beside this route and `?tab=`, or null for no panel. */
export const xPageFor = (pathname: string, tab: string | null, handle: string | null) => {
  if (!isSectionRoute(pathname)) return null;
  const entry: "@" | Readonly<Record<string, string>> | undefined = X_PAGES[pathname];
  const sections: ReadonlyArray<{ readonly id: string }> = SECTIONS[pathname];
  const id = sections.find((s) => s.id === tab)?.id ?? sections[0]!.id;
  const page = typeof entry === "object" ? entry[id] : entry;
  return page === "@" ? (handle === null ? "/home" : `/${handle}`) : (page ?? null);
};
