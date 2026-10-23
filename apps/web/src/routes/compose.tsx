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
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AssistPanel, ComposeContext, failText } from "../components/compose/AssistPanel";
import { DraftsList, fmtWhen, statusTone } from "../components/compose/DraftsList";
import { PostPreview, quotedPostId } from "../components/compose/PostPreview";
import {
  inputClass,
  MediaList,
  REPLY_OPTIONS,
  splitBlocks,
  ThreadEditor,
} from "../components/compose/ThreadEditor";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { localInputToInstant } from "../lib/time";
import {
  composeContextAtom,
  composeQuoteAtom,
  createDraftAtom,
  deleteDraftAtom,
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
    <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-2 text-xs">
      <span className="text-2xs text-muted-foreground">Inspired by @{post.post.author.handle}</span>
      <p className="whitespace-pre-wrap text-foreground/90">{post.post.text}</p>
    </div>
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
    <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-2 text-xs">
      <span className="text-2xs text-muted-foreground">
        Replying to {target === null ? `post ${postId}` : `@${target.handle}`}
      </span>
      {target !== null ? (
        <p className="line-clamp-6 whitespace-pre-wrap text-foreground/90">{target.text}</p>
      ) : (
        <a
          className="text-info-foreground"
          href={sourceUrl(postId)}
          target="_blank"
          rel="noreferrer"
        >
          {sourceUrl(postId)}
        </a>
      )}
    </div>
  );
}

