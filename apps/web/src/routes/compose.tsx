import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  charCount,
  type Draft,
  type DraftBlock,
  type DraftMedia,
  type DraftPatch,
  type DraftPoll,
  MEDIA_MAX_BYTES,
  POST_LIMIT,
  type ReplySettings,
} from "@xtend/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { ArrowLeft, CalendarClock, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TextMorph } from "torph/react";

import { AssistPanel, ComposeContext, failText, OnX } from "../components/compose/AssistPanel";
import { COMPOSE_TABS, type ComposeTab, DraftsHome, tabOf } from "../components/compose/DraftsHome";
import { fmtWhen, postCosts, sumUsd } from "../components/compose/DraftsList";
import { PostPreview, quotedPostId } from "../components/compose/PostPreview";
import {
  MediaList,
  postText,
  REPLY_OPTIONS,
  splitBlocks,
  ThreadEditor,
} from "../components/compose/ThreadEditor";
import { HeaderTabs, PageHeader } from "../components/PageHeader";
import { Companion } from "../components/shell/Companion";
import { sectionLabel, useSection } from "../components/shell/sections";
import { Button } from "../components/ui/button";
import { compactInputClass, inputClass, TimeField } from "../components/ui/field";
import { Cost, PageBody } from "../components/ui/layout";
import { Popover } from "../components/ui/popover";
import { XLink } from "../components/ui/x-link";
import { XCard } from "../components/x";
import { cn } from "../lib/utils";
import { localInputToInstant } from "../lib/time";
import {
  composeContextAtom,
  composeQuoteAtom,
  createDraftAtom,
  draftsAtom,
  generateCoverAtom,
  mediaAddAtom,
  mediaRemoveAtom,
  postNowAtom,
  updateDraftAtom,
} from "../state/compose";
import { useRates } from "../state/costs";
import { savedPostAtom } from "../state/library";
import { recentPostsAtom } from "../state/observations";
import { queueAtom, scheduleAtom, unscheduleAtom } from "../state/plan";
import { settingsAtom, useSessionLane } from "../state/settings";
import { Select } from "../components/ui/select";
import { Switch } from "../components/ui/switch";

/** What the editor owns; the service owns status, schedule, outcome and the media files. */
interface Editor {
  readonly kind: Draft["kind"];
  readonly blocks: ReadonlyArray<DraftBlock>;
  readonly title: string;
  readonly body: string;
  readonly replySettings: ReplySettings;
  readonly poll: DraftPoll | null;
  readonly hideLinkPreviews: boolean;
  readonly threadDelaySeconds: number;
  readonly quoteUrl: string;
  readonly replyToPostId: string | null;
  /** Position, block and alt of the stored files; ids and paths come from the service. */
  readonly media: ReadonlyArray<DraftMedia>;
}

const empty: Editor = {
  kind: "thread",
  blocks: [{ text: "" }],
  title: "",
  body: "",
  replySettings: "everyone",
  poll: null,
  hideLinkPreviews: false,
  threadDelaySeconds: 0,
  quoteUrl: "",
  replyToPostId: null,
  media: [],
};

const fromDraft = (d: Draft): Editor => ({
  kind: d.kind,
  blocks: d.blocks.length === 0 ? [{ text: "" }] : d.blocks,
  title: d.title,
  body: d.body,
  replySettings: d.replySettings,
  poll: d.poll,
  hideLinkPreviews: d.hideLinkPreviews,
  threadDelaySeconds: d.threadDelaySeconds,
  quoteUrl: d.quoteUrl ?? "",
  replyToPostId: d.replyToPostId,
  media: d.media,
});

const toPatch = (e: Editor): DraftPatch => ({
  kind: e.kind,
  blocks: e.blocks,
  title: e.title,
  body: e.body,
  replySettings: e.replySettings,
  poll: e.poll,
  hideLinkPreviews: e.hideLinkPreviews,
  threadDelaySeconds: e.threadDelaySeconds,
  quoteUrl: e.quoteUrl.trim() === "" ? null : e.quoteUrl.trim(),
  replyToPostId: e.replyToPostId,
  media: e.media.map(({ id, blockIndex, alt, position }) => ({ id, blockIndex, alt, position })),
});
const sourceUrl = (postId: string) => `https://x.com/i/web/status/${postId}`;

/** The thread replaced by these posts; files of posts it no longer has go, as the service drops them. */
const withPosts = (e: Editor, texts: ReadonlyArray<string>): Editor => ({
  ...e,
  blocks: texts.map((text) => ({ text })),
  media: e.media.filter((m) => m.blockIndex < texts.length),
});

// A thread post may be only media or only the quote link, as the publisher allows.
const isBlank = (e: Editor) =>
  e.kind === "thread"
    ? e.blocks.every((b) => b.text.trim() === "") &&
      e.media.length === 0 &&
      e.quoteUrl.trim() === ""
    : e.title.trim() === "" && e.body.trim() === "";

/** What the first `posts` posts say, compared as DraftStore.update does to keep them on a retry. */
const said = (
  d: Pick<Draft, "kind" | "poll" | "quoteUrl" | "replyToPostId" | "blocks" | "media">,
  posts: number,
) =>
  JSON.stringify([
    d.kind,
    d.poll,
    d.quoteUrl,
    d.replyToPostId,
    d.blocks.slice(0, posts).map((b) => b.text),
    d.media.filter((m) => m.blockIndex < posts).map((m) => [m.id, m.blockIndex, m.position]),
  ]);

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => reject(reader.error));
    reader.addEventListener("load", () => resolve((reader.result as string).split(",")[1] ?? ""));
    reader.readAsDataURL(file);
  });

