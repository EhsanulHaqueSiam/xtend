/**
 * Mock X's Grok as bundle.GrokXWeb draws it on x.com/i/grok, its History panel and model menu in
 * templates the page script shows. X's Grok talks to grok.com, not X's GraphQL, so no request is
 * made for it; what X's controls change goes to `/__mock/grok` (`write`).
 */

const esc = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

interface MockTurn {
  readonly id: string;
  readonly question: string;
  /** X's answer as markdown X already rendered; null while Grok thinks. */
  answer: string | null;
  /** Still streaming: X shows Stop and no actions under it. */
  streaming: boolean;
  feedback: "up" | "down" | null;
  /** X's usage limit in place of an answer (a non-Premium account past X's free limit). */
  limited: boolean;
  /** Grok answered with an image, which X's page draws from a blob of its own. */
  readonly image?: boolean;
}

interface MockGrokConversation {
  readonly id: string;
  title: string;
  starred: boolean;
  /** X's age line and group, as X's History draws them. */
  readonly age: string;
  readonly group: "Today" | "Yesterday" | "Last 7 days";
  readonly turns: Array<MockTurn>;
}

/** X's modes as its server lists them (POST /rest/modes): title, description, availability. */
const MODES = [
  { title: "Auto", description: "Chooses Fast or Expert", availability: "available" },
  { title: "Fast", description: "Quick responses", availability: "available" },
  { title: "Expert", description: "Thinks hard", availability: "available" },
  { title: "Heavy", description: "Team of experts", availability: "requiresUpgrade" },
] as const;

const ANSWERS = [
  `<h2 data-streamdown="heading-2">For two plans</h2><ul data-streamdown="unordered-list"><li data-streamdown="list-item"><span data-streamdown="strong"><strong>Less to compare.</strong></span> <a data-streamdown="link" href="https://x.com/jonpark">@jonpark</a> posted a test where dropping the middle plan lifted signups.</li></ul><p>Against it, @lenaw says a middle plan anchors the top one.</p>`,
  `<p>Replies split between people sharing their own failed rollbacks and people defending Friday deploys.</p>`,
];

