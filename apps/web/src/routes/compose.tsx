import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  type Draft,
  type DraftBlock,
  type DraftMedia,
  type DraftPatch,
  type DraftPoll,
  MEDIA_MAX_BYTES,
  postCostUsd,
  type ReplySettings,
} from "@xtend/contracts";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { ArrowLeft, CalendarClock } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AssistPanel, ComposeContext, failText } from "../components/compose/AssistPanel";
import { COMPOSE_TABS, type ComposeTab, DraftsHome, tabOf } from "../components/compose/DraftsHome";
import { fmtWhen, statusTone } from "../components/compose/DraftsList";
import { PostPreview, quotedPostId } from "../components/compose/PostPreview";
import {
  MediaList,
  REPLY_OPTIONS,
  splitBlocks,
  ThreadEditor,
} from "../components/compose/ThreadEditor";
import { shellBridge } from "../components/shell/bridge";
import { Companion } from "../components/shell/Companion";
import { SubTabs, XCard, xInput, xMeta, xPill, xPillSm, xPillSolid } from "../components/x";
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

const usd = (n: number) => `$${n.toFixed(3)}`;

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => reject(reader.error));
    reader.addEventListener("load", () => resolve((reader.result as string).split(",")[1] ?? ""));
    reader.readAsDataURL(file);
  });