/** "Sun 09:00" within the week ahead, "Nov 3, 09:00" past it: short enough for a header button. */
const slotLabel = (zone: string, at: Date, now: Date) =>
  new Intl.DateTimeFormat("en", {
    timeZone: zone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    ...(at.getTime() - now.getTime() < 6 * 86_400_000
      ? { weekday: "short" }
      : { month: "short", day: "numeric" }),
  }).format(at);

/** The Library post a new draft was started from; shown beside the editor, linked on the draft. */
function Inspiration({ postId }: { readonly postId: string }) {
  const saved = useAtomValue(savedPostAtom(postId));
  const post = AsyncResult.getOrElse(saved, () => null);
  if (post === null) return null;
  return (
    <XCard title={`Inspired by @${post.post.author.handle}`} aside={<OnX href={post.post.url} />}>
      <p className="whitespace-pre-wrap text-[13.5px] leading-[1.4]">{post.post.text}</p>
    </XCard>
  );
}

/** The post a reply draft answers: from the library if saved, else from what the session view showed. */
function ReplyTarget({ postId }: { readonly postId: string }) {
  const saved = useAtomValue(savedPostAtom(postId));
  const recent = useAtomValue(recentPostsAtom);
  const fromLibrary = AsyncResult.getOrElse(saved, () => null);
  const observed = AsyncResult.getOrElse(recent, () => null)?.posts.find(
    (p) => p.postId === postId,
  );
  const target =
    fromLibrary !== null
      ? { handle: fromLibrary.post.author.handle, text: fromLibrary.post.text }
      : observed === undefined
        ? null
        : { handle: observed.author.handle, text: observed.text };
  return (
    <XCard
      title={target === null ? "Replying" : `Replying to @${target.handle}`}
      aside={target === null ? undefined : <OnX href={sourceUrl(postId)} />}
    >
      {target !== null ? (
        <p className="line-clamp-6 whitespace-pre-wrap text-[13.5px] leading-[1.4]">
          {target.text}
        </p>
      ) : (
        <XLink
          className="block truncate font-mono text-2xs text-muted-foreground hover:text-foreground"
          href={sourceUrl(postId)}
        >
          {sourceUrl(postId)}
        </XLink>
      )}
    </XCard>
  );
}

const POLL_DURATIONS = [
  [60, "1 hour"],
  [360, "6 hours"],
  [1440, "1 day"],
  [4320, "3 days"],
  [10080, "7 days"],
] as const;

/** The options that differ from a plain thread, for the collapsed Options row. */
const optionsSummary = (e: Editor) =>
  [
    e.replySettings === "everyone"
      ? null
      : (REPLY_OPTIONS.find(([v]) => v === e.replySettings)?.[1] ?? null),
    e.quoteUrl.trim() === "" ? null : "quote",
    e.poll === null ? null : "poll",
    e.hideLinkPreviews ? "no link previews" : null,
    e.threadDelaySeconds > 0 ? `${e.threadDelaySeconds}s apart` : null,
  ]
    .filter((x) => x !== null)
    .join(" · ");

const row = "flex items-center justify-between gap-3 border-t border-border py-2.5";

function Options({ editor, onChange }: { editor: Editor; onChange: (e: Editor) => void }) {
  const poll = editor.poll;
  const quoteBad = editor.quoteUrl.trim() !== "" && quotedPostId(editor.quoteUrl) === null;
  return (
    <div className="flex flex-col pb-2 text-[13px]">
      <label className={row}>
        <span>Who can reply to every post</span>
        <Select
          compact
          value={editor.replySettings}
          onChange={(replySettings) => onChange({ ...editor, replySettings })}
          options={REPLY_OPTIONS.map(([value, label]) => ({ value, label }))}
        />
      </label>
      <label className={cn(row, "flex-col items-stretch gap-1.5")}>
        <span className="flex items-baseline justify-between gap-3">
          Quote a post
          <span className="text-xs text-muted-foreground">rides on the first post as a link</span>
        </span>
        <input
          className={inputClass}
          aria-label="Quote post link"
          placeholder="https://x.com/handle/status/123"
          value={editor.quoteUrl}
          onChange={(e) => onChange({ ...editor, quoteUrl: e.target.value })}
        />
        {quoteBad ? (
          <span className="text-xs text-error-foreground">Not an x.com status link</span>
        ) : null}
      </label>
      <label className={row}>
        <span>Poll on the first post</span>
        <Switch
          checked={poll !== null}
          onChange={(on) =>
            onChange({
              ...editor,
              poll: on ? { options: ["", ""], durationMinutes: 1440 } : null,
            })
          }
        />
      </label>
      {poll !== null ? (
        <div className="flex flex-col gap-1.5 pb-2.5">
          {poll.options.map((o, i) => (
            // eslint-disable-next-line react/no-array-index-key -- options are plain strings; position is their identity.
            <div key={i} className="flex gap-1">
              <input
                className={inputClass}
                placeholder={`Option ${i + 1}`}
                value={o}
                maxLength={25}
                onChange={(e) =>
                  onChange({
                    ...editor,
                    poll: {
                      ...poll,
                      options: poll.options.map((x, j) => (j === i ? e.target.value : x)),
                    },
                  })
                }
              />
              {poll.options.length > 2 ? (
                <Button
                  variant="ghost-muted"
                  size="sm"
                  aria-label={`Remove option ${i + 1}`}
                  onClick={() =>
                    onChange({
                      ...editor,
                      poll: { ...poll, options: poll.options.filter((_, j) => j !== i) },
                    })
                  }
                >
                  Remove
                </Button>
              ) : null}
            </div>
          ))}
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="xs"
              disabled={poll.options.length >= 4}
              onClick={() =>
                onChange({ ...editor, poll: { ...poll, options: [...poll.options, ""] } })
              }
            >
              Add option
            </Button>
            <Select
              compact
              label="Poll length"
              value={poll.durationMinutes}
              onChange={(durationMinutes) =>
                onChange({ ...editor, poll: { ...poll, durationMinutes } })
              }
              options={POLL_DURATIONS.map(([value, label]) => ({ value, label }))}
            />
          </div>
        </div>
      ) : null}
      <label className={row}>
        <span>
          Hide link previews
          <span className="block text-xs text-muted-foreground">
            Not available yet: X keeps the card
          </span>
        </span>
        {/* Nothing removes the card after posting, so it can only be turned off. */}
        <Switch
          disabled={!editor.hideLinkPreviews}
          checked={editor.hideLinkPreviews}
          onChange={(hideLinkPreviews) => onChange({ ...editor, hideLinkPreviews })}
        />
      </label>
      <label className={row}>
        <span>Seconds between thread posts</span>
        <input
          type="number"
          min={0}
          className={cn(compactInputClass, "w-20 text-right font-mono")}
          value={editor.threadDelaySeconds}
          onChange={(e) =>
            onChange({
              ...editor,
              threadDelaySeconds: Math.max(0, Math.trunc(Number(e.target.value) || 0)),
            })
          }
        />
      </label>
    </div>
  );
}

