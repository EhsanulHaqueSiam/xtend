import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  type Draft,
  type DraftBlock,
  type DraftMedia,
  type DraftPatch,
  type DraftPoll,
  MEDIA_MAX_BYTES,
  type ReplySettings,
} from "@xtend/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { ArrowLeft, CalendarClock, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TextMorph } from "torph/react";

import { AssistPanel, ComposeContext, failText } from "../components/compose/AssistPanel";
import { COMPOSE_TABS, type ComposeTab, DraftsHome, tabOf } from "../components/compose/DraftsHome";
import { fmtWhen, postCosts, sumUsd } from "../components/compose/DraftsList";
import { PostPreview, quotedPostId } from "../components/compose/PostPreview";
import {
  MediaList,
  REPLY_OPTIONS,
  splitBlocks,
  ThreadEditor,
} from "../components/compose/ThreadEditor";
import { HeaderTabs, PageHeader } from "../components/PageHeader";
import { Companion } from "../components/shell/Companion";
import { sectionLabel, useSection } from "../components/shell/sections";
import { Button } from "../components/ui/button";
import { compactInputClass, inputClass } from "../components/ui/field";
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
import { queueAtom, scheduleAtom } from "../state/plan";
import { settingsAtom } from "../state/settings";

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

const isBlank = (e: Editor) =>
  e.kind === "thread"
    ? e.blocks.every((b) => b.text.trim() === "") && e.media.length === 0
    : e.title.trim() === "" && e.body.trim() === "";

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
    <XCard title={`Inspired by @${post.post.author.handle}`}>
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
    <XCard title={target === null ? "Replying" : `Replying to @${target.handle}`}>
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
const check = "size-4 cursor-pointer accent-foreground";

