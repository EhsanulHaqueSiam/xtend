import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  type Draft,
  type DraftPatch,
  type DraftPoll,
  postCostUsd,
  type ReplySettings,
} from "@xtend/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AssistPanel, failText } from "../components/compose/AssistPanel";
import { DraftsList, fmtWhen, statusTone } from "../components/compose/DraftsList";
import { PostPreview } from "../components/compose/PostPreview";
import { inputClass, splitBlocks, ThreadEditor } from "../components/compose/ThreadEditor";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { localInputToInstant } from "../lib/time";
import {
  createDraftAtom,
  deleteDraftAtom,
  draftsAtom,
  postNowAtom,
  updateDraftAtom,
} from "../state/compose";
import { useRates } from "../state/costs";
import { savedPostAtom } from "../state/library";
import { queueAtom, scheduleAtom } from "../state/plan";
import { settingsAtom } from "../state/settings";

/** What the editor owns; the service owns status, schedule and outcome. */
interface Editor {
  readonly kind: Draft["kind"];
  readonly blocks: ReadonlyArray<string>;
  readonly title: string;
  readonly body: string;
  readonly replySettings: ReplySettings;
  readonly poll: DraftPoll | null;
  readonly hideLinkPreviews: boolean;
  readonly threadDelaySeconds: number;
}

const empty: Editor = {
  kind: "thread",
  blocks: [""],
  title: "",
  body: "",
  replySettings: "everyone",
  poll: null,
  hideLinkPreviews: false,
  threadDelaySeconds: 0,
};

const fromDraft = (d: Draft): Editor => ({
  kind: d.kind,
  blocks: d.blocks.length === 0 ? [""] : d.blocks.map((b) => b.text),
  title: d.title,
  body: d.body,
  replySettings: d.replySettings,
  poll: d.poll,
  hideLinkPreviews: d.hideLinkPreviews,
  threadDelaySeconds: d.threadDelaySeconds,
});

const toPatch = (e: Editor): DraftPatch => ({ ...e, blocks: e.blocks.map((text) => ({ text })) });
const sourceUrl = (postId: string) => `https://x.com/i/web/status/${postId}`;

const isBlank = (e: Editor) =>
  e.kind === "thread"
    ? e.blocks.every((b) => b.trim() === "")
    : e.title.trim() === "" && e.body.trim() === "";

const usd = (n: number) => `$${n.toFixed(3)}`;

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
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-2 text-xs">
      <label className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Who can reply</span>
        <select
          className={inputClass + " w-auto"}
          value={editor.replySettings}
          onChange={(e) => onChange({ ...editor, replySettings: e.target.value as ReplySettings })}
        >
          <option value="everyone">Everyone</option>
          <option value="following">Accounts you follow</option>
          <option value="mentionedUsers">Only mentioned</option>
          <option value="verified">Verified</option>
        </select>
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
        <span className="text-muted-foreground">Hide link previews (stored, no effect yet)</span>
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

/** A new `?inspire=` remounts the editor, so a fresh draft starts without an effect. */
function ComposeScreen() {
  const { draft: draftParam, inspire } = Route.useSearch();
  return <ComposeEditor key={inspire ?? ""} draftParam={draftParam} inspire={inspire} />;
}

function ComposeEditor({
  draftParam,
  inspire,
}: {
  readonly draftParam: string | undefined;
  readonly inspire: string | undefined;
}) {
  const rates = useRates();
  const navigate = useNavigate();
  const drafts = useAtomValue(draftsAtom);
  const refresh = useAtomRefresh(draftsAtom);
  const settings = useAtomValue(settingsAtom);
  const handle = AsyncResult.getOrElse(
    AsyncResult.map(settings, (s) => s.handle),
    () => null,
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

  const [selected, setSelected] = useState<Draft | null>(null);
  const [editor, setEditor] = useState<Editor>(empty);
  const [active, setActive] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"post" | "schedule" | null>(null);
  const [when, setWhen] = useState("");
  const lastSaved = useRef<string>(JSON.stringify(empty));
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
    navigate({ to: "/compose", search: { draft: undefined, inspire }, replace: true });
    // eslint-disable-next-line react/exhaustive-effect-dependencies -- runs once per deep link, not per selection.
  }, [draftParam, drafts]);

  // Autosave: one row per editor session, created on the first non-blank change.
  const save = async (): Promise<Draft | null> => {
    const json = JSON.stringify(editor);
    if (json === lastSaved.current || saving.current) return selected;
    if (selected === null && isBlank(editor)) return null;
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
          ? `Posted ${next.postIds.length} posts`
          : `Queued for ${next.scheduledAt === null ? "later" : fmtWhen(next.scheduledAt)}`,
    );
  };

  const blocks = editor.blocks;
  const costs = rates === null ? [] : blocks.map((b) => postCostUsd(rates, b));
  const total = costs.reduce((a, b) => a + b, 0);
  const linkCount = rates === null ? 0 : costs.filter((c) => c === rates.postWithLink).length;
  const isArticle = editor.kind === "article";
  // Posted is final; a draft mid-publish belongs to the publisher.
  const locked = selected?.status === "posted" || selected?.status === "posting";
  const canSend = !isArticle && !isBlank(editor) && !locked && rates !== null;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Compose"
        detail={
          selected === null ? (
            "new draft"
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
                Post {blocks.length} {blocks.length === 1 ? "post" : "posts"} now for {usd(total)}
                {linkCount > 0 && rates !== null
                  ? ` (${linkCount} with a link at ${usd(rates.postWithLink)})`
                  : ""}
                . This charges your treg balance.
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
              <p className="text-2xs text-muted-foreground">
                Saved as an article draft. Posting articles needs a treg article endpoint, which
                does not exist yet.
              </p>
            </div>
          ) : (
            <>
              <fieldset disabled={locked} className="contents">
                <ThreadEditor
                  blocks={blocks}
                  active={active}
                  onChange={(b) => setEditor({ ...editor, blocks: b })}
                  onFocus={setActive}
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
              </p>
              <Options editor={editor} onChange={setEditor} />
            </>
          )}
        </main>
        <aside className="flex w-96 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border p-3">
          {inspire !== undefined ? <Inspiration postId={inspire} /> : null}
          {isArticle ? null : (
            <>
              <PostPreview blocks={blocks} name={handle ?? "You"} handle={handle} />
              <AssistPanel
                blocks={blocks}
                active={active}
                onReplaceBlock={(i, text) =>
                  setEditor({ ...editor, blocks: blocks.map((b, j) => (j === i ? text : b)) })
                }
                onInsertAfter={(i, texts) =>
                  setEditor({
                    ...editor,
                    blocks: [...blocks.slice(0, i + 1), ...texts, ...blocks.slice(i + 1)],
                  })
                }
                onReplaceAll={(b) => setEditor({ ...editor, blocks: b.flatMap(splitBlocks) })}
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
  }),
  component: ComposeScreen,
});