/** Every search key, so links into Compose spell out only what they mean. */
const composeSearch = (search: Partial<ComposeSearch>): ComposeSearch => ({
  draft: undefined,
  inspire: undefined,
  quote: undefined,
  reply: undefined,
  text: undefined,
  new: undefined,
  tab: undefined,
  ...search,
});

/**
 * Compose is drafts first: the open section's drafts (the sidebar picks the section), and the
 * composer once a draft, a new thread, a reply, an inspiration or carried-over text is in the
 * URL. A new `?inspire=`, `?reply=`, `?text=` or `?draft=` remounts the composer, so it starts
 * without an effect. `?tab=` stays while editing, so the sidebar keeps the draft's section lit.
 */
function ComposeScreen() {
  const search = Route.useSearch();
  const tab = useSection("/compose");
  const navigate = useNavigate();
  const go = (next: Partial<ComposeSearch>) =>
    void navigate({ to: "/compose", search: composeSearch(next) });
  const editing =
    search.draft !== undefined ||
    search.new === true ||
    search.inspire !== undefined ||
    search.reply !== undefined ||
    search.quote !== undefined ||
    search.text !== undefined;
  if (!editing) {
    return (
      <DraftsHome
        tab={tab}
        onOpen={(draft) => go({ draft, tab })}
        onNew={() => go({ new: true })}
      />
    );
  }
  return (
    <ComposeEditor
      key={`${search.draft ?? ""}|${search.inspire ?? ""}|${search.reply ?? ""}|${search.quote ?? ""}|${search.text ?? ""}`}
      draftParam={search.draft}
      inspire={search.inspire}
      quote={search.quote}
      reply={search.reply}
      text={search.text}
      onBack={(back) => go({ tab: back })}
      onSection={(next) => {
        if (next !== tab)
          void navigate({ to: "/compose", search: { ...search, tab: next }, replace: true });
      }}
    />
  );
}

