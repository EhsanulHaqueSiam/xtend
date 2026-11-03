// Engine fixtures: recorded or made-up X engine batches that dev replays into the store, so the
// native X screens render in a plain browser. Type imports only: scripts/engine-fixture.ts runs
// this file under Node as is.
import type {
  EngineArticle,
  EngineArticleBlock,
  EngineBatch,
  EngineCard,
  EngineCommunity,
  EngineEntities,
  EngineGame,
  EngineList,
  EngineMedia,
  EngineNotification,
  EnginePost,
  EngineTrend,
  EngineUser,
  EngineViewer,
} from "@xtend/contracts";

/** A fixture file's first line: what it holds, the moment its times are from, pages that show it. */
export interface FixtureMeta {
  readonly fixture: string;
  readonly description: string;
  readonly at: string;
  readonly open: ReadonlyArray<string>;
}

export interface Fixture {
  readonly meta: FixtureMeta;
  readonly batches: ReadonlyArray<EngineBatch>;
}

/** One JSON line for the meta, then one per batch. */
export const formatFixture = (fixture: Fixture) =>
  [fixture.meta, ...fixture.batches].map((line) => JSON.stringify(line)).join("\n") + "\n";

type Recorded = Omit<EngineBatch, "communities" | "sections"> &
  Partial<Pick<EngineBatch, "communities" | "sections">>;

export const parseFixture = (raw: string): Fixture => {
  const [meta, ...batches] = raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line): unknown => JSON.parse(line));
  if (typeof meta !== "object" || meta === null || !("fixture" in meta))
    throw new Error("an engine fixture starts with its meta line");
  return {
    meta: meta as FixtureMeta,
    // A recording made before the engine read Communities and people sections names none.
    batches: (batches as ReadonlyArray<Recorded>).map((b) => ({
      ...b,
      communities: b.communities ?? [],
      sections: b.sections ?? [],
    })),
  };
};

const shiftIso = (iso: string | null, ms: number) =>
  iso === null ? null : new Date(Date.parse(iso) + ms).toISOString();

/** Moves a batch's times by `ms`, so a fixture recorded days ago reads "2m" now. */
export const shiftBatch = (batch: EngineBatch, ms: number): EngineBatch => ({
  ...batch,
  posts: batch.posts.map((p) => ({
    ...p,
    createdAt: shiftIso(p.createdAt, ms)!,
    poll: p.poll === null ? null : { ...p.poll, endsAt: shiftIso(p.poll.endsAt, ms) },
  })),
  notifications: batch.notifications.map((n) => ({ ...n, at: shiftIso(n.at, ms) })),
});