/** What mock X's Grok holds: made-up conversations, X's pick of model, Private, and its limit. */
export function createMockGrok(limited: boolean) {
  const conversations: Array<MockGrokConversation> = [
    {
      id: "c-recap",
      title: "Weekly niche recap",
      starred: true,
      age: "2 days ago",
      group: "Last 7 days",
      turns: [
        {
          id: "t1",
          question: "Recap my niche this week",
          answer: "<p>Pricing pages and onboarding emails led the week.</p>",
          streaming: false,
          feedback: null,
          limited: false,
        },
      ],
    },
    {
      id: "c-pricing",
      title: "Two-plan pricing arguments",
      starred: false,
      age: "3 hours ago",
      group: "Today",
      turns: [
        {
          id: "t2",
          question: "What are founders saying about two-plan pricing pages this week?",
          answer: ANSWERS[0]!,
          streaming: false,
          feedback: null,
          limited: false,
        },
      ],
    },
    {
      id: "c-images",
      title: "Cover image ideas",
      starred: false,
      age: "Yesterday",
      group: "Yesterday",
      turns: [
        {
          id: "t3",
          question: "Draw a city under twin moons",
          answer: null,
          image: true,
          streaming: false,
          feedback: null,
          limited: false,
        },
      ],
    },
    {
      id: "c-churn",
      title: "Explain this post: churn email",
      starred: false,
      age: "5 hours ago",
      group: "Today",
      turns: [],
    },
  ];
  let model = "Auto";
  let temporary = false;
  let made = 0;
  const writes: Array<string> = [];
  const find = (id: unknown) => conversations.find((c) => c.id === id);
  return {
    conversations,
    get model() {
      return model;
    },
    get temporary() {
      return temporary;
    },
    /** What X's controls changed, in order: `<kind> <conversation or turn>`. */
    writes,
    /**
     * What one of X's controls does, as X's page asks for it. A send on a new chat starts a
     * conversation, whose id the answer carries so X's page can put it in its URL.
     */
    write: (body: Record<string, unknown>): { ok: boolean; conversation?: string } => {
      const kind = String(body.kind);
      if (
        kind === "model" &&
        MODES.some((m) => m.title === body.title && m.availability === "available")
      ) {
        model = String(body.title);
        writes.push(`model ${model}`);
        return { ok: true };
      }
      if (kind === "private") {
        temporary = !temporary;
        writes.push(`private ${temporary}`);
        return { ok: true };
      }
      // X's Grok button on a post: X's own analysis, asked in a new chat with the post's link.
      if (kind === "analyze") {
        const c: MockGrokConversation = {
          id: `c-new${++made}`,
          title: "Explain this post",
          starred: false,
          age: "now",
          group: "Today",
          turns: [],
        };
        conversations.unshift(c);
        c.turns.push({
          id: `t-${c.id}-1`,
          question: `https://x.com/${String(body.post)}`,
          answer: "<p>Thinking it through</p>",
          streaming: true,
          feedback: null,
          limited,
        });
        writes.push(`analyze ${String(body.post)}`);
        return { ok: true, conversation: c.id };
      }
      if (kind === "send") {
        let c = find(body.conversation);
        if (c === undefined) {
          c = {
            id: `c-new${++made}`,
            title: String(body.text).slice(0, 40),
            starred: false,
            age: "now",
            group: "Today",
            turns: [],
          };
          if (!temporary) conversations.unshift(c);
        }
        const id = `t-${c.id}-${c.turns.length + 1}`;
        c.turns.push({
          id,
          question: String(body.text),
          answer: limited ? null : "<p>Thinking it through</p>",
          streaming: !limited,
          feedback: null,
          limited,
        });
        writes.push(`send ${id}`);
        return { ok: true, conversation: c.id };
      }
      const c = find(body.conversation);
      const t = c?.turns.find((x) => x.id === body.turn);
      if (kind === "finish" && t !== undefined) {
        t.answer = ANSWERS[1]!;
        t.streaming = false;
        return { ok: true };
      }
      if (kind === "stop" && t !== undefined) {
        t.streaming = false;
        writes.push(`stop ${t.id}`);
        return { ok: true };
      }
      if (kind === "feedback" && t !== undefined) {
        const f = body.feedback === "up" ? "up" : "down";
        t.feedback = t.feedback === f ? null : f;
        writes.push(`feedback ${t.id}`);
        return { ok: true };
      }
      if (kind === "regenerate" && t !== undefined) {
        t.answer = "<p>Thinking it through</p>";
        t.streaming = true;
        writes.push(`regenerate ${t.id}`);
        return { ok: true };
      }
      if (c === undefined) return { ok: false };
      if (kind === "pin" || kind === "unpin") c.starred = kind === "pin";
      else if (kind === "rename" && String(body.title).trim() !== "")
        c.title = String(body.title).trim();
      else if (kind === "delete") conversations.splice(conversations.indexOf(c), 1);
      else return { ok: false };
      writes.push(`${kind} ${c.id}`);
      return { ok: true };
    },
  };
}

export type MockGrok = ReturnType<typeof createMockGrok>;