function Options({ editor, onChange }: { editor: Editor; onChange: (e: Editor) => void }) {
  const poll = editor.poll;
  const quoteBad = editor.quoteUrl.trim() !== "" && quotedPostId(editor.quoteUrl) === null;
  return (
    <div className="flex flex-col pb-2 text-[13px]">
      <label className={row}>
        <span>Who can reply to every post</span>
        <select
          className={cn(compactInputClass, "w-auto")}
          value={editor.replySettings}
          onChange={(e) => onChange({ ...editor, replySettings: e.target.value as ReplySettings })}
        >
          {REPLY_OPTIONS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
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
        <input
          type="checkbox"
          className={check}
          checked={poll !== null}
          onChange={(e) =>
            onChange({
              ...editor,
              poll: e.target.checked ? { options: ["", ""], durationMinutes: 1440 } : null,
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
            <select
              aria-label="Poll length"
              className={cn(compactInputClass, "w-auto")}
              value={poll.durationMinutes}
              onChange={(e) =>
                onChange({ ...editor, poll: { ...poll, durationMinutes: Number(e.target.value) } })
              }
            >
              {POLL_DURATIONS.map(([m, label]) => (
                <option key={m} value={m}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}
      <label className={row}>
        <span>
          Hide link previews
          <span className="block text-xs text-muted-foreground">
            Removed through your x.com session after posting
          </span>
        </span>
        <input
          type="checkbox"
          className={check}
          checked={editor.hideLinkPreviews}
          onChange={(e) => onChange({ ...editor, hideLinkPreviews: e.target.checked })}
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
      key={`${search.draft ?? ""}|${search.inspire ?? ""}|${search.reply ?? ""}|${search.text ?? ""}`}
      draftParam={search.draft}
      inspire={search.inspire}
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

function ComposeEditor({
  draftParam,
  inspire,
  reply,
  text,
  onBack,
  onSection,
}: {
  readonly draftParam: string | undefined;
  readonly inspire: string | undefined;
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
  const postNow = useAtomSet(postNowAtom, { mode: "promiseExit" });
  const mediaAdd = useAtomSet(mediaAddAtom, { mode: "promiseExit" });
  const mediaRemove = useAtomSet(mediaRemoveAtom, { mode: "promiseExit" });
  const generateCover = useAtomSet(generateCoverAtom, { mode: "promiseExit" });

  const initial: Editor = {
    ...empty,
    replyToPostId: reply ?? null,
    blocks: [{ text: text ?? "" }],
  };
  const [selected, setSelected] = useState<Draft | null>(null);
  const [editor, setEditor] = useState<Editor>(initial);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [active, setActive] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"post" | "schedule" | null>(null);
  const [when, setWhen] = useState("");
  const [coverPrompt, setCoverPrompt] = useState("");
  const lastSaved = useRef<string>(JSON.stringify(initial));
  const saving = useRef(false);

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

  // Autosave: one row per editor session, created on the first non-blank change.
  const save = async (force = false): Promise<Draft | null> => {
    const json = JSON.stringify(editor);
    if ((json === lastSaved.current && !force) || saving.current) return selected;
    if (selected === null && isBlank(editor) && !force) return null;
    saving.current = true;
    try {
      const d =
        selected === null
          ? await create({
              ...toPatch(editor),
              ...(inspire === undefined ? {} : { source: sourceUrl(inspire) }),
            })
          : await update({ id: selected.id, patch: toPatch(editor) });
      lastSaved.current = json;
      setSelected(d);
      refresh();
      return d;
    } finally {
      saving.current = false;
    }
  };
  useEffect(() => {
    // eslint-disable-next-line react/exhaustive-effect-dependencies -- debounced on content only; `save` is rebuilt each render.
    const t = setTimeout(save, 600);
    return () => clearTimeout(t);
  }, [editor, selected?.id]);

  /** Media rows come back from the service; the editor keeps its own order and alt text in sync with them. */
  const takeMedia = (d: Draft) => {
    setSelected(d);
    setEditor((e) => ({ ...e, media: d.media }));
    lastSaved.current = JSON.stringify({ ...editor, media: d.media });
    refresh();
  };

  const addFiles = async (blockIndex: number, files: ReadonlyArray<File>) => {
    // Files need a row to hang off; a blank editor gets one now.
    const d = selected ?? (await save(true));
    if (d === null) return;
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
      const added = exit.value.media.find((m) => !editor.media.some((x) => x.id === m.id));
      if (added !== undefined)
        setPreviews((p) => ({ ...p, [added.id]: URL.createObjectURL(file) }));
      takeMedia(exit.value);
    }
    /* eslint-enable no-await-in-loop */
  };

  const removeMedia = async (id: string) => {
    if (selected === null) return;
    const exit = await mediaRemove({ draftId: selected.id, id });
    if (Exit.isFailure(exit)) setNotice(`Failed: ${failText(exit.cause)}`);
    else takeMedia(exit.value);
  };

  const act = async (what: "queue" | "schedule" | "post") => {
    const d = (await save()) ?? selected;
    if (d === null) return;
    // The picker's wall time is in the account zone, whatever the browser's.
    const at = localInputToInstant(zone, when);
    if (what === "schedule" && at === null) return;
    const exit =
      what === "queue"
        ? await queue(d.id)
        : what === "schedule"
          ? await schedule({ id: d.id, at: at!.toISOString() })
          : await postNow(d.id);
    setConfirm(null);
    refreshContext();
    if (Exit.isFailure(exit)) {
      setNotice(failText(exit.cause));
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
          : `Queued for ${next.scheduledAt === null ? "later" : fmtWhen(next.scheduledAt)}`,
    );
  };

  // Read once per mount; the slot label only needs to know which week it falls in.
  const [mountedAt] = useState(() => new Date());
  const [voice, setVoice] = useState<{ readonly score: number; readonly text: string } | null>(
    null,
  );

  const blocks = editor.blocks;
  const media = editor.media;
  const hasMedia = media.length > 0;
  const quoteUrl = editor.quoteUrl.trim() === "" ? null : editor.quoteUrl.trim();
  const quoteBad = quoteUrl !== null && quotedPostId(quoteUrl) === null;
  const costs = rates === null ? [] : postCosts(rates, blocks, media, quoteUrl);
  const total = sumUsd(costs);
  const linkCount = rates === null ? 0 : costs.filter((c) => c === rates.postWithLink).length;
  const sessionCount = costs.filter((c) => c === 0).length;
  const isArticle = editor.kind === "article";
  const cover = media.find((m) => m.blockIndex === 0 && m.kind === "image");
  // Posted is final; a draft mid-publish belongs to the publisher.
  const locked = selected?.status === "posted" || selected?.status === "posting";
  const canSend = !isBlank(editor) && !locked && rates !== null && !quoteBad;
  const sessionBlocked = hasMedia && (!sessionPosting || context?.desktopConnected === false);
  // What sending costs: a thread post by post, an article as its draft and publish requests.
  const sendUsd = isArticle
    ? quote === null
      ? null
      : quote.articleUsd * 2
    : rates === null
      ? null
      : total;
  const price =
    sendUsd === null ? <Cost tone="solid" label="…" /> : <Cost tone="solid" usd={sendUsd} />;

  const waiting = draftParam !== undefined && selected === null;
  const queued = selected?.status === "queued";
  const slotAt =
    queued && selected.scheduledAt !== null ? selected.scheduledAt : (context?.nextSlot ?? null);
  const slot = slotAt === null ? null : slotLabel(zone, new Date(slotAt), mountedAt);
  const firstLine = (isArticle ? editor.title : (blocks[0]?.text ?? "")).split("\n")[0]?.trim();
  const title = waiting
    ? "Draft"
    : firstLine !== undefined && firstLine !== ""
      ? firstLine
      : selected !== null
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
        selected === null || selected.status === "draft" ? null : selected.status,
        voiceScore === null ? null : `voice ${Math.round(voiceScore * 100)}%`,
      ].filter((x) => x !== null);
  const back = selected === null ? "drafts" : tabOf(selected.status);

  const postNowText = isArticle
    ? "Publish this article now: a draft and a publish request."
    : `Post ${blocks.length} ${blocks.length === 1 ? "post" : "posts"} now.`;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        leading={
          <Button
            variant="ghost-muted"
            size="sm"
            aria-label={`Back to ${sectionLabel("/compose", back)}`}
            onClick={() => onBack(back)}
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
                          <dt>{sessionCount} with media, through your x.com session</dt>
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
                <p className="mt-2 text-xs text-muted-foreground">Charges your treg balance.</p>
                <div className="mt-3 flex justify-end gap-1.5">
                  <Button variant="ghost" size="xs" onClick={() => setConfirm(null)}>
                    Cancel
                  </Button>
                  <Button size="xs" onClick={() => act("post")}>
                    Confirm and post
                  </Button>
                </div>
              </Popover>
              <Popover
                open={confirm === "schedule"}
                onOpenChange={(open) => setConfirm(open ? "schedule" : null)}
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
                    <span className="font-mono text-2xs">{zone}</span>
                  </span>
                  <input
                    type="datetime-local"
                    aria-label="Post at"
                    className={cn(inputClass, "font-mono text-xs")}
                    value={when}
                    onChange={(e) => setWhen(e.target.value)}
                  />
                </label>
                <div className="mt-3 flex justify-end gap-1.5">
                  <Button variant="ghost" size="xs" onClick={() => setConfirm(null)}>
                    Cancel
                  </Button>
                  <Button size="xs" disabled={when === ""} onClick={() => act("schedule")}>
                    Schedule
                    {price}
                  </Button>
                </div>
              </Popover>
              <Button
                size="sm"
                variant={queued ? "outline" : "default"}
                disabled={!canSend || queued}
                onClick={() => act("queue")}
              >
                <TextMorph duration={250}>{queued ? "Queued" : "Queue"}</TextMorph>
                {queued ? sendUsd === null ? <Cost label="…" /> : <Cost usd={sendUsd} /> : price}
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
            {selected?.status === "failed" && notice === null ? (
              <p className="mb-3 text-xs text-error-foreground">Failed: {selected.error}</p>
            ) : null}
            {locked ? (
              <p className="mb-3 text-xs text-muted-foreground">
                This draft is {selected?.status}; start a new draft to change it.
                {selected?.linkPreviewNote === null ? "" : ` ${selected?.linkPreviewNote}`}
              </p>
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
                {AsyncResult.isSuccess(drafts) ? "This draft no longer exists." : "Loading draft"}
              </p>
            ) : isArticle ? (
              <div className="flex flex-col gap-3">
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
                      disabled={coverPrompt.trim() === "" || cover !== undefined || quote === null}
                      onClick={async () => {
                        const d = selected ?? (await save(true));
                        if (d === null) return;
                        setNotice("Generating cover");
                        const exit = await generateCover({ draftId: d.id, prompt: coverPrompt });
                        if (Exit.isFailure(exit)) setNotice(`Failed: ${failText(exit.cause)}`);
                        else {
                          takeMedia(exit.value);
                          setNotice("Cover generated");
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
              </div>
            ) : (
              <fieldset disabled={locked} className="min-w-0">
                <ThreadEditor
                  blocks={blocks}
                  media={media}
                  previews={previews}
                  active={active}
                  avatar={(handle ?? "you").slice(0, 1).toUpperCase()}
                  notes={costs.map((c) =>
                    rates === null ? null : c === 0 ? (
                      "media, through your session, free"
                    ) : c === rates.postWithLink ? (
                      <>
                        link
                        <Cost usd={c} />
                      </>
                    ) : null,
                  )}
                  onChange={(b) => setEditor({ ...editor, blocks: b })}
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
                <Options editor={editor} onChange={setEditor} />
              </details>
            )}
          </div>
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
                <ComposeContext
                  firstLine={blocks[0]?.text.split("\n")[0] ?? ""}
                  onUse={(b) => setEditor({ ...editor, blocks: b.map((text) => ({ text })) })}
                />
              </>
            )}
          </Companion>
        </PageBody>
        {waiting || isArticle || locked ? null : (
          <div className="mx-auto w-full max-w-[640px] shrink-0 px-6">
            <AssistPanel
              blocks={blocks.map((b) => b.text)}
              active={active}
              onReplaceBlock={(i, text) =>
                setEditor({
                  ...editor,
                  blocks: blocks.map((b, j) => (j === i ? { ...b, text } : b)),
                })
              }
              onInsertAfter={(i, texts) =>
                setEditor({
                  ...editor,
                  blocks: [
                    ...blocks.slice(0, i + 1),
                    ...texts.map((text) => ({ text })),
                    ...blocks.slice(i + 1),
                  ],
                })
              }
              onReplaceAll={(b) =>
                setEditor({ ...editor, blocks: b.flatMap(splitBlocks).map((text) => ({ text })) })
              }
              onVoiceScore={(score) =>
                setVoice({ score, text: JSON.stringify(blocks.map((b) => b.text)) })
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}

const isTab = (value: unknown): value is ComposeTab => COMPOSE_TABS.some((tab) => tab === value);

const validateSearch = (s: Record<string, unknown>) => ({
  draft: typeof s.draft === "string" ? s.draft : undefined,
  inspire: typeof s.inspire === "string" ? s.inspire : undefined,
  reply: typeof s.reply === "string" ? s.reply : undefined,
  text: typeof s.text === "string" ? s.text : undefined,
  // `?new=1` parses as the number 1.
  new: s.new === true || s.new === 1 || s.new === "1" ? (true as const) : undefined,
  tab: isTab(s.tab) ? s.tab : undefined,
});
type ComposeSearch = ReturnType<typeof validateSearch>;

export const Route = createFileRoute("/compose")({ validateSearch, component: ComposeScreen });