const svg = (body: string, w: number, h: number) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`)}`;
const hue = (seed: string) => [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
/** A flat placeholder for a face, a banner or a photo: the seed picks its colour. */
const placeholder = (seed: string, w = 400, h = 400) =>
  svg(
    `<rect width="${w}" height="${h}" fill="hsl(${hue(seed)} 45% 38%)"/><circle cx="${w * 0.7}" cy="${h * 0.35}" r="${Math.min(w, h) * 0.18}" fill="hsl(${(hue(seed) + 40) % 360} 60% 60%)"/>`,
    w,
    h,
  );

// Words a scrub keeps: X's own UI words and English glue. They name nobody.
const KEEP = new Set(
  "a an and are as at be but by for from has have he her his i in is it its me my no not of on or our she so that the their them they this to us was we were what when who will with you your pinned reposted liked replying followed post posts reply replies others more show follow translated original new".split(
    " ",
  ),
);

/**
 * Rebuilds batches from an allowlist of fields, replacing everything that could name a person or
 * a post: ids, handles, names, text, images, links, cursors. Text keeps its length and shape (so
 * entity offsets still hold) with every word swapped for a made-up one. The first batch's viewer
 * becomes @you. A field the contracts add later is dropped until this learns it.
 */
export function scrub(batches: ReadonlyArray<EngineBatch>): ReadonlyArray<EngineBatch> {
  const tables = { id: new Map<string, string>(), str: new Map<string, string>() };
  const words = new Map<string, string>();
  const handles = new Map<string, string>();
  const names = new Map<string, string>();
  const id = (real: string) => {
    let fake = tables.id.get(real);
    if (fake === undefined) tables.id.set(real, (fake = String(900_000_000_000 + tables.id.size)));
    return fake;
  };
  // Opaque X strings (cursors, module ids, timeline ids): only their equality matters.
  const str = (real: string) => {
    let fake = tables.str.get(real);
    if (fake === undefined) tables.str.set(real, (fake = `s${tables.str.size}`));
    return fake;
  };
  const word = (real: string) => {
    if (KEEP.has(real.toLowerCase())) return real;
    let fake = words.get(real);
    if (fake === undefined) words.set(real, (fake = madeUpWord([...real], words.size)));
    return fake;
  };
  const text = (real: string) => real.replace(/[\p{L}\p{N}]+/gu, word);
  // Each person's stand-in number, so their made-up name and handle belong together.
  const numbers = new Map<string, number>();
  const numberOf = (real: string) => {
    const key = real.toLowerCase();
    let n = numbers.get(key);
    if (n === undefined) numbers.set(key, (n = numbers.size));
    return n;
  };
  const handle = (real: string) => {
    const key = real.toLowerCase();
    let fake = handles.get(key);
    if (fake === undefined) handles.set(key, (fake = handleFor(numberOf(real))));
    return fake;
  };
  /** A person's made-up name, numbered by their handle so the two go together. */
  const name = (real: string, ofHandle: string) => {
    let fake = names.get(real);
    if (fake === undefined) names.set(real, (fake = nameFor(numberOf(ofHandle))));
    return fake;
  };
  const viewer = batches.find((b) => b.viewer !== null)?.viewer;
  if (viewer) {
    handles.set(viewer.handle.toLowerCase(), "you");
    if (viewer.name !== null) names.set(viewer.name, "You");
  }

  const entities = (e: EngineEntities, shown: string): EngineEntities => ({
    urls: e.urls.map((u, n) => ({
      url: `https://t.co/${str(u.url)}`,
      expanded: `https://example.com/${n}`,
      display: u.indices === null ? "example.com" : shown.slice(u.indices[0], u.indices[1]),
      indices: u.indices,
    })),
    mentions: e.mentions.map((m) => ({ handle: handle(m.handle), indices: m.indices })),
    hashtags: e.hashtags.map((h) => ({
      tag: shown.slice(h.indices[0] + 1, h.indices[1]),
      indices: h.indices,
    })),
    cashtags: e.cashtags.map((c) => ({
      tag: shown.slice(c.indices[0] + 1, c.indices[1]),
      indices: c.indices,
    })),
  });
  const person = (u: Pick<EngineUser, "userId" | "handle" | "name" | "avatarUrl">) => {
    return {
      userId: id(u.userId),
      handle: handle(u.handle),
      name: name(u.name, u.handle),
      avatarUrl: u.avatarUrl === null ? null : placeholder(id(u.userId)),
    };
  };
  // A video's mp4 names the post; replays show its still.
  const media = (m: EngineMedia, seed: string): EngineMedia => ({
    kind: m.kind === "gif" ? "gif" : "photo",
    url: placeholder(
      seed,
      m.width > 0 ? 600 : 400,
      m.width > 0 ? Math.round((600 * m.height) / m.width) : 300,
    ),
    videoUrl: null,
    width: m.width,
    height: m.height,
    durationMs: null,
    altText: m.altText === null ? null : text(m.altText),
  });
  const card = (c: EngineCard, seed: string): EngineCard => ({
    kind: c.kind,
    url: "https://example.com/",
    title: text(c.title),
    domain: c.domain === null ? null : "example.com",
    description: c.description === null ? null : text(c.description),
    imageUrl: c.imageUrl === null ? null : placeholder(seed, 600, 315),
  });
  const post = (p: EnginePost): EnginePost => {
    const shown = text(p.text);
    const translated = p.translation === null ? null : text(p.translation.text);
    return {
      postId: id(p.postId),
      author: {
        userId: id(p.author.userId),
        handle: handle(p.author.handle),
        name: name(p.author.name, p.author.handle),
        followers: p.author.followers,
        verified: p.author.verified,
        ...(p.author.isProtected === undefined ? {} : { isProtected: p.author.isProtected }),
      },
      text: shown,
      createdAt: p.createdAt,
      isReply: p.isReply,
      isRepost: p.isRepost,
      isPromoted: p.isPromoted,
      hasMedia: p.hasMedia,
      hasLink: p.hasLink,
      metrics: { ...p.metrics },
      avatarUrl: p.avatarUrl === null ? null : placeholder(id(p.author.userId)),
      media: p.media.map((m, n) => media(m, `${id(p.postId)}-${n}`)),
      quotedId: p.quotedId === null ? null : id(p.quotedId),
      replyToId: p.replyToId === null ? null : id(p.replyToId),
      replyingTo: p.replyingTo.map(handle),
      entities: entities(p.entities, shown),
      card: p.card === null ? null : card(p.card, id(p.postId)),
      poll:
        p.poll === null
          ? null
          : {
              ...p.poll,
              choices: p.poll.choices.map((c) => ({ label: text(c.label), votes: c.votes })),
            },
      note: p.note === null ? null : text(p.note),
      context:
        p.context === null
          ? null
          : {
              type: p.context.type,
              text: text(p.context.text),
              handle: p.context.handle === null ? null : handle(p.context.handle),
            },
      liked: p.liked,
      reposted: p.reposted,
      bookmarked: p.bookmarked,
      conversation:
        p.conversation === null ? null : { ...p.conversation, id: str(p.conversation.id) },
      edits: p.edits.map(id),
      editsRemaining: p.editsRemaining,
      editableUntil: p.editableUntil,
      aiGenerated: p.aiGenerated,
      translation:
        p.translation === null || translated === null
          ? null
          : {
              text: translated,
              entities: entities(p.translation.entities, translated),
              from: p.translation.from,
            },
    };
  };
  const user = (u: EngineUser): EngineUser => ({
    ...person(u),
    bannerUrl: u.bannerUrl === null ? null : placeholder(`banner-${id(u.userId)}`, 1500, 500),
    bio: text(u.bio),
    location: u.location === null ? null : text(u.location),
    website: u.website === null ? null : { url: "https://example.com/", display: "example.com" },
    joinedAt: u.joinedAt,
    followers: u.followers,
    following: u.following,
    posts: u.posts,
    verified: u.verified,
    isProtected: u.isProtected,
    youFollow: u.youFollow,
    followsYou: u.followsYou,
    pinnedPostId: u.pinnedPostId === null ? null : id(u.pinnedPostId),
    verifiedType: u.verifiedType,
    avatarShape: u.avatarShape,
    affiliate:
      u.affiliate === null
        ? null
        : {
            name: text(u.affiliate.name),
            badgeUrl: placeholder(`badge-${id(u.userId)}`, 40, 40),
            url: null,
          },
  });
  const notification = (n: EngineNotification): EngineNotification => ({
    id: str(n.id),
    kind: n.kind,
    icon: n.icon,
    text: text(n.text),
    at: n.at,
    users: n.users.map(person),
    postIds: n.postIds.map(id),
  });
  const list = (l: EngineList): EngineList => ({
    listId: id(l.listId),
    name: text(l.name),
    description: text(l.description),
    members: l.members,
    followers: l.followers,
    isPrivate: l.isPrivate,
    bannerUrl: l.bannerUrl === null ? null : placeholder(`list-${id(l.listId)}`, 1500, 500),
    owner: l.owner === null ? null : person(l.owner),
    group: l.group,
  });
  const community = (c: EngineCommunity): EngineCommunity => ({
    communityId: id(c.communityId),
    name: text(c.name),
    description: c.description === null ? null : text(c.description),
    bannerUrl:
      c.bannerUrl === null ? null : placeholder(`community-${id(c.communityId)}`, 1500, 500),
    members: c.members,
    topic: c.topic === null ? null : text(c.topic),
    rules: c.rules?.map((r) => ({ name: text(r.name), description: text(r.description) })) ?? null,
    joinPolicy: c.joinPolicy,
    role: c.role,
  });
  const trend = (t: EngineTrend, n: number): EngineTrend => {
    const shownName = text(t.name);
    return {
      name: shownName,
      context: t.context === null ? null : text(t.context),
      url: `https://x.com/search?q=${encodeURIComponent(shownName)}`,
      images: t.images.map((_, i) => placeholder(`trend-${n}-${i}`, 120, 120)),
      group: t.group,
    };
  };
  const viewerOf = (v: EngineViewer): EngineViewer => ({
    userId: v.userId === null ? null : id(v.userId),
    handle: handle(v.handle),
    name: v.name === null ? null : name(v.name, v.handle),
    avatarUrl: v.avatarUrl === null ? null : placeholder(v.userId === null ? "you" : id(v.userId)),
  });
  // What a request asked for, in the same disguise as the pages it names.
  const key = (op: string, k: string | null) => {
    if (k === null) return null;
    if (op === "NotificationsTimeline" || op === "CarouselQuery") return k;
    if (op === "UserByScreenName") return handle(k).toLowerCase();
    if (op === "SearchTimeline") {
      const at = k.indexOf(":");
      return `${k.slice(0, at)}:${text(k.slice(at + 1))}`;
    }
    if (op === "TweetDetail") {
      const [focal, mode] = k.split(":");
      return mode === undefined ? id(focal!) : `${id(focal!)}:${mode}`;
    }
    // A List's and a Community's own screens find them by the id in the key, Latest's order kept.
    const prefixed = /^(tag|list|community):([^:]*)(:\w+)?$/.exec(k);
    if (prefixed)
      return `${prefixed[1]}:${prefixed[1] === "tag" ? str(prefixed[2]!) : id(prefixed[2]!)}${prefixed[3] ?? ""}`;
    return /^\d+$/.test(k) ? id(k) : str(k);
  };

  // A Who to follow keeps X's entry prefix, which is how the capture knows one.
  const moduleId = (real: string) => `who-to-follow-${id(real)}`;
  return batches.map((b) => ({
    op: b.op,
    key: key(b.op, b.key),
    cursor: b.cursor === null ? null : str(b.cursor),
    top: b.top === null ? null : str(b.top),
    bottom: b.bottom === null ? null : str(b.bottom),
    posts: b.posts.map(post),
    users: b.users.map(user),
    people: b.people.map(id),
    sections: b.sections.map((s) => ({
      title: text(s.title),
      userIds: s.userIds.map(id),
      link: s.link?.replace(/\d{5,}/g, id) ?? null,
    })),
    order: b.order.map((x) => (b.modules.some((m) => m.id === x) ? moduleId(x) : id(x))),
    modules: b.modules.map((m) => ({
      id: moduleId(m.id),
      title: text(m.title),
      userIds: m.userIds.map(id),
    })),
    trends: b.trends.map(trend),
    notifications: b.notifications.map(notification),
    lists: b.lists.map(list),
    communities: b.communities.map(community),
    homeTabs:
      b.homeTabs === null
        ? null
        : b.homeTabs.map((t) => ({
            id: key("HomeTimeline", t.id) as typeof t.id,
            label: text(t.label),
          })),
    exploreTabs:
      b.exploreTabs === null
        ? null
        : b.exploreTabs.map((t) => ({ id: t.id, label: t.label, timelineId: str(t.timelineId) })),
    viewer: b.viewer === null ? null : viewerOf(b.viewer),
  }));
}

const SYLLABLES = "ka lo mi re su ta ve no di pa ru se lin mor tal ven sa ri bo ne".split(" ");
/** A made-up word as long as the real one (UTF-16 units), its case and digits in the same places. */
function madeUpWord(real: ReadonlyArray<string>, n: number) {
  let pool = "";
  for (let i = n; pool.length < 64; i = Math.floor(i / 7) + pool.length + 3)
    pool += SYLLABLES[i % SYLLABLES.length];
  let at = 0;
  return real
    .map((ch) => {
      const units = ch.length;
      if (/\p{N}/u.test(ch)) return String((n + at++) % 10).repeat(units);
      const fake = pool.slice(at, at + units);
      at += units;
      return ch === ch.toUpperCase() && ch !== ch.toLowerCase() ? fake.toUpperCase() : fake;
    })
    .join("");
}

const FIRST = "Mira Sam Noor Theo Ines Ravi Lena Kofi Yuki Omar Ada Jonas".split(" ");
const LAST = "Okafor Lind Haddad Brandt Silva Mehta Varga Mensah Sato Farouk Quinn Berg".split(" ");
const nameFor = (n: number) => `${FIRST[n % FIRST.length]} ${LAST[(n * 5 + 3) % LAST.length]}`;
const handleFor = (n: number) =>
  `${FIRST[n % FIRST.length]!.toLowerCase()}_${LAST[(n * 5 + 3) % LAST.length]!.toLowerCase()}${n >= FIRST.length ? n : ""}`;

// Made-up fixtures, so every native X screen has something to draw before anyone records.
const SYNTH_AT = "2026-11-01T12:00:00.000Z";
/** The made-up news story the first Today's News row opens. */
const STORY_ID = "900000600001";
/** One team's made-up standing, the rest of X's columns filled in from its record. */
const standing = (
  n: string,
  abbreviation: string,
  name: string,
  wins: number,
  losses: number,
  gamesBack: number,
) => ({
  teamId: String(900_000_700_000 + Number(n)),
  abbreviation,
  name,
  wins,
  losses,
  gamesBack,
  home: { wins: Math.ceil(wins / 2), losses: Math.floor(losses / 2) },
  road: { wins: Math.floor(wins / 2), losses: Math.ceil(losses / 2) },
  division: { wins: 6, losses: 2 },
  conference: { wins: 18, losses: 9 },
  pointsFor: 112.4,
  pointsAgainst: 108.9,
  pointDiff: 3.5,
  streak: "W2",
  lastTen: { wins: 7, losses: 3 },
});
const ago = (minutes: number) => new Date(Date.parse(SYNTH_AT) - minutes * 60_000).toISOString();
const NO_ENTITIES: EngineEntities = { urls: [], mentions: [], hashtags: [], cashtags: [] };

const person = (n: number, extra: Partial<EngineUser> = {}): EngineUser => {
  const userId = String(800_000_000_000 + n);
  return {
    userId,
    handle: handleFor(n),
    name: nameFor(n),
    avatarUrl: placeholder(userId),
    bannerUrl: placeholder(`banner-${userId}`, 1500, 500),
    bio: "Building small tools for people who write on the internet. Shipping every week.",
    location: "Lisbon",
    website: { url: "https://example.com/", display: "example.com" },
    joinedAt: "2019-03-01T00:00:00.000Z",
    followers: [48_200, 1_204, 312_000, 9_870, 640, 25_500][n % 6]!,
    following: [512, 301, 88, 1_204, 230, 701][n % 6]!,
    posts: [12_400, 870, 31_000, 4_100, 96, 2_300][n % 6]!,
    verified: n % 3 !== 1,
    isProtected: false,
    youFollow: n % 2 === 0,
    followsYou: n % 4 === 0,
    pinnedPostId: null,
    verifiedType: n === 2 ? "Business" : null,
    avatarShape: n === 2 ? "Square" : "Circle",
    affiliate: null,
    ...extra,
  };
};
const PEOPLE = Array.from({ length: 8 }, (_, n) => person(n));
const VIEWER: EngineViewer = {
  userId: "800000000099",
  handle: "you",
  name: "You",
  avatarUrl: placeholder("800000000099"),
};

let synthId = 0;
const say = (
  n: number,
  text: string,
  minutes: number,
  extra: Partial<EnginePost> = {},
): EnginePost => {
  const author = PEOPLE[n % PEOPLE.length]!;
  const views = 1_000 + ((n * 7_919 + minutes * 131) % 90_000);
  return {
    postId: String(700_000_000_000 + ++synthId),
    author: {
      userId: author.userId,
      handle: author.handle,
      name: author.name,
      followers: author.followers,
      verified: author.verified,
    },
    text,
    createdAt: ago(minutes),
    isReply: false,
    isRepost: false,
    isPromoted: false,
    hasMedia: false,
    hasLink: false,
    metrics: {
      views,
      likes: Math.round(views / 40),
      reposts: Math.round(views / 400),
      replies: Math.round(views / 300),
      quotes: Math.round(views / 2_000),
      bookmarks: Math.round(views / 250),
    },
    avatarUrl: author.avatarUrl,
    media: [],
    quotedId: null,
    replyToId: null,
    replyingTo: [],
    entities: NO_ENTITIES,
    card: null,
    poll: null,
    note: null,
    context: null,
    liked: false,
    reposted: false,
    bookmarked: false,
    conversation: null,
    edits: [],
    editsRemaining: null,
    editableUntil: null,
    aiGenerated: false,
    translation: null,
    ...extra,
  };
};
const photo = (seed: string): EngineMedia => ({
  kind: "photo",
  url: placeholder(seed, 1200, 675),
  videoUrl: null,
  width: 1200,
  height: 675,
  durationMs: null,
  altText: "A placeholder photo",
});
/** Calls that answer one thing, not a timeline: X sends them without page cursors. */
const UNPAGED = new Set([
  "Viewer",
  "UserByScreenName",
  "ListByRestId",
  "CarouselQuery",
  "CommunityQuery",
  "CommunitiesFetchOneQuery",
  // X's About ends its timeline after the moderators, with no cursors.
  "CommunityAboutTimeline",
  "TweetResultByRestId",
]);
/** A batch with the parts every response shares empty. */
const batch = (
  op: string,
  key: string | null,
  posts: ReadonlyArray<EnginePost>,
  extra: Partial<EngineBatch> = {},
): EngineBatch => ({
  op,
  key,
  cursor: null,
  top: UNPAGED.has(op) ? null : `top-${op}-${key ?? ""}`,
  bottom: UNPAGED.has(op) ? null : `bottom-${op}-${key ?? ""}`,
  posts,
  users: [],
  people: [],
  sections: [],
  order: posts.map((p) => p.postId),
  modules: [],
  trends: [],
  notifications: [],
  lists: [],
  communities: [],
  homeTabs: null,
  exploreTabs: null,
  viewer: null,
  ...extra,
});
const mention = (text: string, handleName: string): EngineEntities => {
  const at = text.indexOf(`@${handleName}`);
  return {
    ...NO_ENTITIES,
    mentions: [{ handle: handleName, indices: [at, at + handleName.length + 1] }],
  };
};

/** Every made-up fixture by name. Deterministic: the same files every run. */
export function synth(): Readonly<Record<string, Fixture>> {
  synthId = 0;
  const meta = (
    fixture: string,
    description: string,
    open: ReadonlyArray<string>,
  ): FixtureMeta => ({
    fixture,
    description,
    at: SYNTH_AT,
    open,
  });

  const quoted = say(
    3,
    "Shipped: drafts now keep their place in the queue when you edit them.",
    300,
  );
  const thread = [
    say(
      1,
      "Week 6 of building in public. Revenue is flat, retention is up. Thread on what changed:",
      50,
      {
        conversation: { id: "conv-1", index: 0, size: 2 },
      },
    ),
    say(1, "1/ We cut onboarding from 7 steps to 2. Activation went from 31% to 54%.", 49, {
      conversation: { id: "conv-1", index: 1, size: 2 },
      isReply: true,
    }),
  ];
  thread[1] = { ...thread[1]!, replyToId: thread[0]!.postId, replyingTo: [PEOPLE[1]!.handle] };
  const following = [
    say(0, "The best growth hack is still answering every reply for the first year.", 2),
    say(2, "Our changelog is the most read page on the site. Write it like a letter.", 9, {
      media: [photo("changelog")],
      hasMedia: true,
    }),
    ...thread,
    say(4, "What should we build next?", 70, {
      poll: {
        choices: [
          { label: "Scheduling", votes: 412 },
          { label: "Analytics", votes: 288 },
          { label: "Team seats", votes: 97 },
        ],
        endsAt: new Date(Date.parse(SYNTH_AT) + 2 * 86_400_000).toISOString(),
        final: false,
        voted: null,
      },
    }),
    say(5, "This is the clearest explanation of rate limits I have read.", 95, {
      hasLink: true,
      // X draws the link as the card, so its t.co has no place in the shown text.
      entities: {
        ...NO_ENTITIES,
        urls: [
          {
            url: "https://t.co/s1",
            expanded: "https://example.com/rate-limits",
            display: "example.com/rate-limits",
            indices: null,
          },
        ],
      },
      card: {
        kind: "link",
        url: "https://example.com/rate-limits",
        title: "Rate limits, explained with a coffee shop",
        domain: "example.com",
        description: "Why your client gets a 429, and how to back off without losing data.",
        imageUrl: placeholder("card-rate-limits", 1200, 628),
      },
    }),
    say(6, "This, but for every SaaS settings page.", 130, { quotedId: quoted.postId }),
    quoted,
    say(0, "Shipping a redesign tomorrow. Nervous and excited.", 180, {
      context: { type: "Retweet", text: `${PEOPLE[2]!.name} reposted`, handle: PEOPLE[2]!.handle },
    }),
    say(
      7,
      "Hot take: dark mode should be the default for developer tools. Reply with your counterexample.",
      240,
      {
        liked: true,
        note: "Readers added context: several surveys show a split preference among developers.",
      },
    ),
  ];
  const forYou = [
    say(3, "Ten years of indie hacking, compressed into one rule: charge from day one.", 15, {
      media: [photo("indie-1"), photo("indie-2")],
      hasMedia: true,
    }),
    say(5, "We grew to 10k users without ads. Here is the whole playbook, no paywall.", 33),
    say(
      2,
      "Launching on Product Hunt next Tuesday. Any tips from people who did it this year?",
      61,
      {
        aiGenerated: true,
        media: [photo("launch")],
        hasMedia: true,
      },
    ),
    say(6, "Reminder: your landing page headline is doing 80% of the work.", 140, {
      bookmarked: true,
    }),
    say(4, "লঞ্চের আগে তিনটি জিনিস পরীক্ষা করুন।", 200, {
      translation: { text: "Test three things before launch.", entities: NO_ENTITIES, from: "bn" },
    }),
  ];
  // People the account does not follow yet, apart from the authors.
  const suggest = [8, 9, 10].map((n) => person(n, { youFollow: false, followsYou: false }));
  const whoToFollow = {
    id: "who-to-follow-700000000900",
    title: "Who to follow",
    userIds: suggest.map((u) => u.userId),
  };
  // X serves ads in Following too, from accounts the user does not follow. Built apart from `say`
  // so every other fixture keeps its ids.
  const ad: EnginePost = {
    ...forYou[1]!,
    postId: "700000000990",
    author: {
      userId: suggest[0]!.userId,
      handle: suggest[0]!.handle,
      name: suggest[0]!.name,
      followers: suggest[0]!.followers,
      verified: suggest[0]!.verified,
    },
    avatarUrl: suggest[0]!.avatarUrl,
    text: "One dashboard for every deploy. Try it free for 14 days.",
    createdAt: ago(50),
    isPromoted: true,
  };
  const home: Fixture = {
    meta: meta(
      "home",
      "Home: Following (text, photo, a thread, an ad, a poll, a link card, a quote, a repost, a note) and For you with Who to follow",
      ["/home?feed=following", "/home?feed=forYou"],
    ),
    batches: [
      batch("Viewer", null, [], { viewer: VIEWER }),
      batch("HomeLatestTimeline", null, following.toSpliced(4, 0, ad), {
        users: [...PEOPLE, suggest[0]!],
      }),
      batch("HomeTimeline", null, forYou, {
        users: [...PEOPLE, ...suggest],
        people: suggest.map((u) => u.userId),
        // X puts its Who to follow a few posts down For you.
        order: forYou.map((p) => p.postId).toSpliced(2, 0, whoToFollow.id),
        modules: [whoToFollow],
      }),
    ],
  };

  const focal = say(
    2,
    "We just open sourced our design system. 2 years of work, MIT licensed.",
    45,
    {
      media: [photo("design-system")],
      hasMedia: true,
    },
  );
  // X moves the handle a reply starts with out of its text, into "Replying to".
  const reply = (n: number, text: string, minutes: number) =>
    say(n, text, minutes, {
      isReply: true,
      replyToId: focal.postId,
      replyingTo: [focal.author.handle],
    });
  const replies = [
    reply(0, "This is incredibly generous. Starring it now.", 40),
    reply(4, "How do you handle theming across products?", 38),
    reply(5, "Docs are beautiful. What did you use to build them?", 31),
    reply(7, "Finally a design system with real accessibility notes.", 22),
  ];
  const post: Fixture = {
    meta: meta("post", "A post page: the focal post with a photo and four replies", [
      `/post/${focal.postId}?h=${focal.author.handle}`,
    ]),
    batches: [batch("TweetDetail", focal.postId, [focal, ...replies], { users: PEOPLE })],
  };

  // An X Article: its post carries the card, X's reader page the body. Built apart from `say` so
  // every other fixture keeps its ids.
  const writer = PEOPLE[3]!;
  const essay: EnginePost = {
    ...following[0]!,
    postId: "700000000980",
    author: {
      userId: writer.userId,
      handle: writer.handle,
      name: writer.name,
      followers: writer.followers,
      verified: writer.verified,
    },
    avatarUrl: writer.avatarUrl,
    text: "",
    createdAt: ago(400),
    card: {
      kind: "article",
      url: "https://x.com/i/article/600000000201",
      title: "How we priced our first plan",
      domain: null,
      description: "Three experiments, one spreadsheet, and the number we landed on.",
      imageUrl: placeholder("article-cover", 1500, 600),
    },
  };
  const para = (key: string, type: string, text: string, extra: Partial<EngineArticleBlock> = {}) =>
    ({
      key,
      type,
      text,
      styles: [],
      links: [],
      images: [],
      markdown: null,
      ...extra,
    }) satisfies EngineArticleBlock;
  const body: EngineArticle = {
    postId: essay.postId,
    blocks: [
      para(
        "a",
        "unstyled",
        "We changed our price four times in a year. Each change taught us one thing.",
        {
          styles: [{ offset: 48, length: 6, style: "Italic" }],
        },
      ),
      para("b", "header-two", "What we tried"),
      para("c", "unordered-list-item", "A free plan with a usage cap", {
        styles: [{ offset: 2, length: 9, style: "Bold" }],
      }),
      para("d", "unordered-list-item", "One paid plan at $19"),
      para("e", "unordered-list-item", "Annual billing with two months off"),
      para("f", "atomic", " ", {
        images: [{ url: placeholder("article-chart", 1200, 675), width: 1200, height: 675 }],
      }),
      para("g", "blockquote", "Charge from day one. The users who pay tell you what matters."),
      para("h", "header-two", "The numbers"),
      para("i", "atomic", " ", {
        markdown:
          "| Plan | Price | Signups |\n| --- | --- | --- |\n| Free | $0 | 412 |\n| Pro | $19 | 97 |",
      }),
      para("j", "ordered-list-item", "Price for the user you want"),
      para("k", "ordered-list-item", "Raise it before it feels comfortable"),
      para("l", "atomic", " ", { markdown: "```ts\nconst price = 19;\n```" }),
      para("m", "unstyled", "The full spreadsheet is on our blog.", {
        links: [{ offset: 27, length: 8, url: "https://example.com/pricing" }],
      }),
    ],
  };
  const article: Fixture = {
    meta: meta(
      "article",
      "An X Article: cover, title, the author row, and a body with every kind of block",
      [`/article/${essay.postId}?h=${essay.author.handle}`],
    ),
    batches: [
      batch("TweetResultByRestId", null, [essay], { users: PEOPLE, order: [], articles: [body] }),
    ],
  };

  const profileUser = PEOPLE[0]!;
  const pinned = say(
    0,
    "Start here: everything I learned growing an account from zero to 48k.",
    9_000,
    {
      context: { type: "Pin", text: "Pinned", handle: null },
    },
  );
  const own = [pinned, ...following.filter((p) => p.author.userId === profileUser.userId)];
  const profile: Fixture = {
    meta: meta("profile", `@${profileUser.handle}'s profile: header, pinned post, posts`, [
      `/u/${profileUser.handle}`,
    ]),
    batches: [
      batch("UserByScreenName", profileUser.handle, [], {
        users: [{ ...profileUser, pinnedPostId: pinned.postId }],
      }),
      batch("UserTweets", profileUser.userId, own, { users: PEOPLE }),
    ],
  };

  const event = (
    n: number,
    icon: string,
    text: string,
    who: ReadonlyArray<number>,
    postIds: ReadonlyArray<string>,
    minutes: number,
  ): EngineNotification => ({
    id: `n-${n}`,
    kind: "event",
    icon,
    text,
    at: ago(minutes),
    users: who.map((i) => {
      const u = PEOPLE[i]!;
      return { userId: u.userId, handle: u.handle, name: u.name, avatarUrl: u.avatarUrl };
    }),
    postIds,
  });
  const mine = say(0, "Small wins: our onboarding email now gets a 41% reply rate.", 600);
  const mentionText = `@you this is the kind of tool I was looking for`;
  const mentionPost = say(5, mentionText, 12, { entities: mention(mentionText, "you") });
  const notifications: Fixture = {
    meta: meta(
      "notifications",
      "Notifications: likes, reposts and follows grouped with faces, and a mention",
      ["/notifications", "/notifications?tab=mentions"],
    ),
    batches: [
      // The mention is the page's one post entry; the liked and reposted post rides in its events.
      batch("NotificationsTimeline", "All", [mentionPost, mine], {
        users: PEOPLE,
        order: [mentionPost.postId],
        notifications: [
          {
            id: `post-${mentionPost.postId}`,
            kind: "post",
            icon: "",
            text: "",
            at: null,
            users: [],
            postIds: [mentionPost.postId],
          },
          event(
            1,
            "heart_icon",
            `${PEOPLE[1]!.name} and 3 others liked your post`,
            [1, 2, 3, 4],
            [mine.postId],
            20,
          ),
          event(2, "person_icon", `${PEOPLE[6]!.name} followed you`, [6], [], 75),
          event(
            3,
            "retweet_icon",
            `${PEOPLE[3]!.name} reposted your post`,
            [3],
            [mine.postId],
            140,
          ),
        ],
      }),
      batch("NotificationsTimeline", "Mentions", [mentionPost], {
        users: PEOPLE,
        notifications: [
          {
            id: `post-${mentionPost.postId}`,
            kind: "post",
            icon: "",
            text: "",
            at: null,
            users: [],
            postIds: [mentionPost.postId],
          },
        ],
      }),
    ],
  };

  const query = "design system";
  const search: Fixture = {
    meta: meta("search", `Search "${query}": Top posts and People`, [
      `/search?q=${encodeURIComponent(query)}&f=top`,
      `/search?q=${encodeURIComponent(query)}&f=people`,
    ]),
    batches: [
      batch("SearchTimeline", `Top:${query}`, [focal, ...forYou.slice(0, 3)], { users: PEOPLE }),
      batch("SearchTimeline", `People:${query}`, [], {
        users: PEOPLE,
        people: PEOPLE.slice(0, 5).map((u) => u.userId),
      }),
    ],
  };

  const bookmarks: Fixture = {
    meta: meta("bookmarks", "Bookmarks: three saved posts", ["/bookmarks"]),
    batches: [
      batch(
        "Bookmarks",
        null,
        [forYou[3]!, following[4]!, focal].map((p) => ({ ...p, bookmarked: true })),
        {
          users: PEOPLE,
        },
      ),
    ],
  };

  const tabs = [
    { id: "for_you", label: "For you", timelineId: "explore-for-you" },
    { id: "trending", label: "Trending", timelineId: "explore-trending" },
    { id: "news", label: "News", timelineId: "explore-news" },
  ];
  // X's For you opens with Today's News, then trends on their own.
  const trends: ReadonlyArray<EngineTrend> = [
    {
      name: "A new open source license for AI models",
      context: "2 hours ago · News · 3.1K posts",
      // A news story opens X's story page.
      url: `https://x.com/i/trending/${STORY_ID}`,
      images: [PEOPLE[2]!.avatarUrl!, PEOPLE[4]!.avatarUrl!],
      group: "Today's News",
    },
    {
      name: "Indie founders share their 2026 numbers",
      context: "5 hours ago · Business · 980 posts",
      url: "https://x.com/search?q=indie",
      images: [PEOPLE[0]!.avatarUrl!],
      group: "Today's News",
    },
    {
      name: "#BuildInPublic",
      context: "Trending in Technology",
      url: "https://x.com/search?q=%23BuildInPublic",
      images: [],
      group: null,
    },
    {
      name: "Design systems",
      context: "Technology · 12.4K posts",
      url: "https://x.com/search?q=Design%20systems",
      images: [],
      group: null,
    },
  ];
  // Then Who to follow, and Posts For You: the start of the feed X pages in as it scrolls.
  const recommended = [forYou[1]!, following[0]!, following[1]!, forYou[3]!];
  const exploreModules = [
    { id: "who-to-follow-700000000901", title: "Who to follow", userIds: whoToFollow.userIds },
    { id: `tweet-${recommended[0]!.postId}`, title: "Posts For You", userIds: [] },
  ];
  const explore: Fixture = {
    meta: meta(
      "explore",
      "Explore: For you with Today's News, trends, Who to follow and Posts For You",
      ["/explore"],
    ),
    batches: [
      batch("ExplorePage", "explore-for-you", recommended, {
        trends,
        exploreTabs: tabs,
        users: [...PEOPLE, ...suggest],
        people: whoToFollow.userIds,
        order: [...exploreModules.map((m) => m.id), ...recommended.map((p) => p.postId)],
        modules: exploreModules,
      }),
    ],
  };

  const owned: EngineList = {
    listId: "600000000001",
    name: "Indie founders",
    description: "People building profitable small software companies.",
    members: 42,
    followers: 1_310,
    isPrivate: false,
    bannerUrl: placeholder("list-indie", 1500, 500),
    owner: {
      userId: VIEWER.userId!,
      handle: VIEWER.handle,
      name: VIEWER.name!,
      avatarUrl: VIEWER.avatarUrl,
    },
    group: "Your Lists",
  };
  const discover: EngineList = {
    ...owned,
    listId: "600000000002",
    name: "Design engineers",
    description: "Designers who ship code.",
    members: 118,
    followers: 30_553,
    owner: {
      userId: PEOPLE[2]!.userId,
      handle: PEOPLE[2]!.handle,
      name: PEOPLE[2]!.name,
      avatarUrl: PEOPLE[2]!.avatarUrl,
    },
    group: "Discover new Lists",
  };
  const lists: Fixture = {
    meta: meta("lists", "Lists: your List and one to discover, and the List's own timeline", [
      "/lists",
      `/lists/${owned.listId}`,
    ]),
    batches: [
      batch("ListsManagementPageTimeline", null, [], { lists: [discover, owned] }),
      // A List's own page names no section it sits in.
      batch("ListByRestId", `list:${owned.listId}`, [], { lists: [{ ...owned, group: null }] }),
      batch("ListLatestTweetsTimeline", `list:${owned.listId}`, forYou.slice(0, 3), {
        users: PEOPLE,
      }),
    ],
  };

  const connect = (tab: "who" | "creators", people: ReadonlyArray<EngineUser>) =>
    batch("ConnectTabTimeline", `connect:${tab}`, [], {
      users: people,
      people: people.map((u) => u.userId),
    });
  // X suggests people the account does not follow yet.
  const suggested = PEOPLE.map((u) => ({ ...u, youFollow: false }));
  const follow: Fixture = {
    meta: meta("follow", "Follow: Who to follow with Follow, Creators for you with Subscribe", [
      "/follow",
      "/follow?tab=creators",
    ]),
    batches: [connect("who", suggested), connect("creators", suggested.slice(2, 6))],
  };

  // Two Communities the user is in (the carousel), an open one and one that asks first (Explore).
  const rules = [
    { name: "Be kind", description: "Argue with ideas, not people." },
    { name: "Stay on topic", description: "Posts about building and selling software." },
    { name: "No spam", description: "Promote your work once a week at most." },
  ];
  const community = (
    n: number,
    name: string,
    extra: Partial<EngineCommunity>,
  ): EngineCommunity => ({
    communityId: String(600_000_000_100 + n),
    name,
    description: "Founders sharing what worked, what did not, and the numbers.",
    bannerUrl: placeholder(`community-${n}`, 1500, 500),
    members: [12_400, 3_310, 845, 52_000][n % 4]!,
    topic: "Makers and tools",
    rules,
    joinPolicy: "Open",
    role: "Member",
    ...extra,
  });
  const joined = [community(1, "Indie hackers", {}), community(2, "Design engineers", {})];
  const open = community(3, "Bootstrapped SaaS", { role: "NonMember" });
  const asks = community(4, "Founder therapy", {
    role: "NonMember",
    joinPolicy: "RestrictedJoinRequestsRequireModeratorApproval",
  });
  const labelled = (c: EngineCommunity, posts: ReadonlyArray<EnginePost>) =>
    posts.map((p) => ({ ...p, context: { type: "Community", text: c.name, handle: null } }));
  // A tile names only the Community and its banner; its card and its own page say the rest.
  const tile = (c: EngineCommunity): EngineCommunity => ({
    ...c,
    description: null,
    members: null,
    topic: null,
    rules: null,
    joinPolicy: null,
    role: null,
  });
  const inOpen = [
    say(4, "Crossed $10k MRR this morning. No ads, no funding, eighteen months.", 25),
    say(6, "Annual plans paid for our first hire. Offer them earlier than you think.", 70, {
      media: [photo("community-chart")],
      hasMedia: true,
    }),
    say(1, "What is everyone using for invoicing these days?", 140),
  ];
  // X's search of Communities: what it finds names each one's banner, members and topic only.
  const searched = (c: EngineCommunity): EngineCommunity => ({
    ...c,
    description: null,
    rules: null,
    joinPolicy: null,
    role: null,
  });
  const fromCommunities = [
    ...labelled(open, inOpen.slice(0, 2)),
    ...labelled(asks, following.slice(0, 1)),
  ];
  const communities: Fixture = {
    meta: meta(
      "communities",
      "Communities: the hub's Home, Explore and search, a Community's tabs, Join and Ask to join",
      [
        "/communities",
        "/communities?tab=explore",
        "/communities?q=founders",
        "/communities?q=founders&tab=top",
        `/communities/${open.communityId}`,
      ],
    ),
    batches: [
      batch("CarouselQuery", "communities:mine", [], { communities: joined.map(tile) }),
      batch(
        "CommunitiesRankedTimeline",
        null,
        [...labelled(joined[0]!, forYou.slice(0, 2)), ...labelled(joined[1]!, forYou.slice(2, 3))],
        { users: PEOPLE },
      ),
      batch(
        "CommunitiesExploreTimeline",
        null,
        [...labelled(open, inOpen.slice(0, 2)), ...labelled(asks, following.slice(0, 1))],
        { users: PEOPLE },
      ),
      ...[...joined, open, asks].map((c) =>
        batch("CommunitiesFetchOneQuery", `community:${c.communityId}`, [], { communities: [c] }),
      ),
      batch("CommunityQuery", `community:${open.communityId}`, [], { communities: [open] }),
      batch("CommunityTweetsTimeline", `community:${open.communityId}`, inOpen, {
        users: PEOPLE,
      }),
      batch(
        "CommunityTweetsTimeline",
        `community:${open.communityId}:Recency`,
        inOpen.toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
        { users: PEOPLE },
      ),
      batch(
        "CommunityMediaTimeline",
        `community:${open.communityId}`,
        inOpen.filter((p) => p.hasMedia),
        { users: PEOPLE },
      ),
      // X's About: a few of its moderators, then of its members, each box with "Show more".
      batch("CommunityAboutTimeline", `community:${open.communityId}`, [], {
        users: PEOPLE,
        people: [4, 6, 0, 1, 2].map((n) => PEOPLE[n]!.userId),
        sections: [
          { title: "Moderators", people: [4, 6], page: "moderators" },
          { title: "Members", people: [0, 1, 2], page: "members" },
        ].map((s) => ({
          title: s.title,
          userIds: s.people.map((n) => PEOPLE[n]!.userId),
          link: `https://x.com/i/communities/${open.communityId}/${s.page}`,
        })),
      }),
      // The hub's search for "founders": X's Communities tab names no page cursors.
      batch("CommunitiesSearchQuery", "founders", [], {
        top: null,
        bottom: null,
        communities: [asks, open, joined[0]!].map(searched),
      }),
      batch(
        "GlobalCommunitiesPostSearchTimeline",
        "founders",
        fromCommunities.toSorted((a, b) => b.metrics.likes - a.metrics.likes),
        { users: PEOPLE },
      ),
      batch(
        "GlobalCommunitiesLatestPostSearchTimeline",
        "founders",
        fromCommunities.toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
        { users: PEOPLE },
      ),
    ],
  };

  // One of the user's own posts, on their profile, and X's Post Analytics for it.
  const you = person(99, { handle: VIEWER.handle, name: VIEWER.name! });
  const yours = say(0, "Rewrote our pricing page in one afternoon. Three plans became one.", 180, {
    author: {
      userId: you.userId,
      handle: you.handle,
      name: you.name,
      followers: you.followers,
      verified: you.verified,
    },
    avatarUrl: you.avatarUrl,
  });
  const analytics: Fixture = {
    meta: meta("analytics", "Post Analytics: X's numbers for one of your own posts", [
      `/post/${yours.postId}/analytics?h=${you.handle}`,
    ]),
    batches: [
      batch("UserTweets", you.userId, [yours], { users: [you] }),
      batch("TweetActivityQuery", yours.postId, [], {
        top: null,
        bottom: null,
        // X sends a zero without its value, and counts Follows, which its page does not draw.
        analytics: {
          DetailExpands: 214,
          Engagements: 1_380,
          Follows: 0,
          Impressions: 48_210,
          LinkClicks: 0,
          ProfileVisits: 96,
        },
      }),
    ],
  };

  // A made-up team: its profile carries X's schedule, and its live game opens a game page.
  const team = person(20, {
    bio: "Official account of the Harbor Hawks.",
    location: "Harbor City",
    verifiedType: "Business",
    avatarShape: "Square",
    // X's header says it for everyone; a team offers no Subscriptions.
    offersSubscriptions: false,
  });
  const side = (abbreviation: string, name: string, points: number | null) => ({
    abbreviation,
    name,
    points,
    timeouts: null,
    bonus: null,
  });
  const HBH = side("HBH", "Hawks", null);
  const game = (
    n: number,
    status: string,
    days: number,
    away: EngineGame["away"],
    home: EngineGame["home"],
  ): EngineGame => ({
    gameId: String(900_000_500_000 + n),
    status,
    startsAt: new Date(Date.parse(SYNTH_AT) + days * 86_400_000).toISOString(),
    away,
    home,
    period: null,
    periodType: null,
    clock: null,
    halftime: false,
    lastPlay: null,
  });
  const liveGame: EngineGame = {
    ...game(4, "IN_PROGRESS", 0, side("RVR", "Rays", 82), side("HBH", "Hawks", 104)),
    away: { ...side("RVR", "Rays", 82), timeouts: 3, bonus: true },
    home: { ...side("HBH", "Hawks", 104), timeouts: 5, bonus: false },
    period: 3,
    periodType: "QUARTER",
    clock: "04:12",
    lastPlay: { kind: "REBOUND", description: "Rays offensive rebound" },
  };
  const season = [
    game(1, "COMPLETED", -6, { ...HBH, points: 132 }, side("MTN", "Peaks", 123)),
    game(2, "COMPLETED", -4, side("CTY", "Lights", 108), { ...HBH, points: 97 }),
    game(3, "COMPLETED", -2, { ...HBH, points: 115 }, side("BAY", "Gulls", 111)),
    liveGame,
    game(5, "SCHEDULED", 2, side("DES", "Dunes", null), HBH),
    game(6, "SCHEDULED", 4, HBH, side("FRS", "Pines", null)),
  ];
  const day = [
    game(7, "COMPLETED", 0, side("MTN", "Peaks", 101), side("CTY", "Lights", 99)),
    liveGame,
    { ...game(8, "IN_PROGRESS", 0, side("BAY", "Gulls", 54), side("DES", "Dunes", 60)), period: 2 },
  ];
  const fans = [
    say(1, "Third quarter and the Hawks are pulling away. That bench is deep.", 4),
    say(5, "Rays need a timeout here, three straight turnovers.", 7),
    say(3, "Best home crowd of the season tonight.", 11),
  ];
  const sports: Fixture = {
    meta: meta(
      "sports",
      "A team's profile with X's schedule carousel, and its live game: the day's strip, X's header, Top and Latest",
      [`/u/${team.handle}`, `/nba/game/${liveGame.gameId}`],
    ),
    batches: [
      batch("UserByScreenName", team.handle, [], { users: [team] }),
      batch("UserSportsProfile", team.userId, [], { top: null, bottom: null, games: season }),
      batch("NBASchedule", null, [], { top: null, bottom: null, games: day }),
      // X's league page: standings by conference and division, and its stat leaders.
      batch("NBAStandings", null, [], {
        top: null,
        bottom: null,
        standings: [
          {
            name: "East",
            divisions: [
              {
                name: "Atlantic",
                teams: [
                  standing("1", "HBH", "Hawks", 30, 12, 0),
                  standing("2", "BAY", "Gulls", 26, 16, 4),
                ],
              },
            ],
          },
          {
            name: "West",
            divisions: [
              {
                name: "Pacific",
                teams: [
                  standing("3", "RVR", "Rays", 28, 14, 0),
                  standing("4", "DES", "Dunes", 19, 23, 9),
                ],
              },
            ],
          },
        ],
      }),
      batch("NBALeaders", null, [], {
        top: null,
        bottom: null,
        leaders: [
          {
            key: "points",
            title: "Points Per Game",
            leaders: [
              { rank: 1, name: "M. Okafor", position: "G", value: "31.4", headshotUrl: null },
              { rank: 2, name: "T. Varga", position: "F", value: "29.8", headshotUrl: null },
            ],
          },
          {
            key: "rebounds",
            title: "Rebounds Per Game",
            leaders: [
              { rank: 1, name: "K. Mensah", position: "C", value: "12.9", headshotUrl: null },
            ],
          },
        ],
      }),
      batch("NBAGameHydrate", liveGame.gameId, [], { top: null, bottom: null, games: [liveGame] }),
      batch("SportsGameTopTimeline", liveGame.gameId, fans, { users: PEOPLE }),
      batch("SportsGameLatestTimeline", liveGame.gameId, fans.toReversed(), { users: PEOPLE }),
    ],
  };

  // X's news story behind the first Today's News row: Grok's summary, then its Top and Latest.
  const storyPosts = [
    say(1, "The license allows commercial use but asks for attribution in model cards.", 30),
    say(3, "Read the whole thing. The patent clause is the interesting part.", 55),
    say(5, "We switched our weights to it this morning.", 12),
  ];
  const news: Fixture = {
    meta: meta("news", "A news story from Explore: X's summary, its Top and Latest posts", [
      `/trending/${STORY_ID}`,
    ]),
    batches: [
      batch("AiTrendByRestId", STORY_ID, [], {
        top: null,
        bottom: null,
        story: {
          title: "A new open source license for AI models",
          summary:
            "A group of labs published a license for model weights that allows commercial use with attribution. Developers are comparing it with existing open source licenses.",
          updatedAt: ago(20),
          disclaimer: "This story is a summary of posts on X and may evolve over time.",
          timelines: [
            { label: "Top", timelineId: "story-top" },
            { label: "Latest", timelineId: "story-latest" },
          ],
        },
      }),
      batch("GenericTimelineById", "story-top", storyPosts.slice(0, 2), { users: PEOPLE }),
      batch("GenericTimelineById", "story-latest", [storyPosts[2]!], { users: PEOPLE }),
    ],
  };

  return {
    home,
    post,
    article,
    profile,
    notifications,
    search,
    bookmarks,
    explore,
    lists,
    follow,
    communities,
    analytics,
    news,
    sports,
  };
}