const icon = (name: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" data-icon="${name}" viewBox="0 0 24 24" width="1em" height="1em" role="img"></svg>`;

/** X's limit block (its upsell quota card) for an account past X's free Grok limit. */
const limitCard = `<div class="border-normal flex flex-col items-start gap-2 rounded-2xl border px-4 py-3"><p class="text-primary text-[15px] font-bold">More Grok with SuperGrok</p><p role="status" class="text-secondary text-[13px]">You have reached your Grok usage limit. Upgrade for more access.</p><a href="/i/premium_sign_up" class="btn">Upgrade to SuperGrok</a></div>`;

/** A 2x1 picture, standing in for Grok's image; X's page draws it from a blob (`data-mock-blob`). */
const PICTURE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwQZYAwAOS0D/WkLu/AAAAAASUVORK5CYII=";
const imageSlots = `<div class="flex w-full min-w-0 flex-row flex-wrap gap-2"><button type="button" aria-label="A city under twin moons" class="overflow-hidden rounded-2xl"><img data-mock-blob="${PICTURE}" alt="A city under twin moons" class="block max-h-96 object-contain"></button></div>`;

const turnHtml = (c: MockGrokConversation | null, t: MockTurn) => {
  const user = `<div class="group/user flex flex-col items-end gap-2"><div class="relative flex max-w-[80%] flex-col items-end"><div class="text-primary rounded-chat bg-secondary px-4 py-2 wrap-anywhere whitespace-pre-wrap">${esc(t.question)}</div><div class="flex items-center"><button type="button" aria-label="Copy message"><svg></svg></button></div></div></div>`;
  const trace = t.streaming
    ? `<div class="flex flex-col gap-3"><div aria-label="Waiting for reply" role="status" class="flex min-h-6 items-center gap-2"><span class="grok-shimmer-text">Thinking</span></div></div>`
    : `<div class="flex flex-col gap-3"><button type="button" aria-expanded="false"><span>Thought for 14s</span></button></div>`;
  const body = t.limited
    ? limitCard
    : t.image === true
      ? imageSlots
      : `${trace}<div><div class="text-[15px] leading-relaxed">${t.answer ?? ""}</div></div>${t.streaming ? "" : `<button type="button" aria-expanded="false"><span aria-hidden="true"><span>x</span></span><span class="truncate">5 sources</span></button>`}`;
  const actions =
    t.streaming || t.limited
      ? ""
      : `<div class="flex items-center"><div class="-ms-2 flex items-center"><button type="button" aria-label="Copy"><svg></svg></button><button type="button" aria-label="Good response" aria-pressed="${t.feedback === "up"}" data-mock-grok="up">${icon(t.feedback === "up" ? "icon-thumbs-up-fill" : "icon-thumbs-up")}</button><button type="button" aria-label="Bad response" aria-pressed="${t.feedback === "down"}" data-mock-grok="down">${icon(t.feedback === "down" ? "icon-thumbs-down-fill" : "icon-thumbs-down")}</button><button type="button" aria-label="Regenerate" data-mock-grok="regenerate">${icon("icon-reload")}</button></div></div>`;
  return `<div data-turn-id="${t.id}" class="space-y-4" data-mock-conversation="${c?.id ?? ""}">${user}<div class="group flex flex-col items-start gap-1" data-quotable-message="r-${t.id}" data-mock-turn="${t.id}"><div class="flex w-full min-w-0 flex-col gap-3">${body}</div>${actions}</div></div>`;
};

/** X's History panel (its role=dialog dropdown), for the page script to show from X's History. */
const historyPanel = (grok: MockGrok, current: string | null) => {
  const groups = [
    ["Pinned", grok.conversations.filter((c) => c.starred)],
    ...(["Today", "Yesterday", "Last 7 days"] as const).map(
      (g) => [g, grok.conversations.filter((c) => !c.starred && c.group === g)] as const,
    ),
  ] as const;
  const row = (c: MockGrokConversation) =>
    `<li class="group overflow-hidden" data-mock-row="${c.id}"><div class="relative flex h-12 items-center gap-2 overflow-hidden rounded-xl px-3"><a href="/i/grok/c/${encodeURIComponent(c.id)}" class="static flex min-w-0 flex-1 items-center gap-2">${c.starred ? icon("icon-pin-fill") : ""}<span class="text-primary min-w-0 truncate text-[15px]">${esc(c.title)}</span>${c.id === current ? '<span class="border-normal text-secondary">Current</span>' : ""}</a><div class="grid shrink-0 items-center justify-items-end"><span class="text-secondary col-start-1 row-start-1 text-[13px]">${esc(c.age)}</span><div class="pointer-events-none relative z-[2] col-start-1 row-start-1 flex items-center"><button type="button" aria-label="${c.starred ? "Unpin" : "Pin"}" data-mock-grok="${c.starred ? "unpin" : "pin"}">${icon(c.starred ? "icon-pin-off" : "icon-pin")}</button><a aria-label="New tab" href="/i/grok/c/${encodeURIComponent(c.id)}" target="_blank" rel="noopener noreferrer">${icon("icon-arrow-up-right")}</a><button type="button" aria-label="Rename" data-mock-grok="rename">${icon("icon-edit-line")}</button><button type="button" aria-label="Delete" data-mock-grok="delete">${icon("icon-trashcan")}</button></div></div></div></li>`;
  const list = groups
    .filter(([, cs]) => cs.length > 0)
    .map(
      ([g, cs]) =>
        `<li role="presentation"><h2 class="text-secondary px-3 pt-4 pb-1 text-[13px] font-medium">${g}</h2></li>${cs.map(row).join("")}`,
    )
    .join("");
  const empty =
    grok.conversations.length === 0
      ? `<div role="status" class="flex flex-col items-center gap-1 px-3 py-12"><p>No conversations yet</p><p>Start a conversation to see your history here</p></div>`
      : "";
  const media = grok.conversations.some((c) => c.turns.some((t) => t.image === true))
    ? `<ul class="grid grid-cols-3 gap-1"><li><button type="button" aria-label="Open image 1"><img data-mock-blob="${PICTURE}" alt="" class="absolute inset-0 size-full object-cover"></button></li></ul>`
    : `<div role="status"><p>No media yet</p><p>Images you create or upload appear here</p></div>`;
  return `<div role="dialog" aria-label="History" data-mock-grok-panel class="dialog"><div class="flex min-h-0 w-full grow flex-col overflow-hidden"><div role="tablist" aria-label="History"><button role="tab" aria-selected="true" data-mock-grok="tab-chats">Chats</button><button role="tab" aria-selected="false" data-mock-grok="tab-media">Media</button></div><header class="border-normal flex shrink-0 items-center gap-2 border-b px-3 py-3"><div class="min-w-0 flex-1"><input type="search" placeholder="Search…" aria-label="Search conversations" autocomplete="off"></div></header><div class="scrollbar-thin-custom min-h-0 flex-1 overflow-y-auto" aria-busy="false"><div class="w-full px-2 py-2">${empty}<ul class="flex flex-col">${list}</ul></div></div></div><template data-mock-grok-media>${media}</template></div>`;
};

/** X's model menu (Base UI): X's radio rows, its upgrade rows as X's upsell link. */
const modelMenu = (grok: MockGrok) =>
  `<div role="menu" data-mock-grok-menu>${MODES.map((m) =>
    m.availability === "available"
      ? `<div role="menuitemradio" aria-checked="${grok.model === m.title}" tabindex="-1" data-mock-grok-model="${esc(m.title)}"><span class="flex flex-col"><span>${esc(m.title)}</span><span class="text-subtext3 text-secondary mt-1 font-normal pointer-fine:hidden">${esc(m.description)}</span></span></div>`
      : `<a role="menuitem" tabindex="-1" href="/i/premium_sign_up"><span class="flex flex-col"><span>${esc(m.title)}</span><span class="text-subtext3 text-secondary mt-1 font-normal pointer-fine:hidden">${esc(m.description)}</span></span></a>`,
  ).join("")}</div>`;

/**
 * Mock X's Grok page for `path` (and its `conversation` query, X's own URL after a new chat's
 * first send): X's header, the open conversation or a new chat, and X's composer.
 */
export function grokPage(grok: MockGrok, path: string, conversation: string | null) {
  const id = path.startsWith("/i/grok/c/")
    ? decodeURIComponent(path.slice("/i/grok/c/".length))
    : conversation;
  const c = id === null ? null : (grok.conversations.find((x) => x.id === id) ?? null);
  const busy = c?.turns.some((t) => t.streaming) === true;
  const open = id !== null;
  const header = `<div class="grok-header"><div><button type="button" role="button" aria-expanded="false" aria-haspopup="dialog" data-mock-grok="history">History</button></div><div>${open ? `<a href="/i/grok" role="link" data-mock-grok="new">New chat</a>` : `<button type="button" role="button" aria-pressed="${grok.temporary}" data-mock-grok="private">Private</button>`}</div></div>`;
  const turns = (c?.turns ?? []).map((t) => turnHtml(c, t)).join("");
  const followUps =
    c !== null && c.turns.length > 0 && !busy
      ? `<div class="flex w-full flex-col gap-1 pt-1"><div class="-ms-4"><button type="button"><svg><path d="M15 10l5 5-5 5M4 4v7a4 4 0 0 0 4 4h12"></path></svg>Show Lena's numbers next to Jon's</button></div></div>`
      : "";
  const send = busy
    ? `<button type="button" aria-label="Stop" data-mock-grok="stop">${icon("icon-player-stop")}</button>`
    : `<button type="button" aria-label="Voice mode" data-mock-grok="voice">${icon("icon-voice")}</button>`;
  const composer = `<fieldset data-grok-composer="" class="m-0 flex w-full min-w-0 flex-col gap-2 border-0 p-0" data-mock-conversation="${c?.id ?? ""}"><div class="relative"><div class="flex w-full flex-col rounded-lg border"><div class="flex flex-col gap-2 px-2 pt-3 pb-1.5"><textarea aria-label="Ask anything" placeholder="Ask anything" rows="1"></textarea></div><div class="flex w-full items-center gap-1 p-3"><button type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Attach">+</button><div class="ms-auto flex items-center gap-1"><button type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Select a model ${esc(grok.model)}" data-mock-grok="models"><span class="text-secondary font-medium"><span>${esc(grok.model)}</span></span></button>${send}</div></div></div></div></fieldset>`;
  return {
    title: "Grok / X",
    html: `${header}<div role="region" aria-label="Conversation" tabindex="-1"><div class="mx-auto w-full max-w-[800px]"><div class="relative"><div class="space-y-4" data-mock-grok-transcript>${turns}${followUps}</div></div></div></div><div>${composer}</div><template data-mock-grok-history>${historyPanel(grok, c?.id ?? null)}</template><template data-mock-grok-models>${modelMenu(grok)}</template>`,
  };
}