export function ComposeEditor({
  draftParam,
  inspire,
  quote: quoteParam,
  reply,
  text,
  onBack,
  onSection,
}: {
  readonly draftParam: string | undefined;
  readonly inspire: string | undefined;
  readonly quote?: string | undefined;
  readonly reply: string | undefined;
  /** Text carried over from X's composer by the Schedule chip. */
  readonly text: string | undefined;
  /** Back to the list, on the section the draft now lives under. */
  readonly onBack: (tab: ComposeTab) => void;
  /** The draft moved to another section (it was queued, posted or failed); the sidebar follows. */
  readonly onSection: (tab: ComposeTab) => void;
}) {
  const rates = useRates();
  const drafts = useAtomValue(draftsAtom);
  const refresh = useAtomRefresh(draftsAtom);
  const refreshContext = useAtomRefresh(composeContextAtom);
  const settings = useAtomValue(settingsAtom);
  const quote = AsyncResult.getOrElse(useAtomValue(composeQuoteAtom), () => null);
  const context = AsyncResult.getOrElse(useAtomValue(composeContextAtom), () => null);
  const handle = AsyncResult.getOrElse(
    AsyncResult.map(settings, (s) => s.handle),
    () => null,
  );
  const sessionPosting = AsyncResult.getOrElse(
    AsyncResult.map(settings, (s) => s.sessionPostingEnabled),
    () => false,
  );
  const zone = AsyncResult.getOrElse(
    AsyncResult.map(settings, (s) => s.timeZone),
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const create = useAtomSet(createDraftAtom, { mode: "promise" });
  const update = useAtomSet(updateDraftAtom, { mode: "promise" });
  const queue = useAtomSet(queueAtom, { mode: "promiseExit" });
  const schedule = useAtomSet(scheduleAtom, { mode: "promiseExit" });
  const unschedule = useAtomSet(unscheduleAtom, { mode: "promiseExit" });
  const postNow = useAtomSet(postNowAtom, { mode: "promiseExit" });
  const mediaAdd = useAtomSet(mediaAddAtom, { mode: "promiseExit" });
  const mediaRemove = useAtomSet(mediaRemoveAtom, { mode: "promiseExit" });
  const generateCover = useAtomSet(generateCoverAtom, { mode: "promiseExit" });

  const initial: Editor = {
    ...empty,
    replyToPostId: reply ?? null,
    quoteUrl: quoteParam ?? "",
    blocks: [{ text: text ?? "" }],
  };
  const [selected, setSelected] = useState<Draft | null>(null);
  const [editor, setEditor] = useState<Editor>(initial);
  // Free first: on the desktop with the lane on, every clicked post goes through the session,
  // except a poll, which X's composer cannot take.
  const laneText = useSessionLane() && editor.poll === null;
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [active, setActive] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"post" | "schedule" | null>(null);
  const [when, setWhen] = useState("");
  // The picker's wall time is in the account zone, whatever the browser's.
  const scheduleAt = localInputToInstant(zone, when);
  // The scheduler posts anything already due on its next tick, so a past time would post now
  // unconfirmed. Judged against when the picker opened; Schedule checks the clock again.
  const [pickerOpenedAt, setPickerOpenedAt] = useState(0);
  const schedulePast = scheduleAt !== null && scheduleAt.getTime() <= pickerOpenedAt;
  const [coverPrompt, setCoverPrompt] = useState("");
  // The paid or sending action in flight; its buttons stay disabled so a double click cannot repeat it.
  const [busy, setBusy] = useState<"post" | "queue" | "schedule" | "unschedule" | "cover" | null>(
    null,
  );
  const lastSaved = useRef<string>(JSON.stringify(initial));
  const saving = useRef<Promise<Draft> | null>(null);
  const removals = useRef(Promise.resolve());

  const open = (d: Draft) => {
    setSelected(d);
    setEditor(fromDraft(d));
    lastSaved.current = JSON.stringify(fromDraft(d));
    setActive(0);
    setConfirm(null);
    setNotice(null);
  };

  // ?draft= opens that draft once the list has it; the param stays, so reloads land here too.
  useEffect(() => {
    if (draftParam === undefined || selected !== null || !AsyncResult.isSuccess(drafts)) return;
    const d = drafts.value.find((x) => x.id === draftParam);
    // eslint-disable-next-line react/set-state-in-effect -- the editor state is this effect's output.
    if (d !== undefined) open(d);
    // eslint-disable-next-line react/exhaustive-effect-dependencies -- runs until the deep-linked draft is open.
  }, [draftParam, drafts]);

  // Autosave: one row per editor session, created on the first non-blank change. One save at a
  // time: a caller during one waits for it (a first create included), then saves what changed
  // meanwhile, so Post, Back and closing never go ahead of the last edits.
  const save = async (force = false): Promise<Draft | null> => {
    let base = selected;
    // A save in flight that fails is its own caller's to report; this one saves again.
    // eslint-disable-next-line no-await-in-loop -- waits out each save in turn, one at a time on purpose.
    while (saving.current !== null) base = (await saving.current.catch(() => null)) ?? base;
    const json = JSON.stringify(editor);
    if (json === lastSaved.current && (!force || base !== null)) return base;
    if (base === null && isBlank(editor) && !force) return null;
    const run = (async () => {
      const d =
        base === null
          ? await create({
              ...toPatch(editor),
              ...(inspire === undefined ? {} : { source: sourceUrl(inspire) }),
            })
          : await update({ id: base.id, patch: toPatch(editor) });
      lastSaved.current = json;
      setSelected(d);
      refresh();
      return d;
    })();
    saving.current = run;
    try {
      return await run;
    } finally {
      if (saving.current === run) saving.current = null;
    }
  };
  /** A failed save stays on screen as the notice instead of vanishing with the promise. */
  const reportFailure = (e: unknown) => {
    setNotice(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  };
  /** Saves now; false when the save failed. */
  const saveOrReport = () =>
    save().then(
      () => true,
      (e: unknown) => {
        reportFailure(e);
        return false;
      },
    );
  useEffect(() => {
    // eslint-disable-next-line react/exhaustive-effect-dependencies -- debounced on content only; `save` is rebuilt each render. `selected` reruns it after every save, so an edit skipped while one was in flight still goes out.
    const t = setTimeout(saveOrReport, 600);
    return () => clearTimeout(t);
  }, [editor, selected]);
  // Leaving inside the debounce (a sidebar link, a new ?draft=) still saves the last keystrokes.
  const flush = useRef(save);
  useEffect(() => {
    flush.current = save;
  });
  useEffect(() => () => void flush.current().catch(() => {}), []);

  /** Rows the service just stored join the editor's; its own rows keep their block, order and alt. */
  const attach = (d: Draft, ids: ReadonlySet<string>) => {
    setSelected(d);
    setEditor((e) => ({ ...e, media: [...e.media, ...d.media.filter((m) => ids.has(m.id))] }));
    refresh();
  };
  const newIds = (d: Draft, known: ReadonlyArray<DraftMedia>) =>
    new Set(d.media.filter((m) => !known.some((x) => x.id === m.id)).map((m) => m.id));

  const addFiles = async (blockIndex: number, files: ReadonlyArray<File>) => {
    // Files need a row to hang off; a blank editor gets one now.
    const d = selected ?? (await save(true).catch(reportFailure));
    if (d === null) return;
    let known = d.media;
    // One at a time on purpose: positions follow the order the files were picked in.
    /* eslint-disable no-await-in-loop */
    for (const file of files) {
      if (file.size > MEDIA_MAX_BYTES) {
        setNotice(`Failed: ${file.name} is over ${MEDIA_MAX_BYTES / 1024 / 1024} MB`);
        continue;
      }
      const exit = await mediaAdd({
        draftId: d.id,
        blockIndex,
        kind: file.type.startsWith("video/") ? "video" : "image",
        name: file.name,
        base64: await toBase64(file),
      });
      if (Exit.isFailure(exit)) {
        setNotice(`Failed: ${failText(exit.cause)}`);
        continue;
      }
      const added = newIds(exit.value, known);
      known = exit.value.media;
      for (const id of added) setPreviews((p) => ({ ...p, [id]: URL.createObjectURL(file) }));
      attach(exit.value, added);
    }
    /* eslint-enable no-await-in-loop */
  };

  // Queued one after another: a second call on the shared rpc atom would interrupt the first.
  const removeMedia = (id: string) => {
    if (selected === null) return;
    const draftId = selected.id;
    removals.current = removals.current.then(async () => {
      const exit = await mediaRemove({ draftId, id });
      if (Exit.isFailure(exit)) return setNotice(`Failed: ${failText(exit.cause)}`);
      setSelected(exit.value);
      setEditor((e) => ({ ...e, media: e.media.filter((m) => m.id !== id) }));
      refresh();
    });
  };

  const act = async (what: "queue" | "schedule" | "post" | "unschedule") => {
    if (busy !== null) return;
    setBusy(what);
    try {
      const saved = await save().then((d) => d ?? selected, reportFailure);
      if (saved === null) return;
      if (what === "schedule" && (scheduleAt === null || scheduleAt.getTime() <= Date.now())) {
        setNotice("Failed: that time has passed");
        return;
      }
      const exit =
        what === "queue"
          ? await queue(saved.id)
          : what === "schedule"
            ? await schedule({ id: saved.id, at: scheduleAt!.toISOString() })
            : what === "unschedule"
              ? await unschedule(saved.id)
              : await postNow(saved.id);
      setConfirm(null);
      refreshContext();
      if (Exit.isFailure(exit)) {
        setNotice(`Failed: ${failText(exit.cause)}`);
        return;
      }
      const next = exit.value;
      setSelected(next);
      onSection(tabOf(next.status));
      refresh();
      setNotice(
        next.status === "failed"
          ? `Failed: ${next.error}`
          : next.status === "posted"
            ? `Posted ${next.postIds.length} ${next.kind === "article" ? "article" : "posts"}${next.linkPreviewNote === null ? "" : `. ${next.linkPreviewNote}`}`
            : next.status === "draft"
              ? "Back in drafts"
              : `Queued for ${next.scheduledAt === null ? "later" : fmtWhen(next.scheduledAt)}`,
      );
    } finally {
      setBusy(null);
    }
  };

  // Read once per mount; the slot label only needs to know which week it falls in.
  const [mountedAt] = useState(() => new Date());
  const [voice, setVoice] = useState<{ readonly score: number; readonly text: string } | null>(
    null,
  );

  const blocks = editor.blocks;
  const media = editor.media;
  const hasMedia = media.length > 0;
  const hasMediaAt = (i: number) => media.some((m) => m.blockIndex === i);
  const quoteUrl = editor.quoteUrl.trim() === "" ? null : editor.quoteUrl.trim();
  const quoteBad = quoteUrl !== null && quotedPostId(quoteUrl) === null;
  const isArticle = editor.kind === "article";
  // The scheduler or another window moves the draft while it is open here; the list follows
  // their status events, so its newer copy is where the draft really is.
  const listed =
    selected === null
      ? undefined
      : AsyncResult.getOrElse(drafts, (): ReadonlyArray<Draft> => []).find(
          (d) => d.id === selected.id,
        );
  const current =
    listed !== undefined && selected !== null && listed.updatedAt > selected.updatedAt
      ? listed
      : selected;
  // Posted is final; a draft mid-publish belongs to the publisher.
  const locked = current?.status === "posted" || current?.status === "posting";
  // Posts of a failed thread already on X. A retry skips them while they still say what went out;
  // an edit to them makes the service start the thread over.
  const onX = current === null || locked || isArticle ? 0 : current.postIds.length;
  const skipped =
    current !== null && onX > 0 && said({ ...editor, quoteUrl }, onX) === said(current, onX)
      ? onX
      : 0;
  // Post now is a click and can go through the session; Queue and Schedule publish unattended,
  // through the API (Publisher's `clicked`), so they carry the API price.
  const priced = (sessionText: boolean) =>
    rates === null
      ? []
      : postCosts(rates, blocks, media, quoteUrl, sessionText, editor.replySettings).map((c, i) =>
          i < skipped ? 0 : c,
        );
  const costs = priced(laneText);
  const total = sumUsd(costs);
  const scheduledTotal = sumUsd(priced(false));
  const linkCount = rates === null ? 0 : costs.filter((c) => c === rates.postWithLink).length;
  const sessionCount = blocks.filter(
    (b, i) =>
      i >= skipped &&
      (hasMediaAt(i) || (laneText && (b.replySettings ?? editor.replySettings) === "everyone")),
  ).length;
  const toPost = blocks.length - skipped;
  const cover = media.find((m) => m.blockIndex === 0 && m.kind === "image");
  // What the publisher would refuse (Publisher.refusal), caught before a thread stops halfway.
  const emptyAt = isArticle
    ? -1
    : blocks.findIndex((b, i) => postText(b.text, i, quoteUrl).trim() === "" && !hasMediaAt(i));
  const longAt = isArticle
    ? -1
    : blocks.findIndex((b, i) => charCount(postText(b.text, i, quoteUrl)) > POST_LIMIT);
  const blocker =
    isBlank(editor) || quoteBad
      ? null
      : isArticle
        ? editor.title.trim() === "" || editor.body.trim() === ""
          ? "Article needs a title and a body"
          : null
        : emptyAt !== -1
          ? `Post ${emptyAt + 1} is empty`
          : longAt !== -1
            ? `Post ${longAt + 1} is over ${POST_LIMIT} characters`
            : editor.poll !== null && editor.poll.options.some((o) => o.trim() === "")
              ? "A poll option is empty"
              : editor.poll !== null && hasMediaAt(0)
                ? "A poll cannot share the first post with media"
                : null;
  // What sending costs: a thread post by post, an article as its draft and publish requests.
  const sendUsd = isArticle
    ? quote === null
      ? null
      : quote.articleUsd * 2
    : rates === null
      ? null
      : total;
  const scheduledUsd = isArticle || rates === null ? sendUsd : scheduledTotal;
  // Nothing sends until its price is known.
  const canSend =
    !isBlank(editor) &&
    !locked &&
    sendUsd !== null &&
    !quoteBad &&
    blocker === null &&
    busy === null;
  // Fields stay put while the service owns the draft or a post is going out.
  const frozen = locked || busy === "post";
  const sessionBlocked = hasMedia && (!sessionPosting || context?.desktopConnected === false);
  // Queue and Schedule: what the slot will charge.
  const price =
    scheduledUsd === null ? (
      <Cost tone="solid" label="…" />
    ) : (
      <Cost tone="solid" usd={scheduledUsd} />
    );

  const waiting = draftParam !== undefined && selected === null;
  const queued = current?.status === "queued";
  const slotAt =
    queued && current.scheduledAt !== null ? current.scheduledAt : (context?.nextSlot ?? null);
  const slot = slotAt === null ? null : slotLabel(zone, new Date(slotAt), mountedAt);
  const firstLine = (isArticle ? editor.title : (blocks[0]?.text ?? "")).split("\n")[0]?.trim();
  const title = waiting
    ? "Draft"
    : firstLine !== undefined && firstLine !== ""
      ? firstLine
      : current !== null
        ? "Untitled"
        : reply !== undefined
          ? "Reply"
          : isArticle
            ? "New article"
            : "New thread";
  // A voice score only describes the text it was run on.
  const voiceScore =
    voice !== null && voice.text === JSON.stringify(blocks.map((b) => b.text)) ? voice.score : null;
  const facts = waiting
    ? []
    : [
        isArticle ? "article" : `${blocks.length} ${blocks.length === 1 ? "post" : "posts"}`,
        current === null || current.status === "draft" ? null : current.status,
        voiceScore === null ? null : `voice ${Math.round(voiceScore * 100)}%`,
      ].filter((x) => x !== null);
  const back = current === null ? "drafts" : tabOf(current.status);

  const postNowText = isArticle
    ? "Publish this article now: a draft and a publish request."
    : `Post ${toPost} ${toPost === 1 ? "post" : "posts"} now.`;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        leading={
          <Button
            variant="ghost-muted"
            size="sm"
            aria-label={`Back to ${sectionLabel("/compose", back)}`}
            onClick={() => void saveOrReport().then((ok) => ok && onBack(back))}
          >
            <ArrowLeft />
            {sectionLabel("/compose", back)}
          </Button>
        }
        title={title}
        detail={facts.length === 0 ? undefined : facts.join(" · ")}
        actions={
          waiting || locked ? undefined : (
            <>
              <Popover
                open={confirm === "post"}
                onOpenChange={(open) => setConfirm(open ? "post" : null)}
                trigger={
                  <Button variant="ghost" size="sm" disabled={!canSend}>
                    Post now
                    {sendUsd === null ? <Cost label="…" /> : <Cost usd={sendUsd} />}
                  </Button>
                }
              >
                <p>{postNowText}</p>
                <dl className="mt-2 flex flex-col font-mono text-xs tabular-nums">
                  {isArticle ? (
                    <div className="flex justify-between py-0.5 text-muted-foreground">
                      <dt>2 requests</dt>
                      <dd>{quote === null ? "…" : <Cost usd={quote.articleUsd} />} each</dd>
                    </div>
                  ) : (
                    <>
                      {linkCount > 0 && rates !== null ? (
                        <div className="flex justify-between py-0.5 text-muted-foreground">
                          <dt>{linkCount} with a link</dt>
                          <dd>
                            <Cost usd={rates.postWithLink} /> each
                          </dd>
                        </div>
                      ) : null}
                      {sessionCount > 0 ? (
                        <div className="flex justify-between py-0.5 text-muted-foreground">
                          <dt>
                            {sessionCount}
                            {laneText ? "" : " with media,"} through your x.com session
                          </dt>
                          <dd>free</dd>
                        </div>
                      ) : null}
                      {skipped > 0 ? (
                        <div className="flex justify-between py-0.5 text-muted-foreground">
                          <dt>{skipped} already on X</dt>
                          <dd>free</dd>
                        </div>
                      ) : null}
                    </>
                  )}
                  <div className="mt-1 flex justify-between border-t border-border pt-1.5">
                    <dt>Total</dt>
                    <dd>{sendUsd === null ? "…" : <Cost usd={sendUsd} />}</dd>
                  </div>
                </dl>
                {sendUsd !== null && sendUsd > 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">Charges your treg balance.</p>
                ) : null}
                <div className="mt-3 flex justify-end gap-1.5">
                  <Button variant="ghost" size="xs" onClick={() => setConfirm(null)}>
                    Cancel
                  </Button>
                  <Button size="xs" disabled={!canSend} onClick={() => act("post")}>
                    {busy === "post" ? "Posting…" : "Confirm and post"}
                  </Button>
                </div>
              </Popover>
              <Popover
                open={confirm === "schedule"}
                onOpenChange={(open) => {
                  if (open) setPickerOpenedAt(Date.now());
                  setConfirm(open ? "schedule" : null);
                }}
                trigger={
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canSend}
                    aria-label={slot === null ? "Schedule" : `Schedule, ${slot}`}
                  >
                    <CalendarClock />
                    {slot ?? "Schedule"}
                  </Button>
                }
              >
                <label className="flex flex-col gap-1.5">
                  <span className="flex justify-between text-xs text-muted-foreground">
                    Post at
                    <span
                      className={cn("font-mono text-2xs", schedulePast && "text-error-foreground")}
                    >
                      {schedulePast ? "That time has passed" : zone}
                    </span>
                  </span>
                  {/* Date and a 24-hour time, joined as the local "YYYY-MM-DDTHH:MM" the zone reads. */}
                  <span className="flex gap-1.5">
                    <input
                      type="date"
                      aria-label="Post on"
                      className={cn(inputClass, "font-mono text-xs")}
                      value={when.slice(0, 10)}
                      onChange={(e) => setWhen(`${e.target.value}T${when.slice(11, 16)}`)}
                    />
                    <TimeField
                      label="Post at"
                      className="h-auto py-1.5"
                      value={when.slice(11, 16)}
                      onChange={(time) => setWhen(`${when.slice(0, 10)}T${time}`)}
                    />
                  </span>
                </label>
                <div className="mt-3 flex justify-end gap-1.5">
                  <Button variant="ghost" size="xs" onClick={() => setConfirm(null)}>
                    Cancel
                  </Button>
                  <Button
                    size="xs"
                    disabled={scheduleAt === null || schedulePast || !canSend}
                    onClick={() => act("schedule")}
                  >
                    Schedule
                    {price}
                  </Button>
                </div>
              </Popover>
              {queued ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => act("unschedule")}
                >
                  Unschedule
                </Button>
              ) : null}
              <Button
                size="sm"
                variant={queued ? "outline" : "default"}
                disabled={!canSend || queued}
                onClick={() => act("queue")}
              >
                <TextMorph duration={250}>{queued ? "Queued" : "Queue"}</TextMorph>
                {queued ? (
                  scheduledUsd === null ? (
                    <Cost label="…" />
                  ) : (
                    <Cost usd={scheduledUsd} />
                  )
                ) : (
                  price
                )}
              </Button>
            </>
          )
        }
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <PageBody>
          <div className="mx-auto w-full max-w-[640px] px-6 pt-4 pb-10">
            {locked || waiting ? null : (
              <div className="mb-3 flex h-8 items-center">
                <HeaderTabs
                  label="Format"
                  tabs={[
                    { id: "thread", label: "Thread" },
                    { id: "article", label: "Article" },
                  ]}
                  value={editor.kind}
                  onChange={(kind) => setEditor({ ...editor, kind })}
                />
              </div>
            )}
            {notice !== null ? (
              <p
                role="status"
                className={cn(
                  "mb-3 text-xs",
                  notice.startsWith("Failed") ? "text-error-foreground" : "text-success-foreground",
                )}
              >
                {notice}
              </p>
            ) : null}
            {current?.status === "failed" && notice === null ? (
              <p className="mb-3 text-xs text-error-foreground">Failed: {current.error}</p>
            ) : null}
            {onX > 0 ? (
              <p className="mb-3 text-xs text-muted-foreground">
                {onX} of {blocks.length} posts are already on X. A retry posts the rest; editing one
                of them posts the whole thread again.
              </p>
            ) : null}
            {locked ? (
              <p className="mb-3 text-xs text-muted-foreground">
                This draft is {current?.status}; start a new draft to change it.
                {current?.linkPreviewNote === null ? "" : ` ${current?.linkPreviewNote}`}
              </p>
            ) : null}
            {blocker !== null ? (
              <p className="mb-3 text-xs text-warning-foreground">{blocker}</p>
            ) : null}
            {sessionBlocked ? (
              <p className="mb-3 text-xs text-warning-foreground">
                {sessionPosting
                  ? "Media posts go through your x.com session, and no desktop is connected."
                  : "Media posts go through your x.com session. Turn on Session posting in Settings."}
              </p>
            ) : null}
            {waiting ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {AsyncResult.isSuccess(drafts)
                  ? "This draft no longer exists."
                  : AsyncResult.isFailure(drafts)
                    ? failText(drafts.cause)
                    : "Loading draft"}
              </p>
            ) : isArticle ? (
              <fieldset disabled={frozen} className="flex min-w-0 flex-col gap-3">
                <input
                  className="w-full bg-transparent text-2xl font-semibold tracking-tight outline-hidden placeholder:text-placeholder"
                  aria-label="Title"
                  placeholder="Title"
                  value={editor.title}
                  onChange={(e) => setEditor({ ...editor, title: e.target.value })}
                />
                <textarea
                  className="min-h-[10lh] w-full resize-none bg-transparent text-[15px] leading-relaxed outline-hidden field-sizing-content placeholder:text-placeholder"
                  aria-label="Body"
                  placeholder="Write in markdown"
                  value={editor.body}
                  onChange={(e) => setEditor({ ...editor, body: e.target.value })}
                />
                <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
                  <h2 className="text-[12.5px] font-semibold text-foreground/80">Cover</h2>
                  {cover !== undefined ? (
                    <MediaList
                      media={[cover]}
                      previews={previews}
                      onChange={(m) =>
                        setEditor({
                          ...editor,
                          media: [...media.filter((x) => x.id !== cover.id), ...m],
                        })
                      }
                      onRemove={removeMedia}
                    />
                  ) : null}
                  <div className="flex gap-1.5">
                    <input
                      className={inputClass}
                      aria-label="Cover prompt"
                      placeholder="Describe the cover image"
                      value={coverPrompt}
                      onChange={(e) => setCoverPrompt(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        coverPrompt.trim() === "" ||
                        cover !== undefined ||
                        quote === null ||
                        busy !== null
                      }
                      onClick={async () => {
                        setBusy("cover");
                        try {
                          const d = selected ?? (await save(true).catch(reportFailure));
                          if (d === null) return;
                          setNotice("Generating cover");
                          const exit = await generateCover({ draftId: d.id, prompt: coverPrompt });
                          if (Exit.isFailure(exit)) setNotice(`Failed: ${failText(exit.cause)}`);
                          else {
                            attach(exit.value, newIds(exit.value, d.media));
                            setNotice("Cover generated");
                          }
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      Generate
                      {quote === null ? <Cost label="…" /> : <Cost usd={quote.coverUsd} />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={cover !== undefined}
                      onClick={() => {
                        const input = document.createElement("input");
                        input.type = "file";
                        input.accept = "image/*";
                        input.addEventListener("change", () =>
                          addFiles(0, [...(input.files ?? [])]),
                        );
                        input.click();
                      }}
                    >
                      Upload
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {quote === null ? null : (
                      <span className="font-mono text-2xs">{quote.coverModel} · </span>
                    )}
                    Publishes through X Articles via treg at{" "}
                    {quote === null ? "…" : <Cost usd={quote.articleUsd} />} a request. Unverified
                    against the live API, so the first publish may fail.
                  </p>
                </div>
              </fieldset>
            ) : (
              <fieldset disabled={frozen} className="min-w-0">
                <ThreadEditor
                  blocks={blocks}
                  media={media}
                  previews={previews}
                  quoteUrl={quoteUrl}
                  active={active}
                  avatar={(handle ?? "you").slice(0, 1).toUpperCase()}
                  notes={costs.map((c, i) =>
                    rates === null ? null : i < skipped ? (
                      "already on X, free"
                    ) : hasMediaAt(i) ? (
                      "media, through your session, free"
                    ) : c === rates.postWithLink ? (
                      <>
                        link
                        <Cost usd={c} />
                      </>
                    ) : null,
                  )}
                  onChange={(b) => setEditor({ ...editor, blocks: b })}
                  onQuote={(url) => setEditor((e) => ({ ...e, quoteUrl: url }))}
                  onFocus={setActive}
                  onAddFiles={addFiles}
                  onMediaChange={(m) => setEditor((e) => ({ ...e, media: m }))}
                  onRemoveMedia={removeMedia}
                />
              </fieldset>
            )}
            {waiting || isArticle || locked ? null : (
              <details className="group mt-4 border-t border-border">
                <summary className="flex h-10 cursor-pointer list-none items-center gap-1.5 text-[13px] text-muted-foreground transition-colors duration-150 hover:text-foreground [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="size-3.5 group-open:rotate-90" />
                  Options
                  <span className="ml-auto truncate font-mono text-2xs">
                    {optionsSummary(editor)}
                  </span>
                </summary>
                <fieldset disabled={frozen} className="min-w-0">
                  <Options editor={editor} onChange={setEditor} />
                </fieldset>
              </details>
            )}
          </div>
          {waiting || isArticle || locked ? null : (
            <div className="mx-auto w-full max-w-[640px] px-6">
              <AssistPanel
                handle={handle}
                blocks={blocks.map((b) => b.text)}
                active={active}
                onReplaceBlock={(i, text) =>
                  setEditor((e) => ({
                    ...e,
                    blocks: e.blocks.map((b, j) => (j === i ? { ...b, text } : b)),
                  }))
                }
                onAppend={(texts) =>
                  setEditor((e) => ({
                    ...e,
                    blocks: [...e.blocks, ...texts.map((text) => ({ text }))],
                  }))
                }
                onReplaceAll={(b) => setEditor((e) => withPosts(e, b.flatMap(splitBlocks)))}
                onVoiceScore={(score) =>
                  setVoice({ score, text: JSON.stringify(blocks.map((b) => b.text)) })
                }
              />
            </div>
          )}
          <Companion>
            {inspire !== undefined ? <Inspiration postId={inspire} /> : null}
            {editor.replyToPostId !== null ? <ReplyTarget postId={editor.replyToPostId} /> : null}
            {isArticle || waiting ? null : (
              <>
                <PostPreview
                  blocks={blocks}
                  media={media}
                  previews={previews}
                  quoteUrl={quoteUrl}
                  name={handle ?? "You"}
                  handle={handle}
                  avatarUrl={null}
                />
                {/* Suggestions are used long after they were asked for, so each applies to the editor as it is then. */}
                {locked ? null : (
                  <ComposeContext
                    firstLine={blocks[0]?.text.split("\n")[0] ?? ""}
                    onUse={(b) => setEditor((e) => withPosts(e, b))}
                  />
                )}
              </>
            )}
          </Companion>
        </PageBody>
      </div>
    </div>
  );
}

const isTab = (value: unknown): value is ComposeTab => COMPOSE_TABS.some((tab) => tab === value);

const validateSearch = (s: Record<string, unknown>) => ({
  draft: typeof s.draft === "string" ? s.draft : undefined,
  inspire: typeof s.inspire === "string" ? s.inspire : undefined,
  /** A post URL to quote, from a drop on the sidebar. */
  quote: typeof s.quote === "string" ? s.quote : undefined,
  reply: typeof s.reply === "string" ? s.reply : undefined,
  text: typeof s.text === "string" ? s.text : undefined,
  // `?new=1` parses as the number 1.
  new: s.new === true || s.new === 1 || s.new === "1" ? (true as const) : undefined,
  tab: isTab(s.tab) ? s.tab : undefined,
});
type ComposeSearch = ReturnType<typeof validateSearch>;

export const Route = createFileRoute("/compose")({ validateSearch, component: ComposeScreen });
