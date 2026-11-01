// Engine fixtures: recorded or made-up X engine batches that dev replays into the store, so the
// native X screens render in a plain browser. Type imports only: scripts/engine-fixture.ts runs
// this file under Node as is.
import type {
  EngineBatch,
  EngineCard,
  EngineEntities,
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

export const parseFixture = (raw: string): Fixture => {
  const [meta, ...batches] = raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line): unknown => JSON.parse(line));
  if (typeof meta !== "object" || meta === null || !("fixture" in meta))
    throw new Error("an engine fixture starts with its meta line");
  return { meta: meta as FixtureMeta, batches: batches as ReadonlyArray<EngineBatch> };
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
  "a an and are as at be but by for from has have he her his i in is it its me my no not of on or our she so that the their them they this to us was we were what when who will with you your pinned reposted liked replying followed post posts reply replies others more show translated original new".split(
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
  const handle = (real: string) => {
    const key = real.toLowerCase();
    let fake = handles.get(key);
    if (fake === undefined) handles.set(key, (fake = handleFor(handles.size)));
    return fake;
  };
  const name = (real: string) => {
    let fake = names.get(real);
    if (fake === undefined) names.set(real, (fake = nameFor(names.size)));
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
  const person = (u: Pick<EngineUser, "userId" | "handle" | "name" | "avatarUrl">) => ({
    userId: id(u.userId),
    handle: handle(u.handle),
    name: name(u.name),
    avatarUrl: u.avatarUrl === null ? null : placeholder(id(u.userId)),
  });
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
        name: name(p.author.name),
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
    name: v.name === null ? null : name(v.name),
    avatarUrl: v.avatarUrl === null ? null : placeholder(v.userId === null ? "you" : id(v.userId)),
  });
  // What a request asked for, in the same disguise as the pages it names.
  const key = (op: string, k: string | null) => {
    if (k === null) return null;
    if (op === "NotificationsTimeline") return k;
    if (op === "UserByScreenName") return handle(k).toLowerCase();
    if (op === "SearchTimeline") {
      const at = k.indexOf(":");
      return `${k.slice(0, at)}:${text(k.slice(at + 1))}`;
    }
    if (op === "TweetDetail") {
      const [focal, mode] = k.split(":");
      return mode === undefined ? id(focal!) : `${id(focal!)}:${mode}`;
    }
    const prefixed = /^(tag|list|community):(.*)$/.exec(k);
    if (prefixed)
      return `${prefixed[1]}:${prefixed[1] === "list" ? id(prefixed[2]!) : str(prefixed[2]!)}`;
    return /^\d+$/.test(k) ? id(k) : str(k);
  };

  return batches.map((b) => ({
    op: b.op,
    key: key(b.op, b.key),
    cursor: b.cursor === null ? null : str(b.cursor),
    top: b.top === null ? null : str(b.top),
    bottom: b.bottom === null ? null : str(b.bottom),
    posts: b.posts.map(post),
    users: b.users.map(user),
    people: b.people.map(id),
    order: b.order.map(id),
    trends: b.trends.map(trend),
    notifications: b.notifications.map(notification),
    lists: b.lists.map(list),
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
  top: `top-${op}-${key ?? ""}`,
  bottom: `bottom-${op}-${key ?? ""}`,
  posts,
  users: [],
  people: [],
  order: posts.map((p) => p.postId),
  trends: [],
  notifications: [],
  lists: [],
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
  const home: Fixture = {
    meta: meta(
      "home",
      "Home: Following (text, photo, a thread, a poll, a link card, a quote, a repost, a note) and For you",
      ["/home?feed=following", "/home?feed=forYou"],
    ),
    batches: [
      batch("Viewer", null, [], { viewer: VIEWER }),
      batch("HomeLatestTimeline", null, following, { users: PEOPLE }),
      batch("HomeTimeline", null, forYou, { users: PEOPLE }),
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
  const reply = (n: number, text: string, minutes: number) =>
    say(n, `@${focal.author.handle} ${text}`, minutes, {
      isReply: true,
      replyToId: focal.postId,
      replyingTo: [focal.author.handle],
      entities: mention(`@${focal.author.handle} ${text}`, focal.author.handle),
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
      batch("NotificationsTimeline", "All", [mine, mentionPost], {
        users: PEOPLE,
        order: [],
        notifications: [
          {
            id: `post-${mentionPost.postId}`,
            kind: "post",
            icon: "",
            text: "",
            at: ago(12),
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
            at: ago(12),
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
  const trends: ReadonlyArray<EngineTrend> = [
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
    {
      name: "A new open source license for AI models",
      context: "2 hours ago · News · 3.1K posts",
      url: "https://x.com/search?q=license",
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
  ];
  const explore: Fixture = {
    meta: meta("explore", "Explore: For you tab with trends, today's news and Who to follow", [
      "/explore",
    ]),
    batches: [
      batch("ExplorePage", "explore-for-you", [], {
        trends,
        exploreTabs: tabs,
        users: PEOPLE,
        people: [PEOPLE[3]!.userId, PEOPLE[5]!.userId],
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
      batch("ListByRestId", `list:${owned.listId}`, [], { lists: [owned] }),
      batch("ListLatestTweetsTimeline", `list:${owned.listId}`, forYou.slice(0, 3), {
        users: PEOPLE,
      }),
    ],
  };

  return { home, post, profile, notifications, search, bookmarks, explore, lists };
}