/** The Library post a new draft was started from; shown beside the editor, linked on the draft. */
function Inspiration({ postId }: { readonly postId: string }) {
  const saved = useAtomValue(savedPostAtom(postId));
  const post = AsyncResult.getOrElse(saved, () => null);
  if (post === null) return null;
  return (
    <XCard title={`Inspired by @${post.post.author.handle}`}>
      <p className="whitespace-pre-wrap px-4 pb-3 text-[15px] leading-5">{post.post.text}</p>
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
        <p className="line-clamp-6 whitespace-pre-wrap px-4 pb-3 text-[15px] leading-5">
          {target.text}
        </p>
      ) : (
        <a
          className="block truncate px-4 pb-3 text-[15px] text-primary"
          href={sourceUrl(postId)}
          target="_blank"
          rel="noreferrer"
        >
          {sourceUrl(postId)}
        </a>
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

function Options({ editor, onChange }: { editor: Editor; onChange: (e: Editor) => void }) {
  const poll = editor.poll;
  const quoteBad = editor.quoteUrl.trim() !== "" && quotedPostId(editor.quoteUrl) === null;
  return (
    <div className="flex flex-col text-[15px] [&>label]:border-t [&>label]:border-border [&>label]:px-4 [&>label]:py-3">
      <label className="flex items-center justify-between gap-2">
        <span>Who can reply to every post</span>
        <select
          className={cn(xInput, "w-auto")}
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
      <label className="flex flex-col gap-1.5">
        <span>Quote a post</span>
        <span className={xMeta}>An x.com link, posted in the first post at the link price.</span>
        <input
          className={xInput}
          aria-label="Quote post link"
          placeholder="https://x.com/handle/status/123"
          value={editor.quoteUrl}
          onChange={(e) => onChange({ ...editor, quoteUrl: e.target.value })}
        />
        {quoteBad ? (
          <span className="text-[13px] text-[#f4212e]">Not an x.com status link</span>
        ) : null}
      </label>
      <label className="flex items-center justify-between gap-2">
        <span>Poll on the first post</span>
        <input
          type="checkbox"
          className="size-4 accent-[#1d9bf0]"
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
        <div className="flex flex-col gap-2 px-4 pb-3">
          {poll.options.map((o, i) => (
            // eslint-disable-next-line react/no-array-index-key -- options are plain strings; position is their identity.
            <div key={i} className="flex gap-1">
              <input
                className={xInput}
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
                <button
                  type="button"
                  className={cn(xPill, xPillSm)}
                  aria-label={`Remove option ${i + 1}`}
                  onClick={() =>
                    onChange({
                      ...editor,
                      poll: { ...poll, options: poll.options.filter((_, j) => j !== i) },
                    })
                  }
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="cursor-pointer text-[15px] text-primary disabled:opacity-50"
              disabled={poll.options.length >= 4}
              onClick={() =>
                onChange({ ...editor, poll: { ...poll, options: [...poll.options, ""] } })
              }
            >
              Add option
            </button>
            <select
              className={cn(xInput, "w-auto")}
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
      <label className="flex items-center justify-between gap-2">
        <span>
          Hide link previews
          <span className={cn(xMeta, "block")}>
            Removed through your x.com session after posting.
          </span>
        </span>
        <input
          type="checkbox"
          className="size-4 accent-[#1d9bf0]"
          checked={editor.hideLinkPreviews}
          onChange={(e) => onChange({ ...editor, hideLinkPreviews: e.target.checked })}
        />
      </label>
      <label className="flex items-center justify-between gap-2">
        <span>Seconds between thread posts</span>
        <input
          type="number"
          min={0}
          className={cn(xInput, "w-20")}
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
 * Compose is drafts first: the list of drafts as X posts, and the composer once a draft, a
 * new thread, a reply, an inspiration or carried-over text is in the URL. A new `?inspire=`,
 * `?reply=`, `?text=` or `?draft=` remounts the composer, so it starts without an effect.
 */
function ComposeScreen() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const settings = useAtomValue(settingsAtom);
  const handle = AsyncResult.getOrElse(
    AsyncResult.map(settings, (s) => s.handle),
    () => null,
  );
  const router = useRouter();
  // In x.com main owns the slot, and the slot's width follows the route (the composer gets
  // X's right column), so moves between the list and the composer go through main.
  const go = (next: Partial<ComposeSearch>) => {
    const search = composeSearch(next);
    const bridge = shellBridge();
    if (bridge === undefined) return void navigate({ to: "/compose", search });
    bridge.openSlot({
      kind: "center",
      route: router.buildLocation({ to: "/compose", search }).href,
    });
  };
  const editing =
    search.draft !== undefined ||
    search.new === true ||
    search.inspire !== undefined ||
    search.reply !== undefined ||
    search.text !== undefined;
  if (!editing) {
    return (
      <DraftsHome
        tab={search.tab ?? "drafts"}
        handle={handle}
        onTab={(tab) => go({ tab })}
        onOpen={(draft) => go({ draft })}
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
      onBack={(tab) => go({ tab })}
    />
  );
}

function ComposeEditor({
  draftParam,
  inspire,
  reply,
  text,
  onBack,
}: {
  readonly draftParam: string | undefined;
  readonly inspire: string | undefined;
  readonly reply: string | undefined;
  /** Text carried over from X's composer by the Schedule chip. */
  readonly text: string | undefined;
  /** Back to the list, on the tab the draft now lives under. */
  readonly onBack: (tab: ComposeTab) => void;
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
    refresh();
    setNotice(
      next.status === "failed"
        ? `Failed: ${next.error}`
        : next.status === "posted"
          ? `Posted ${next.postIds.length} ${next.kind === "article" ? "article" : "posts"}${next.linkPreviewNote === null ? "" : `. ${next.linkPreviewNote}`}`
          : `Queued for ${next.scheduledAt === null ? "later" : fmtWhen(next.scheduledAt)}`,
    );
  };

  const blocks = editor.blocks;
  const media = editor.media;
  const hasMedia = media.length > 0;
  const quoteUrl = editor.quoteUrl.trim() === "" ? null : editor.quoteUrl.trim();
  const quoteBad = quoteUrl !== null && quotedPostId(quoteUrl) === null;
  // A block with media goes through the x.com session, which treg does not bill.
  const costs =
    rates === null
      ? []
      : blocks.map((b, i) =>
          media.some((m) => m.blockIndex === i)
            ? 0
            : postCostUsd(rates, i === 0 && quoteUrl !== null ? `${b.text} ${quoteUrl}` : b.text),
        );
  const total = costs.reduce((a, b) => a + b, 0);
  const linkCount = rates === null ? 0 : costs.filter((c) => c === rates.postWithLink).length;
  const sessionCount = costs.filter((c) => c === 0).length;
  const isArticle = editor.kind === "article";
  const cover = media.find((m) => m.blockIndex === 0 && m.kind === "image");
  // Posted is final; a draft mid-publish belongs to the publisher.
  const locked = selected?.status === "posted" || selected?.status === "posting";
  const canSend = !isBlank(editor) && !locked && rates !== null && !quoteBad;
  const sessionBlocked = hasMedia && (!sessionPosting || context?.desktopConnected === false);

  const waiting = draftParam !== undefined && selected === null;
  const nextSlot = context?.nextSlot ?? null;
  const title =
    selected === null
      ? reply !== undefined
        ? "Reply"
        : isArticle
          ? "New article"
          : "New thread"
      : isArticle
        ? "Edit article"
        : "Edit thread";

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[53px] shrink-0 items-center gap-6 border-b border-border px-4">
        <button
          type="button"
          aria-label="Back to drafts"
          className="-ml-2 flex size-9 cursor-pointer items-center justify-center rounded-full hover:bg-accent"
          onClick={() => onBack(selected === null ? "drafts" : tabOf(selected.status))}
        >
          <ArrowLeft className="size-5" />
        </button>
        <h2 className="flex-1 text-xl font-bold">{title}</h2>
        {selected !== null ? (
          <span className={cn("text-[13px]", statusTone[selected.status])}>
            {selected.status === "queued" && selected.scheduledAt !== null
              ? `Queued · ${fmtWhen(selected.scheduledAt)}`
              : selected.status}
          </span>
        ) : null}
      </div>
      {locked ? null : (
        <SubTabs
          tabs={[
            { id: "thread", label: "Thread" },
            { id: "article", label: "Article" },
          ]}
          value={editor.kind}
          onChange={(kind) => setEditor({ ...editor, kind })}
        />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {notice !== null ? (
          <p
            role="status"
            className={cn(
              "border-b border-border px-4 py-2 text-[13px]",
              notice.startsWith("Failed") ? "text-[#f4212e]" : "text-[#00ba7c]",
            )}
          >
            {notice}
          </p>
        ) : null}
        {selected?.status === "failed" && notice === null ? (
          <p className="border-b border-border px-4 py-2 text-[13px] text-[#f4212e]">
            Failed: {selected.error}
          </p>
        ) : null}
        {locked ? (
          <p className={cn(xMeta, "border-b border-border px-4 py-2")}>
            This draft is {selected?.status}; start a new draft to change it.
            {selected?.linkPreviewNote === null ? "" : ` ${selected?.linkPreviewNote}`}
          </p>
        ) : null}
        {sessionBlocked ? (
          <p className="border-b border-border px-4 py-2 text-[13px] text-[#ffd400]">
            {sessionPosting
              ? "Media posts go through your x.com session, but no desktop is connected."
              : "Media posts go through your x.com session, enable Session posting in Settings."}
          </p>
        ) : null}
        {waiting ? (
          <p className={cn(xMeta, "px-4 py-8 text-center")}>
            {AsyncResult.isSuccess(drafts) ? "This draft no longer exists." : "Loading…"}
          </p>
        ) : isArticle ? (
          <div className="flex flex-col gap-3 px-4 py-3">
            <input
              className="w-full bg-transparent text-2xl font-extrabold outline-hidden placeholder:text-placeholder"
              placeholder="Title"
              value={editor.title}
              onChange={(e) => setEditor({ ...editor, title: e.target.value })}
            />
            <textarea
              className="min-h-80 w-full resize-none bg-transparent text-[17px] leading-6 outline-hidden placeholder:text-placeholder"
              placeholder="Write in markdown"
              value={editor.body}
              onChange={(e) => setEditor({ ...editor, body: e.target.value })}
            />
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <span className="text-[15px] font-bold">Cover</span>
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
              <input
                className={xInput}
                placeholder="Describe the cover image"
                value={coverPrompt}
                onChange={(e) => setCoverPrompt(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={cn(xPill, xPillSm)}
                  disabled={coverPrompt.trim() === "" || cover !== undefined || quote === null}
                  onClick={async () => {
                    const d = selected ?? (await save(true));
                    if (d === null) return;
                    setNotice("Generating cover…");
                    const exit = await generateCover({ draftId: d.id, prompt: coverPrompt });
                    if (Exit.isFailure(exit)) setNotice(`Failed: ${failText(exit.cause)}`);
                    else {
                      takeMedia(exit.value);
                      setNotice("Cover generated");
                    }
                  }}
                >
                  Generate · {quote === null ? "…" : `${usd(quote.coverUsd)}, ${quote.coverModel}`}
                </button>
                <button
                  type="button"
                  className={cn(xPill, xPillSm)}
                  disabled={cover !== undefined}
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = "image/*";
                    input.addEventListener("change", () => addFiles(0, [...(input.files ?? [])]));
                    input.click();
                  }}
                >
                  Upload
                </button>
              </div>
              <p className={xMeta}>
                Published through X Articles via treg (
                {quote === null ? "…" : usd(quote.articleUsd)} per request). Unverified against the
                live API; the first publish may fail.
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
              onChange={(b) => setEditor({ ...editor, blocks: b })}
              onFocus={setActive}
              onAddFiles={addFiles}
              onMediaChange={(m) => setEditor((e) => ({ ...e, media: m }))}
              onRemoveMedia={removeMedia}
            />
          </fieldset>
        )}
        {waiting || isArticle ? null : (
          <details className="border-t border-border">
            <summary className="cursor-pointer px-4 py-3 text-[15px] text-primary hover:bg-primary/5">
              More options
            </summary>
            <Options editor={editor} onChange={setEditor} />
          </details>
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
              />
              <ComposeContext
                firstLine={blocks[0]?.text.split("\n")[0] ?? ""}
                onUse={(b) => setEditor({ ...editor, blocks: b.map((text) => ({ text })) })}
              />
            </>
          )}
        </Companion>
      </div>
      {confirm === "post" ? (
        <div className="shrink-0 border-t border-border px-4 py-3 text-[15px] leading-5">
          <p>
            {isArticle
              ? `Publish this article now for ${quote === null ? "…" : usd(quote.articleUsd * 2)} (draft and publish, ${quote === null ? "…" : usd(quote.articleUsd)} each).`
              : `Post ${blocks.length} ${blocks.length === 1 ? "post" : "posts"} now for ${usd(total)}${
                  linkCount > 0 && rates !== null
                    ? ` (${linkCount} with a link at ${usd(rates.postWithLink)})`
                    : ""
                }${sessionCount > 0 ? ` (${sessionCount} with media through your x.com session, free)` : ""}.`}{" "}
            This charges your treg balance.
          </p>
          <div className="mt-2.5 flex gap-2">
            <button type="button" className={cn(xPillSolid, xPillSm)} onClick={() => act("post")}>
              Confirm and post
            </button>
            <button type="button" className={cn(xPill, xPillSm)} onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : confirm === "schedule" ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          <input
            type="datetime-local"
            aria-label="Post at"
            className={cn(xInput, "w-auto")}
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
          <span className={xMeta}>{zone}</span>
          <span className="flex-1" />
          <button
            type="button"
            className={cn(xPillSolid, xPillSm)}
            disabled={when === ""}
            onClick={() => act("schedule")}
          >
            Schedule
          </button>
          <button type="button" className={cn(xPill, xPillSm)} onClick={() => setConfirm(null)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2.5">
          <p className={cn(xMeta, "min-w-0 flex-1")}>
            {isArticle ? (
              "Article"
            ) : (
              <>
                <span className="text-foreground">
                  {blocks.length} {blocks.length === 1 ? "post" : "posts"}
                </span>{" "}
                · {rates === null ? "…" : usd(total)} to post
                {linkCount > 0 ? (
                  <span className="block">{linkCount} with a link, billed higher</span>
                ) : null}
                {sessionCount > 0 ? (
                  <span className="block">{sessionCount} with media via your session, free</span>
                ) : null}
              </>
            )}
          </p>
          <button
            type="button"
            className={xPill}
            disabled={!canSend}
            onClick={() => setConfirm("post")}
          >
            Post now
          </button>
          <button
            type="button"
            className={cn(xPill, "px-2.5")}
            aria-label="Schedule"
            disabled={!canSend}
            onClick={() => setConfirm("schedule")}
          >
            <CalendarClock className="size-[18px]" />
          </button>
          <button
            type="button"
            className={xPillSolid}
            disabled={!canSend}
            onClick={() => act("queue")}
          >
            Queue
            {nextSlot !== null ? (
              <span className="font-normal text-[#536471]">· {fmtWhen(nextSlot)}</span>
            ) : null}
          </button>
        </div>
      )}
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