const POLL_DURATIONS = [
  [60, "1 hour"],
  [360, "6 hours"],
  [1440, "1 day"],
  [4320, "3 days"],
  [10080, "7 days"],
] as const;

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      data-active={active || undefined}
      className="data-active:bg-accent"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function Options({ editor, onChange }: { editor: Editor; onChange: (e: Editor) => void }) {
  const poll = editor.poll;
  const quoteBad = editor.quoteUrl.trim() !== "" && quotedPostId(editor.quoteUrl) === null;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-2 text-xs">
      <label className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Who can reply (default for every post)</span>
        <select
          className={inputClass + " w-auto"}
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
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">
          Quote post (x.com status link, posted as a link in the first post at the link price)
        </span>
        <input
          className={inputClass}
          aria-label="Quote post link"
          placeholder="https://x.com/handle/status/123"
          value={editor.quoteUrl}
          onChange={(e) => onChange({ ...editor, quoteUrl: e.target.value })}
        />
        {quoteBad ? (
          <span className="text-2xs text-error-foreground">Not an x.com status link</span>
        ) : null}
      </label>
      <label className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Poll on first post</span>
        <input
          type="checkbox"
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
        <div className="flex flex-col gap-1 pl-2">
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
                  size="xs"
                  onClick={() =>
                    onChange({
                      ...editor,
                      poll: { ...poll, options: poll.options.filter((_, j) => j !== i) },
                    })
                  }
                >
                  x
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
              className={inputClass + " w-auto"}
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
        <span className="text-muted-foreground">
          Hide link preview (removed through your x.com session after posting)
        </span>
        <input
          type="checkbox"
          checked={editor.hideLinkPreviews}
          onChange={(e) => onChange({ ...editor, hideLinkPreviews: e.target.checked })}
        />
      </label>
      <label className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Seconds between thread posts</span>
        <input
          type="number"
          min={0}
          className={inputClass + " w-20"}
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

/** A new `?inspire=` or `?reply=` remounts the editor, so a fresh draft starts without an effect. */
function ComposeScreen() {
  const { draft: draftParam, inspire, reply } = Route.useSearch();
  return (
    <ComposeEditor
      key={`${inspire ?? ""}|${reply ?? ""}`}
      draftParam={draftParam}
      inspire={inspire}
      reply={reply}
    />
  );
}

function ComposeEditor({
  draftParam,
  inspire,
  reply,
}: {
  readonly draftParam: string | undefined;
  readonly inspire: string | undefined;
  readonly reply: string | undefined;
}) {
  const rates = useRates();
  const navigate = useNavigate();
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
  const remove = useAtomSet(deleteDraftAtom, { mode: "promise" });
  const queue = useAtomSet(queueAtom, { mode: "promiseExit" });
  const schedule = useAtomSet(scheduleAtom, { mode: "promiseExit" });
  const postNow = useAtomSet(postNowAtom, { mode: "promiseExit" });
  const mediaAdd = useAtomSet(mediaAddAtom, { mode: "promiseExit" });
  const mediaRemove = useAtomSet(mediaRemoveAtom, { mode: "promiseExit" });
  const generateCover = useAtomSet(generateCoverAtom, { mode: "promiseExit" });

  const initial: Editor = reply === undefined ? empty : { ...empty, replyToPostId: reply };
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
  const fresh = () => {
    setSelected(null);
    setEditor(empty);
    lastSaved.current = JSON.stringify(empty);
    setActive(0);
    setConfirm(null);
    setNotice(null);
  };

  // Deep link from Plan ("edit"): open once the list is loaded, then drop the param.
  useEffect(() => {
    if (draftParam === undefined || !AsyncResult.isSuccess(drafts)) return;
    const d = drafts.value.find((x) => x.id === draftParam);
    // eslint-disable-next-line react/set-state-in-effect -- the editor state is this effect's output.
    if (d !== undefined && d.id !== selected?.id) open(d);
    navigate({ to: "/compose", search: { draft: undefined, inspire, reply }, replace: true });
    // eslint-disable-next-line react/exhaustive-effect-dependencies -- runs once per deep link, not per selection.
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

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Compose"
        detail={
          selected === null ? (
            reply === undefined ? (
              "new draft"
            ) : (
              "reply"
            )
          ) : (
            <span className={statusTone[selected.status]}>{selected.status}</span>
          )
        }
        actions={
          <>
            <Button variant="ghost" size="sm" disabled={!canSend} onClick={() => act("queue")}>
              Add to queue
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!canSend}
              onClick={() => setConfirm(confirm === "schedule" ? null : "schedule")}
            >
              Schedule
            </Button>
            <Button
              size="sm"
              disabled={!canSend}
              onClick={() => setConfirm(confirm === "post" ? null : "post")}
            >
              Post now
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col border-r border-border">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-2xs text-muted-foreground">Drafts</span>
            <Button variant="ghost-muted" size="icon-xs" aria-label="New draft" onClick={fresh}>
              <Plus />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {AsyncResult.match(drafts, {
              onInitial: () => <p className="px-3 py-4 text-2xs text-muted-foreground">Loading…</p>,
              onFailure: (f) => (
                <p className="px-3 py-4 text-2xs text-error-foreground">{failText(f.cause)}</p>
              ),
              onSuccess: ({ value }) => (
                <DraftsList
                  drafts={value}
                  selectedId={selected?.id ?? null}
                  onOpen={open}
                  onDelete={async (id) => {
                    await remove(id);
                    if (selected?.id === id) fresh();
                    refresh();
                  }}
                />
              ),
            })}
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <div className="flex items-center gap-1">
            <Tab active={!isArticle} onClick={() => setEditor({ ...editor, kind: "thread" })}>
              Thread
            </Tab>
            <Tab active={isArticle} onClick={() => setEditor({ ...editor, kind: "article" })}>
              Article
            </Tab>
          </div>
          {confirm === "post" ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning-surface px-3 py-2 text-xs">
              <span>
                {isArticle
                  ? `Publish this article now for ${quote === null ? "…" : usd(quote.articleUsd * 2)} (draft and publish, ${quote === null ? "…" : usd(quote.articleUsd)} each).`
                  : `Post ${blocks.length} ${blocks.length === 1 ? "post" : "posts"} now for ${usd(total)}${
                      linkCount > 0 && rates !== null
                        ? ` (${linkCount} with a link at ${usd(rates.postWithLink)})`
                        : ""
                    }${sessionCount > 0 ? ` (${sessionCount} with media through your x.com session, free)` : ""}.`}{" "}
                This charges your treg balance.
              </span>
              <Button size="xs" onClick={() => act("post")}>
                Confirm and post
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
            </div>
          ) : null}
          {confirm === "schedule" ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
              <input
                type="datetime-local"
                className={inputClass + " w-auto"}
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
              <span className="text-2xs text-muted-foreground">{zone}</span>
              <Button size="xs" disabled={when === ""} onClick={() => act("schedule")}>
                Schedule
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
            </div>
          ) : null}
          {notice !== null ? (
            <p
              className={
                "text-xs " +
                (notice.startsWith("Failed") ? "text-error-foreground" : "text-success-foreground")
              }
            >
              {notice}
            </p>
          ) : null}
          {selected?.status === "failed" && notice === null ? (
            <p className="text-xs text-error-foreground">Failed: {selected.error}</p>
          ) : null}
          {locked ? (
            <p className="text-xs text-muted-foreground">
              This draft is {selected?.status}; start a new draft to change it.
              {selected?.linkPreviewNote === null ? "" : ` ${selected?.linkPreviewNote}`}
            </p>
          ) : null}
          {sessionBlocked ? (
            <p className="text-xs text-warning-foreground">
              {sessionPosting
                ? "Media posts go through your x.com session, but no desktop is connected."
                : "Media posts go through your x.com session, enable Session posting in Settings."}
            </p>
          ) : null}
          {isArticle ? (
            <div className="flex flex-col gap-2">
              <input
                className={inputClass}
                placeholder="Article title"
                value={editor.title}
                onChange={(e) => setEditor({ ...editor, title: e.target.value })}
              />
              <textarea
                className={inputClass + " min-h-80"}
                placeholder="Body (markdown)"
                value={editor.body}
                onChange={(e) => setEditor({ ...editor, body: e.target.value })}
              />
              <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-2 text-xs">
                <span className="text-muted-foreground">Cover</span>
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
                    placeholder="Describe the cover image"
                    value={coverPrompt}
                    onChange={(e) => setCoverPrompt(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    size="xs"
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
                    Generate cover (
                    {quote === null ? "…" : `${usd(quote.coverUsd)}, ${quote.coverModel}`})
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={cover !== undefined}
                    onClick={() => {
                      const input = document.createElement("input");
                      input.type = "file";
                      input.accept = "image/*";
                      input.addEventListener("change", () => addFiles(0, [...(input.files ?? [])]));
                      input.click();
                    }}
                  >
                    Upload cover
                  </Button>
                </div>
                <p className="text-2xs text-muted-foreground">
                  Published through X Articles via treg (
                  {quote === null ? "…" : usd(quote.articleUsd)} per request). Unverified against
                  the live API; the first publish may fail.
                </p>
              </div>
            </div>
          ) : (
            <>
              <fieldset disabled={locked} className="contents">
                <ThreadEditor
                  blocks={blocks}
                  media={media}
                  previews={previews}
                  active={active}
                  onChange={(b) => setEditor({ ...editor, blocks: b })}
                  onFocus={setActive}
                  onAddFiles={addFiles}
                  onMediaChange={(m) => setEditor((e) => ({ ...e, media: m }))}
                  onRemoveMedia={removeMedia}
                />
              </fieldset>
              <p className="font-mono text-2xs text-muted-foreground">
                {blocks.length} {blocks.length === 1 ? "post" : "posts"} x{" "}
                {rates === null ? "…" : usd(rates.post)} = {usd(total)}
                {linkCount > 0 && rates !== null ? (
                  <span className="text-warning-foreground">
                    {" "}
                    · {linkCount} with a link billed at {usd(rates.postWithLink)}
                  </span>
                ) : null}
                {sessionCount > 0 ? (
                  <span> · {sessionCount} with media via session, free</span>
                ) : null}
              </p>
              <Options editor={editor} onChange={setEditor} />
            </>
          )}
        </main>
        <aside className="flex w-96 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border p-3">
          {inspire !== undefined ? <Inspiration postId={inspire} /> : null}
          {editor.replyToPostId !== null ? <ReplyTarget postId={editor.replyToPostId} /> : null}
          {isArticle ? null : (
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
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/compose")({
  validateSearch: (s: Record<string, unknown>) => ({
    draft: typeof s.draft === "string" ? s.draft : undefined,
    inspire: typeof s.inspire === "string" ? s.inspire : undefined,
    reply: typeof s.reply === "string" ? s.reply : undefined,
  }),
  component: ComposeScreen,
});
