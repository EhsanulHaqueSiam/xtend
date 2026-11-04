import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  ARTICLE_LIMITS,
  ARTICLE_TITLE_RECOMMENDED,
  type ArticleAssistMode,
  type ArticleBlock,
  articleBlocker,
  articleWords,
  charCount,
  type Draft,
  type DraftMedia,
  isTextBlock,
  joinInline,
  MEDIA_MAX_BYTES,
  parseArticle,
  readInline,
  type ReplySettings,
  serializeArticle,
  sliceInline,
  toReaderBlocks,
  writeInline,
} from "@xtend/contracts";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import {
  Bold,
  ChevronDown,
  Code,
  Expand,
  Info,
  Italic,
  Link2,
  List,
  ListOrdered,
  MessageSquareQuote,
  Minus,
  MoreHorizontal,
  Quote,
  Shrink,
  Sigma,
  Sparkles,
  Strikethrough,
  Table,
  X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { isElectron } from "../../env";
import { fmtWhen, localInputToInstant } from "../../lib/time";
import { cn, readableError, toBase64 } from "../../lib/utils";
import {
  articlesAccessAtom,
  assistArticleAtom,
  composeContextAtom,
  composeQuoteAtom,
  createDraftAtom,
  deleteDraftAtom,
  draftsAtom,
  generateCoverAtom,
  mediaAddAtom,
  mediaRemoveAtom,
  publishArticleAtom,
  updateDraftAtom,
} from "../../state/compose";
import { useQuoteLabel } from "../../state/costs";
import { queueAtom, scheduleAtom, unscheduleAtom } from "../../state/plan";
import { settingsAtom, useSessionLane } from "../../state/settings";
import { failText } from "../compose/AssistPanel";
import { TimeField } from "../ui/field";
import { Cost } from "../ui/layout";
import { Menu, MenuItem } from "../ui/menu";
import { Popover } from "../ui/popover";
import { XLink } from "../ui/x-link";
import { ArticleBody } from "../xnative/ArticleBody";
import { XColumn } from "../xnative/XColumn";
import { ArticleBlocks, selectionIn, type TextHandlers, type TextKind } from "./ArticleBlocks";

/** X's Who can reply? in its Publish dialog, in X's words, by Xtend's setting. */
const REPLIES: ReadonlyArray<readonly [ReplySettings, string]> = [
  ["everyone", "Everyone"],
  ["following", "Accounts you follow"],
  ["verified", "Verified accounts"],
  ["mentionedUsers", "Only accounts you mention"],
];

/** X's Insert menu, in X's order, less what X's own pickers do (Media, GIFs, Link preview). */
const INSERTS: ReadonlyArray<readonly [string, () => ArticleBlock, typeof Code]> = [
  ["Posts", () => ({ kind: "post", url: "" }), MessageSquareQuote],
  ["Markdown", () => ({ kind: "markdown", text: "" }), Code],
  ["Divider", () => ({ kind: "divider" }), Minus],
  ["Code", () => ({ kind: "code", lang: "", text: "" }), Code],
  ["LaTeX", () => ({ kind: "latex", text: "" }), Sigma],
  [
    "Table",
    () => ({ kind: "markdown", text: "| Column | Column |\n| --- | --- |\n|  |  |" }),
    Table,
  ],
];

/** X's keyboard shortcuts, as its editor's info button lists them (bundle.TwitterArticles). */
const MOD = /Mac/.test(navigator.platform) ? "⌘" : "CTRL";
const SHORTCUTS: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string]>]> = [
  [
    "Keyboard shortcuts",
    [
      [`${MOD} B`, "Bold"],
      [`${MOD} I`, "Italicize"],
      [`${MOD} shift X`, "Strikethrough"],
      [`${MOD} K`, "Insert link"],
      [`${MOD} shift 7`, "Bulleted list"],
      [`${MOD} shift 8`, "Numbered list"],
      [`${MOD} shift 9`, "Quote block"],
      [`${MOD} shift .`, "Increase text size"],
      [`${MOD} shift ,`, "Decrease text size"],
    ],
  ],
  [
    "In-Text Shortcuts",
    [
      ["#", "Heading"],
      ["##", "Subheading"],
      ["- + *", "Bulleted list"],
      ["1. 2)", "Numbered list"],
      ["> >>", "Quote block"],
    ],
  ],
];

/** X's own upgrade page, as its Premium hub's "Publish Articles" card opens it. */
export const UPGRADE_URL =
  "https://x.com/i/premium_sign_up?referring_page=level_up_content_benefits";

const URL_ERROR =
  "Something’s incorrect with this URL. Please check the spelling and formatting of this link.";
const iconButton =
  "grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-[#1d9bf0] transition-colors duration-150 hover:bg-[#1d9bf0]/10 disabled:cursor-default disabled:opacity-50 aria-pressed:bg-[#1d9bf0]/15 [&_svg]:size-[18px]";
/** The toolbar's buttons, a size down, so X's whole toolbar fits X's 600px column. */
const toolButton = iconButton.replace("size-9", "size-8");
const pill =
  "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-4 text-[15px] font-bold transition-colors duration-150 disabled:cursor-default disabled:opacity-50";
const railGroup = "flex flex-col border-t border-white/[0.12] pt-3 first:border-t-0 first:pt-0";
const railLabel = "pb-2 text-[12px] font-semibold tracking-[0.08em] text-[#71767b] uppercase";

interface Selected {
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly top: number;
  readonly left: number;
}

interface Suggestions {
  readonly mode: ArticleAssistMode;
  readonly options: ReadonlyArray<string>;
  /** The passage Rewrite and Tighten answered for. */
  readonly target: Selected | null;
}

/** A way out of the editor: what it does, what it costs, and why it cannot run now. */
interface Way {
  readonly id: "publish" | "queue" | "schedule";
  readonly label: string;
  readonly detail: string;
  readonly cost: ReactNode;
  readonly blocked: string | null;
}

/**
 * X's Article editor, drawn by Xtend in X's 600px column: X's toolbar, cover, title and body, and
 * Xtend's rail beside it with the ways out and their prices, X's limits, assist and the other
 * drafts. The draft is Xtend's (`Draft.kind` "article"); nothing reaches X until a way out runs.
 * Publish now goes through X's own editor for the click, free; Queue and Schedule through the X API.
 */
export function ArticleEditor({
  draftId,
  onOpen,
  onBack,
}: {
  /** The draft to open, or undefined for a new one. */
  readonly draftId: string | undefined;
  readonly onOpen: (draftId: string) => void;
  readonly onBack: () => void;
}) {
  const drafts = useAtomValue(draftsAtom);
  const refresh = useAtomRefresh(draftsAtom);
  const listed = AsyncResult.getOrElse(drafts, (): ReadonlyArray<Draft> => []);
  const found = draftId === undefined ? null : (listed.find((d) => d.id === draftId) ?? null);
  if (draftId !== undefined && found === null)
    return (
      <XColumn header={<Bar onBack={onBack} status={null} saving={false} />}>
        <p className="px-4 py-10 text-center text-[15px] text-[#71767b]">
          {AsyncResult.isSuccess(drafts) ? "This draft no longer exists." : "Loading draft"}
        </p>
      </XColumn>
    );
  return (
    <Editor
      key={draftId ?? "new"}
      initial={found}
      others={listed.filter((d) => d.kind === "article" && d.id !== draftId)}
      onOpen={onOpen}
      onBack={onBack}
      refresh={refresh}
    />
  );
}

/** The column's top bar: back, the draft's state, then the screen's own controls. */
function Bar({
  onBack,
  status,
  saving,
  children,
}: {
  readonly onBack: () => void;
  readonly status: Draft["status"] | null;
  readonly saving: boolean;
  readonly children?: ReactNode;
}) {
  const label =
    status === "posted"
      ? "Published"
      : status === "queued"
        ? "Queued"
        : status === "failed"
          ? "Failed"
          : "Draft";
  return (
    <div className="flex min-h-[53px] items-center gap-3 px-4">
      <button
        type="button"
        aria-label="Back"
        className="no-drag -m-2 grid size-9 shrink-0 cursor-pointer place-items-center rounded-full transition-colors duration-150 hover:bg-white/10"
        onClick={onBack}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M19 12H5M11 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <span
        className={cn(
          "rounded-md px-1.5 text-[13px] font-semibold",
          status === "posted"
            ? "bg-[#00ba7c]/20 text-[#00ba7c]"
            : status === "failed"
              ? "bg-error/20 text-error-foreground"
              : "bg-[#7856ff]/25 text-[#c5b8ff]",
        )}
      >
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate text-[15px] text-[#71767b]">
        {status === null ? "" : saving ? "Saving..." : "Saved"}
      </span>
      <div className="no-drag flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

function Editor({
  initial,
  others,
  onOpen,
  onBack,
  refresh,
}: {
  readonly initial: Draft | null;
  readonly others: ReadonlyArray<Draft>;
  readonly onOpen: (draftId: string) => void;
  readonly onBack: () => void;
  readonly refresh: () => void;
}) {
  const create = useAtomSet(createDraftAtom, { mode: "promise" });
  const update = useAtomSet(updateDraftAtom, { mode: "promise" });
  const remove = useAtomSet(deleteDraftAtom, { mode: "promiseExit" });
  const mediaAdd = useAtomSet(mediaAddAtom, { mode: "promiseExit" });
  const mediaRemove = useAtomSet(mediaRemoveAtom, { mode: "promiseExit" });
  const generateCover = useAtomSet(generateCoverAtom, { mode: "promiseExit" });
  const publish = useAtomSet(publishArticleAtom, { mode: "promiseExit" });
  const queue = useAtomSet(queueAtom, { mode: "promiseExit" });
  const schedule = useAtomSet(scheduleAtom, { mode: "promiseExit" });
  const unschedule = useAtomSet(unscheduleAtom, { mode: "promiseExit" });
  const assist = useAtomSet(assistArticleAtom, { mode: "promiseExit" });
  const quote = AsyncResult.getOrElse(useAtomValue(composeQuoteAtom), () => null);
  const context = AsyncResult.getOrElse(useAtomValue(composeContextAtom), () => null);
  const settings = AsyncResult.getOrElse(useAtomValue(settingsAtom), () => null);
  const sessionLane = useSessionLane();
  const assistLabel = useQuoteLabel({ kind: "assist" });
  // What X's Articles page last told the engine: false is X's "Page not found", no Premium.
  const access = useAtomValue(articlesAccessAtom);

  const [draft, setDraft] = useState<Draft | null>(initial);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [blocks, setBlocks] = useState<ReadonlyArray<ArticleBlock>>(() => {
    const parsed = parseArticle(initial?.body ?? "");
    return parsed.length === 0 ? [{ kind: "body", text: "" }] : parsed;
  });
  const [replySettings, setReplySettings] = useState<ReplySettings>(
    initial?.replySettings ?? "everyone",
  );
  const [media, setMedia] = useState<ReadonlyArray<DraftMedia>>(initial?.media ?? []);
  const [preview, setPreview] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ readonly index: number; readonly at: number } | null>(null);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [caption, setCaption] = useState("");
  const [step, setStep] = useState<"menu" | "publish" | "schedule" | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [coverPrompt, setCoverPrompt] = useState("");
  const [coverOpen, setCoverOpen] = useState(false);
  const [when, setWhen] = useState("");

  const body = serializeArticle(
    blocks.filter((b) => !isTextBlock(b) || b.text.trim() !== "" || blocks.length === 1),
  );
  const status = draft?.status ?? "draft";
  const locked = status === "posted" || status === "posting";
  const cover = media.find((m) => m.blockIndex === 0 && m.kind === "image");

  // Autosave: one row per editor, created on the first change that says something; one save at a
  // time, and a save asked for during one runs after it with what changed meanwhile.
  const latest = useRef({ title, body, replySettings });
  const savedAs = useRef(
    JSON.stringify({
      title: initial?.title ?? "",
      body: initial?.body ?? "",
      replySettings: initial?.replySettings ?? "everyone",
    }),
  );
  const row = useRef<Draft | null>(initial);
  const inFlight = useRef<Promise<Draft | null> | null>(null);
  const save = async (force = false): Promise<Draft | null> => {
    while (inFlight.current !== null) await inFlight.current.catch(() => null);
    const now = latest.current;
    const json = JSON.stringify(now);
    if (json === savedAs.current && (row.current !== null || !force)) return row.current;
    if (row.current === null && now.title.trim() === "" && now.body.trim() === "" && !force)
      return null;
    const patch = { kind: "article" as const, ...now };
    const run = (async () => {
      setSaving(true);
      try {
        const d =
          row.current === null ? await create(patch) : await update({ id: row.current.id, patch });
        savedAs.current = json;
        row.current = d;
        setDraft(d);
        refresh();
        return d;
      } finally {
        setSaving(false);
      }
    })();
    inFlight.current = run;
    try {
      return await run;
    } finally {
      if (inFlight.current === run) inFlight.current = null;
    }
  };
  const flush = useRef(save);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- keeps the fields and the save the debounce and the unmount flush below read.
  useEffect(() => {
    latest.current = { title, body, replySettings };
    flush.current = save;
  });
  const focused = useCallback(() => setFocus(null), []);
  const report = (e: unknown) => {
    setNotice(`Failed: ${readableError(e)}`);
    return null;
  };
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- debounced autosave of the editor's fields to the service.
  useEffect(() => {
    if (locked) return;
    const t = setTimeout(
      () => void flush.current().catch((e: unknown) => setNotice(`Failed: ${readableError(e)}`)),
      600,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react/exhaustive-effect-dependencies -- debounced on the fields; the save reads them through `latest`.
  }, [title, body, replySettings, locked]);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- saves the last keystrokes to the service when the editor closes.
  useEffect(() => () => void flush.current().catch(() => {}), []);

  // The selection bubble follows the browser's selection inside the body.
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- follows the document's selection for the bubble over selected text.
  useEffect(() => {
    const onChange = () => {
      const sel = getSelection();
      const el =
        sel?.anchorNode instanceof Node
          ? (sel.anchorNode instanceof HTMLElement
              ? sel.anchorNode
              : sel.anchorNode.parentElement
            )?.closest<HTMLElement>("[data-block]")
          : null;
      const range = el === null || el === undefined ? null : selectionIn(el);
      if (el === null || el === undefined || range === null || range.start === range.end)
        return setSelected(null);
      const rect = sel!.getRangeAt(0).getBoundingClientRect();
      setSelected({
        index: Number(el.dataset.block),
        ...range,
        top: rect.top,
        left: rect.left + rect.width / 2,
      });
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);

  const setBlock = (i: number, next: ArticleBlock) =>
    setBlocks((bs) => bs.map((b, j) => (j === i ? next : b)));
  const handlersFor = (i: number): TextHandlers => ({
    onChange: (text) =>
      setBlocks((bs) => bs.map((b, j) => (j === i && isTextBlock(b) ? { ...b, text } : b))),
    onKind: (kind, text) => {
      setBlock(i, { kind, text });
      setFocus({ index: i, at: [...readInline(text).text].length });
    },
    onSplit: (before, after) => {
      setBlocks((bs) => {
        const b = bs[i];
        if (b === undefined || !isTextBlock(b)) return bs;
        // Enter on an empty list item or quote ends it, as in X; a heading's next line is Body.
        const ends =
          (b.kind === "bullet" || b.kind === "number" || b.kind === "quote") &&
          before === "" &&
          after === "";
        if (ends) return bs.map((x, j) => (j === i ? { kind: "body", text: "" } : x));
        const next: TextKind =
          b.kind === "bullet" || b.kind === "number" || b.kind === "quote" ? b.kind : "body";
        return [
          ...bs.slice(0, i),
          { ...b, text: before },
          { kind: next, text: after },
          ...bs.slice(i + 1),
        ];
      });
      setFocus({ index: i + 1, at: 0 });
    },
    onJoin: (text) => {
      const above = blocks[i - 1];
      if (i === 0 || above === undefined) return;
      if (!isTextBlock(above)) {
        // An atomic block above is X's own "Delete block" away; an empty line just goes.
        if (text === "") setBlocks((bs) => bs.filter((_, j) => j !== i));
        return;
      }
      const at = [...readInline(above.text).text].length;
      const joined = writeInline(joinInline(readInline(above.text), readInline(text)));
      setBlocks((bs) => [...bs.slice(0, i - 1), { ...above, text: joined }, ...bs.slice(i + 1)]);
      setFocus({ index: i - 1, at });
    },
    onLink: () => setLinkOpen(true),
    onFocus: () => setActive(i),
  });
  const restyle = (kind: TextKind) => {
    const b = blocks[active];
    if (b === undefined || !isTextBlock(b)) return;
    setBlock(active, { kind: b.kind === kind && kind !== "body" ? "body" : kind, text: b.text });
  };
  const insert = (block: ArticleBlock) => {
    setBlocks((bs) => [...bs.slice(0, active + 1), block, ...bs.slice(active + 1)]);
    setActive(active + 1);
  };
  const activeBlock = blocks[active];
  const activeKind =
    activeBlock !== undefined && isTextBlock(activeBlock) ? activeBlock.kind : null;

  const addCover = async (file: File) => {
    if (file.size > MEDIA_MAX_BYTES)
      return setNotice(`Failed: ${file.name} is over ${MEDIA_MAX_BYTES / 1024 / 1024} MB`);
    const d = await save(true).catch(report);
    if (d === null) return;
    const exit = await mediaAdd({
      draftId: d.id,
      blockIndex: 0,
      kind: "image",
      name: file.name,
      base64: await toBase64(file),
    });
    if (Exit.isFailure(exit)) return setNotice(`Failed: ${failText(exit.cause)}`);
    setMedia(exit.value.media);
    setPreview(URL.createObjectURL(file));
    refresh();
  };
  const dropCover = async () => {
    if (draft === null || cover === undefined) return;
    const exit = await mediaRemove({ draftId: draft.id, id: cover.id });
    if (Exit.isFailure(exit)) return setNotice(`Failed: ${failText(exit.cause)}`);
    setMedia(exit.value.media);
    setPreview(null);
    refresh();
  };
  const makeCover = async () => {
    setBusy("cover");
    try {
      const d = await save(true).catch(report);
      if (d === null) return;
      const exit = await generateCover({ draftId: d.id, prompt: coverPrompt });
      if (Exit.isFailure(exit)) return setNotice(`Failed: ${failText(exit.cause)}`);
      setMedia(exit.value.media);
      setCoverOpen(false);
    } finally {
      setBusy(null);
    }
  };

  const ask = async (mode: ArticleAssistMode) => {
    const target = mode === "rewrite" || mode === "tighten" ? selected : null;
    const block = target === null ? undefined : blocks[target.index];
    const text =
      block !== undefined && isTextBlock(block)
        ? sliceInline(readInline(block.text), target!.start, target!.end).text
        : undefined;
    if ((mode === "rewrite" || mode === "tighten") && text === undefined)
      return setNotice("Select a passage first");
    setBusy(mode);
    setNotice(null);
    try {
      const exit = await assist({ mode, title, body, text });
      if (Exit.isFailure(exit)) return setNotice(`Failed: ${failText(exit.cause)}`);
      setSuggestions({ mode, options: exit.value.options, target });
    } finally {
      setBusy(null);
    }
  };
  /** Applies an option to the editor as it is now: a passage replaced in place, a title, a caption. */
  const use = (s: Suggestions, option: string) => {
    if (s.mode === "titles") setTitle(option.slice(0, ARTICLE_LIMITS.title));
    else if (s.mode === "sharePost") setCaption(option);
    else if (s.target !== null) {
      const t = s.target;
      setBlocks((bs) =>
        bs.map((b, j) => {
          if (j !== t.index || !isTextBlock(b)) return b;
          const inline = readInline(b.text);
          return {
            ...b,
            text: writeInline(
              joinInline(
                sliceInline(inline, 0, t.start),
                readInline(option),
                sliceInline(inline, t.end),
              ),
            ),
          };
        }),
      );
    }
    setSuggestions(null);
  };

  const run = async (way: Way["id"]) => {
    if (busy !== null) return;
    setBusy(way);
    setNotice(null);
    try {
      const d = await save(true).catch(report);
      if (d === null) return;
      if (way === "schedule") {
        const at = localInputToInstant(
          settings?.timeZone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone,
          when,
        );
        if (at === null || at.getTime() <= Date.now())
          return setNotice("Failed: that time has passed");
        const exit = await schedule({ id: d.id, at: at.toISOString() });
        if (Exit.isFailure(exit)) return setNotice(`Failed: ${failText(exit.cause)}`);
        setDraft(exit.value);
      } else {
        const exit = way === "queue" ? await queue(d.id) : await publish({ id: d.id, caption });
        if (Exit.isFailure(exit)) return setNotice(`Failed: ${failText(exit.cause)}`);
        setDraft(exit.value);
        row.current = exit.value;
        if (exit.value.status === "failed") setNotice(`Failed: ${exit.value.error}`);
        else if (exit.value.status === "posted")
          setNotice("Success! Your Article has been published");
      }
      setStep(null);
      refresh();
    } finally {
      setBusy(null);
    }
  };

  const blocker = articleBlocker(title, body);
  const atomic = blocks.some((b) => !isTextBlock(b));
  const apiUsd = quote === null ? null : quote.articleUsd * 2;
  // Why each way out cannot run now; null when it can. Publish now goes through X's own editor.
  const ways: ReadonlyArray<Way> = [
    {
      id: "publish",
      label: "Publish now",
      detail: "Opens X's Publish dialog",
      cost: <Cost label="free" />,
      blocked: !isElectron
        ? "Publish now needs X's editor, which runs in the desktop app"
        : !sessionLane
          ? "Session actions are off in Settings, X session"
          : access === false
            ? "X shows Articles only with Premium: Upgrade to unlock"
            : (blocker ??
              (atomic
                ? "Code, Markdown, LaTeX, dividers and posts go out with Queue or Schedule: X's editor takes them only from its own Insert menu"
                : null)),
    },
    {
      id: "queue",
      label: "Queue",
      detail:
        context?.nextSlot == null
          ? "Next free slot · X API"
          : `Next slot, ${fmtWhen(context.nextSlot)} · X API`,
      cost: apiUsd === null ? <Cost label="…" /> : <Cost usd={apiUsd} />,
      blocked: blocker ?? apiBlock(cover, replySettings, apiUsd),
    },
    {
      id: "schedule",
      label: "Schedule",
      detail: "Pick a time · X API",
      cost: apiUsd === null ? <Cost label="…" /> : <Cost usd={apiUsd} />,
      blocked: blocker ?? apiBlock(cover, replySettings, apiUsd),
    },
  ];
  const titleCount = charCount(title);
  // The rest of the article drafts; a new draft joins the list once it is saved, and is this one.
  const rest = others.filter((d) => d.id !== draft?.id);
  const words = articleWords(body);

  const header = (
    <>
      <Bar
        onBack={() => void save().then(onBack, report)}
        status={draft === null ? null : status}
        saving={saving}
      >
        <button
          type="button"
          className={cn(pill, "text-[#1d9bf0] hover:bg-[#1d9bf0]/10")}
          aria-pressed={showPreview}
          onClick={() => setShowPreview((p) => !p)}
        >
          {showPreview ? "Edit" : "Preview"}
        </button>
        {locked ? null : (
          <PublishMenu
            ways={ways}
            step={step}
            setStep={setStep}
            busy={busy}
            run={(w) => void run(w)}
            replySettings={replySettings}
            setReplySettings={setReplySettings}
            caption={caption}
            setCaption={setCaption}
            when={when}
            setWhen={setWhen}
            zone={settings?.timeZone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone}
          />
        )}
        <button
          type="button"
          aria-label="Focus mode"
          aria-pressed={focusMode}
          className={cn(iconButton, "text-foreground hover:bg-white/10")}
          onClick={() => setFocusMode((f) => !f)}
        >
          {focusMode ? <Shrink /> : <Expand />}
        </button>
        <Menu
          align="end"
          label="More"
          trigger={
            <button
              type="button"
              aria-label="More"
              className={cn(iconButton, "text-foreground hover:bg-white/10")}
            >
              <MoreHorizontal />
            </button>
          }
        >
          <MenuItem onClick={() => setShowPreview(true)}>Preview your draft</MenuItem>
          <MenuItem onClick={() => setFocusMode(true)}>Edit in focus mode</MenuItem>
          {draft === null || locked ? null : (
            <MenuItem
              onClick={() =>
                void remove(draft.id).then((exit) => {
                  if (Exit.isFailure(exit)) return setNotice(`Failed: ${failText(exit.cause)}`);
                  refresh();
                  onBack();
                })
              }
            >
              Delete draft
            </MenuItem>
          )}
        </Menu>
      </Bar>
      {locked || showPreview ? null : (
        <Toolbar
          activeKind={activeKind}
          words={words}
          restyle={restyle}
          insert={insert}
          linkOpen={linkOpen}
          setLinkOpen={setLinkOpen}
        />
      )}
    </>
  );

  const editor = (
    <div className={cn(locked && "pointer-events-none opacity-80")}>
      <Cover
        cover={cover}
        preview={preview}
        locked={locked}
        busy={busy === "cover"}
        prompt={coverPrompt}
        setPrompt={setCoverPrompt}
        open={coverOpen}
        setOpen={setCoverOpen}
        coverUsd={quote?.coverUsd ?? null}
        onFile={(f) => void addCover(f)}
        onRemove={() => void dropCover()}
        onGenerate={() => void makeCover()}
      />
      <textarea
        aria-label="Article Title"
        placeholder="Add a title"
        maxLength={ARTICLE_LIMITS.title}
        rows={1}
        readOnly={locked}
        className="w-full resize-none bg-transparent px-4 pt-6 pb-2 text-[31px] leading-9 font-extrabold outline-hidden field-sizing-content placeholder:text-[#71767b]"
        value={title}
        onChange={(e) => setTitle(e.target.value.replace(/[\r\n]+/g, " "))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            setFocus({ index: 0, at: 0 });
          }
        }}
      />
      {settings?.handle == null ? null : (
        <p className="px-4 text-[15px] text-[#71767b]">@{settings.handle}</p>
      )}
      {showPreview ? (
        <ArticleBody blocks={toReaderBlocks(body)} />
      ) : (
        <ArticleBlocks
          blocks={blocks}
          focus={focus}
          onFocused={focused}
          handlersFor={handlersFor}
          onAtomic={(i, b) => setBlock(i, b)}
          onRemove={(i) =>
            setBlocks((bs) =>
              bs.length === 1 ? [{ kind: "body", text: "" }] : bs.filter((_, j) => j !== i),
            )
          }
        />
      )}
    </div>
  );

  return (
    <XColumn
      header={header}
      rail={
        focusMode ? undefined : (
          <div className="flex flex-col gap-4 rounded-2xl border border-white/[0.12] p-4">
            <section className={railGroup} aria-label="Go out">
              <h2 className={railLabel}>Go out</h2>
              {status === "queued" && draft !== null ? (
                <div className="flex items-center justify-between gap-3 py-1.5">
                  <div className="min-w-0">
                    <p className="text-[15px] font-bold">Queued</p>
                    <p className="truncate text-[13px] text-[#71767b]">
                      {draft.scheduledAt === null ? "Next slot" : fmtWhen(draft.scheduledAt)} · X
                      API
                    </p>
                  </div>
                  <button
                    type="button"
                    className={cn(pill, "border border-white/[0.24] hover:bg-white/[0.06]")}
                    disabled={busy !== null}
                    onClick={() =>
                      void unschedule(draft.id).then((exit) => {
                        if (Exit.isFailure(exit))
                          return setNotice(`Failed: ${failText(exit.cause)}`);
                        setDraft(exit.value);
                        refresh();
                      })
                    }
                  >
                    Unschedule
                  </button>
                </div>
              ) : locked ? (
                <p className="py-1.5 text-[15px]">
                  {status === "posted" && draft?.postIds[0] !== undefined ? (
                    <XLink
                      href={`https://x.com/i/web/status/${draft.postIds[0]}`}
                      className="text-[#1d9bf0] hover:underline"
                    >
                      View Article
                    </XLink>
                  ) : (
                    "Publishing"
                  )}
                </p>
              ) : (
                ways.map((w) => (
                  <div
                    key={w.id}
                    className="flex items-center justify-between gap-3 border-b border-white/[0.08] py-2 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="text-[15px] font-bold">{w.label}</p>
                      <p className="text-[13px] text-[#71767b]">
                        {w.blocked ??
                          (w.id === "publish" ? "X's Publish, for your click" : w.detail)}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={w.label}
                      disabled={w.blocked !== null || busy !== null}
                      className={cn(
                        pill,
                        w.id === "publish"
                          ? "bg-foreground text-background"
                          : "border border-white/[0.24] hover:bg-white/[0.06]",
                      )}
                      onClick={() => (w.id === "queue" ? void run("queue") : setStep(w.id))}
                    >
                      {w.label === "Publish now" ? "Publish" : w.label}
                      {w.cost}
                    </button>
                  </div>
                ))
              )}
              {access === false ? (
                <XLink
                  href={UPGRADE_URL}
                  className="pt-1 text-[13px] font-bold text-[#1d9bf0] hover:underline"
                >
                  Upgrade to unlock
                </XLink>
              ) : null}
              {notice === null ? null : (
                <p
                  role="status"
                  className={cn(
                    "pt-1 text-[13px]",
                    notice.startsWith("Failed") ? "text-error-foreground" : "text-[#00ba7c]",
                  )}
                >
                  {notice}
                </p>
              )}
            </section>
            <section className={railGroup} aria-label="Checks">
              <h2 className={cn(railLabel, "flex justify-between")}>
                Checks <span className="normal-case tracking-normal">X's limits</span>
              </h2>
              <dl className="flex flex-col gap-1.5 text-[15px]">
                <Check
                  label="Title"
                  tone={
                    titleCount > ARTICLE_LIMITS.title
                      ? "bad"
                      : titleCount >= ARTICLE_TITLE_RECOMMENDED[0] &&
                          titleCount <= ARTICLE_TITLE_RECOMMENDED[1]
                        ? "good"
                        : undefined
                  }
                >
                  {titleCount} chars · {ARTICLE_TITLE_RECOMMENDED[0]} to{" "}
                  {ARTICLE_TITLE_RECOMMENDED[1]}
                </Check>
                <Check
                  label="Body"
                  tone={blocker?.includes("character limit") === true ? "bad" : undefined}
                >
                  {words.toLocaleString("en")} words
                </Check>
                <Check label="Cover">
                  {cover === undefined ? "none · 5:2 recommended" : "set"}
                </Check>
              </dl>
              {blocker === null ? null : (
                <p className="pt-2 text-[13px] text-warning-foreground">{blocker}</p>
              )}
            </section>
            <section className={railGroup} aria-label="Assist">
              <h2 className={cn(railLabel, "flex justify-between")}>
                Assist <span className="normal-case tracking-normal">your login</span>
              </h2>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["rewrite", "Rewrite"],
                    ["titles", "Titles"],
                    ["sharePost", "Share post"],
                    ["tighten", "Tighten"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={busy !== null || assistLabel === "…" || locked}
                    className={cn(
                      pill,
                      "h-9 border border-white/[0.24] text-[14px] font-medium hover:bg-white/[0.06]",
                    )}
                    onClick={() => void ask(mode)}
                  >
                    {busy === mode ? `${label}…` : label}
                    <Cost label={assistLabel} />
                  </button>
                ))}
              </div>
              {suggestions === null ? null : (
                <ul className="mt-2 flex flex-col" aria-label="Suggestions">
                  {suggestions.options.map((o) => (
                    <li
                      key={o}
                      className="flex items-center gap-3 border-b border-white/[0.08] py-2 last:border-b-0"
                    >
                      <span className="min-w-0 flex-1 text-[15px]">
                        {o}
                        <span className="block text-[13px] text-[#71767b]">
                          {charCount(o)} chars
                        </span>
                      </span>
                      <button
                        type="button"
                        className="cursor-pointer text-[15px] font-bold text-[#1d9bf0]"
                        onClick={() => use(suggestions, o)}
                      >
                        Use
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {suggestions?.mode === "sharePost" || caption !== "" ? (
                <p className="pt-2 text-[13px] text-[#71767b]">
                  Caption for Publish now: {caption === "" ? "none" : caption}
                </p>
              ) : null}
            </section>
            <section className={railGroup} aria-label="Drafts">
              <h2 className={railLabel}>Drafts · {rest.length}</h2>
              {rest.slice(0, 5).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="flex cursor-pointer items-center justify-between gap-3 border-b border-white/[0.08] py-2 text-left last:border-b-0 hover:bg-white/[0.03]"
                  onClick={() => void save().then(() => onOpen(d.id), report)}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-bold">
                      {d.title.trim() === "" ? "(Needs title)" : d.title}
                    </span>
                    <span className="block text-[13px] text-[#71767b]">
                      {d.status === "queued"
                        ? `Queued · ${d.scheduledAt === null ? "next slot" : fmtWhen(d.scheduledAt)}`
                        : d.status === "posted"
                          ? "Published"
                          : `Saved ${fmtWhen(d.updatedAt)}`}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[13px] text-[#71767b]">
                    {articleWords(d.body).toLocaleString("en")} w
                  </span>
                </button>
              ))}
            </section>
          </div>
        )
      }
    >
      {editor}
      {selected === null || locked || showPreview ? null : (
        <Bubble
          at={selected}
          price={assistLabel}
          busy={busy !== null}
          onStyle={(command) => document.execCommand(command)}
          onLink={() => setLinkOpen(true)}
          onRewrite={() => void ask("rewrite")}
        />
      )}
    </XColumn>
  );
}

const apiBlock = (cover: DraftMedia | undefined, replies: ReplySettings, usd: number | null) =>
  cover !== undefined
    ? "A cover goes out only with Publish now: the X API lane cannot upload media yet"
    : replies !== "everyone"
      ? "Through the X API everyone can reply: Publish now sets who can reply"
      : usd === null
        ? "Waiting for the price"
        : null;

function Check({
  label,
  tone,
  children,
}: {
  readonly label: string;
  readonly tone?: "good" | "bad" | undefined;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[#71767b]">{label}</dt>
      <dd
        className={cn(
          "font-mono text-[14px] tabular-nums",
          tone === "good" && "text-[#00ba7c]",
          tone === "bad" && "text-error-foreground",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/** X's toolbar: its styles, lists, quote and link, its Insert menu, shortcuts and word count. */
function Toolbar({
  activeKind,
  words,
  restyle,
  insert,
  linkOpen,
  setLinkOpen,
}: {
  readonly activeKind: TextKind | null;
  readonly words: number;
  readonly restyle: (kind: TextKind) => void;
  readonly insert: (block: ArticleBlock) => void;
  readonly linkOpen: boolean;
  readonly setLinkOpen: (open: boolean) => void;
}) {
  const [url, setUrl] = useState("");
  const [keysOpen, setKeysOpen] = useState(false);
  const bad = url.trim() !== "" && !/^https?:\/\/[^\s.]+\.[^\s]+$/.test(url.trim());
  // Pressed with the mouse down, so the body keeps its selection for the command.
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();
  const style = (command: string, label: string, Icon: typeof Bold) => (
    <button
      type="button"
      aria-label={label}
      className={toolButton}
      onMouseDown={keep}
      onClick={() => document.execCommand(command)}
    >
      <Icon />
    </button>
  );
  const kindButton = (kind: TextKind, label: string, Icon: typeof Bold) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={activeKind === kind}
      disabled={activeKind === null}
      className={toolButton}
      onMouseDown={keep}
      onClick={() => restyle(kind)}
    >
      <Icon />
    </button>
  );
  const sizes: ReadonlyArray<readonly [TextKind, string]> = [
    ["body", "Body"],
    ["heading", "Heading"],
    ["subheading", "Subheading"],
  ];
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="no-drag flex items-center gap-0.5 overflow-x-auto border-t border-white/[0.12] px-2 py-1 [scrollbar-width:none]"
    >
      {style("bold", "Bold", Bold)}
      {style("italic", "Italicize", Italic)}
      {style("strikeThrough", "Strikethrough", Strikethrough)}
      <Menu
        label="Text style"
        trigger={
          <button
            type="button"
            disabled={activeKind === null}
            onMouseDown={keep}
            className="mx-1 flex h-9 w-28 shrink-0 cursor-pointer items-center justify-between rounded-full px-3 text-[15px] hover:bg-white/10 disabled:opacity-50"
          >
            {
              sizes.find(
                ([k]) =>
                  k ===
                  (activeKind === "heading" || activeKind === "subheading" ? activeKind : "body"),
              )?.[1]
            }
            <ChevronDown className="size-4" />
          </button>
        }
      >
        {sizes.map(([kind, label]) => (
          <MenuItem key={kind} onClick={() => restyle(kind)}>
            {label}
          </MenuItem>
        ))}
      </Menu>
      {kindButton("quote", "Quote block", Quote)}
      {kindButton("bullet", "Bulleted list", List)}
      {kindButton("number", "Numbered list", ListOrdered)}
      <Popover
        open={linkOpen}
        onOpenChange={(open) => {
          setLinkOpen(open);
          if (!open) setUrl("");
        }}
        align="start"
        trigger={
          <button type="button" aria-label="Insert link" className={toolButton} onMouseDown={keep}>
            <Link2 />
          </button>
        }
      >
        <p className="pb-2 text-[15px] font-bold">Insert link</p>
        <input
          aria-label="URL"
          placeholder="URL"
          className="h-9 w-full rounded-md border border-white/[0.24] bg-transparent px-2 text-[15px] outline-hidden focus:border-[#1d9bf0]"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        {bad ? <p className="pt-1 text-[13px] text-error-foreground">{URL_ERROR}</p> : null}
        <div className="flex justify-end pt-2">
          <button
            type="button"
            disabled={url.trim() === "" || bad}
            className={cn(pill, "bg-foreground text-background")}
            onMouseDown={keep}
            onClick={() => {
              document.execCommand("createLink", false, url.trim());
              setLinkOpen(false);
              setUrl("");
            }}
          >
            Insert
          </button>
        </div>
      </Popover>
      <Menu
        label="Insert"
        trigger={
          <button
            type="button"
            className="ml-1 flex h-9 shrink-0 cursor-pointer items-center gap-1 rounded-full px-3 text-[15px] hover:bg-white/10"
          >
            Insert <ChevronDown className="size-4" />
          </button>
        }
      >
        {INSERTS.map(([label, make, Icon]) => (
          <MenuItem key={label} onClick={() => insert(make())}>
            <Icon className="size-4" />
            {label}
          </MenuItem>
        ))}
      </Menu>
      <Popover
        open={keysOpen}
        onOpenChange={setKeysOpen}
        align="start"
        trigger={
          <button type="button" aria-label="Keyboard shortcuts" className={toolButton}>
            <Info />
          </button>
        }
      >
        <ShortcutList />
      </Popover>
      <span className="ml-auto shrink-0 pr-1 font-mono text-[13px] text-[#71767b] tabular-nums">
        {words.toLocaleString("en")} words
      </span>
    </div>
  );
}

function ShortcutList() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[15px] font-bold">Article Shortcuts</p>
      {SHORTCUTS.map(([head, rows]) => (
        <section key={head}>
          <h3 className="pb-1 text-[13px] font-semibold">{head}</h3>
          {head === "In-Text Shortcuts" ? (
            <p className="pb-1 text-[12px] text-[#71767b]">
              Enter at the start of a new line or block, followed by a space
            </p>
          ) : null}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[13px]">
            {rows.map(([keys, what]) => (
              <div key={what + keys} className="contents">
                <dt className="font-mono text-[#71767b]">{keys}</dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** X's cover: 5:2, with X's hint until one is set; Upload, or Xtend's image model at its price. */
function Cover({
  cover,
  preview,
  locked,
  busy,
  prompt,
  setPrompt,
  open,
  setOpen,
  coverUsd,
  onFile,
  onRemove,
  onGenerate,
}: {
  readonly cover: DraftMedia | undefined;
  readonly preview: string | null;
  readonly locked: boolean;
  readonly busy: boolean;
  readonly prompt: string;
  readonly setPrompt: (p: string) => void;
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly coverUsd: number | null;
  readonly onFile: (file: File) => void;
  readonly onRemove: () => void;
  readonly onGenerate: () => void;
}) {
  const pickFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file !== undefined) onFile(file);
    });
    input.click();
  };
  const round =
    "grid size-11 cursor-pointer place-items-center rounded-full bg-black/60 hover:bg-black/80 [&_svg]:size-5";
  return (
    <div
      className="relative grid aspect-[5/2] w-full place-items-center overflow-hidden bg-white/[0.06]"
      data-x="article-cover"
    >
      {cover === undefined ? (
        <p className="px-6 text-center text-[15px] text-[#71767b]">
          We recommend an image with a 5:2 aspect ratio for best results.
        </p>
      ) : preview !== null ? (
        <img src={preview} alt={cover.alt} className="absolute inset-0 size-full object-cover" />
      ) : (
        <p className="font-mono text-[13px] text-[#71767b]">{cover.path.split("/").pop()}</p>
      )}
      {locked ? null : (
        <div className="absolute bottom-3 flex gap-3">
          {cover === undefined ? (
            <>
              <button type="button" aria-label="Upload" className={round} onClick={pickFile}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="9" cy="9" r="2" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
              </button>
              <Popover
                open={open}
                onOpenChange={setOpen}
                align="center"
                trigger={
                  <button type="button" aria-label="Generate in Xtend" className={round}>
                    <Sparkles />
                  </button>
                }
              >
                <p className="pb-2 text-[15px] font-bold">Generate in Xtend</p>
                <input
                  aria-label="Cover prompt"
                  placeholder="Describe the cover image"
                  className="h-9 w-full rounded-md border border-white/[0.24] bg-transparent px-2 text-[15px] outline-hidden focus:border-[#1d9bf0]"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    disabled={prompt.trim() === "" || busy || coverUsd === null}
                    className={cn(pill, "bg-foreground text-background")}
                    onClick={onGenerate}
                  >
                    {busy ? "Generating…" : "Generate"}
                    {coverUsd === null ? (
                      <Cost tone="solid" label="…" />
                    ) : (
                      <Cost tone="solid" usd={coverUsd} />
                    )}
                  </button>
                </div>
              </Popover>
            </>
          ) : (
            <button type="button" aria-label="Remove photo" className={round} onClick={onRemove}>
              <X />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** B's Publish: one button, its menu the three ways out with their prices, then X's dialog. */
function PublishMenu({
  ways,
  step,
  setStep,
  busy,
  run,
  replySettings,
  setReplySettings,
  caption,
  setCaption,
  when,
  setWhen,
  zone,
}: {
  readonly ways: ReadonlyArray<Way>;
  readonly step: "menu" | "publish" | "schedule" | null;
  readonly setStep: (step: "menu" | "publish" | "schedule" | null) => void;
  readonly busy: string | null;
  readonly run: (way: Way["id"]) => void;
  readonly replySettings: ReplySettings;
  readonly setReplySettings: (r: ReplySettings) => void;
  readonly caption: string;
  readonly setCaption: (c: string) => void;
  readonly when: string;
  readonly setWhen: (w: string) => void;
  readonly zone: string;
}) {
  const way = (id: Way["id"]) => ways.find((w) => w.id === id)!;
  return (
    <Popover
      open={step !== null}
      onOpenChange={(open) => setStep(open ? "menu" : null)}
      className="w-96 p-1"
      trigger={
        <button type="button" className={cn(pill, "bg-[#1d9bf0] text-white hover:bg-[#1a8cd8]")}>
          Publish <ChevronDown className="size-4" />
        </button>
      }
    >
      {step === "publish" ? (
        <div className="flex flex-col gap-3 p-3">
          <p className="text-[19px] font-extrabold">Publish Article</p>
          <label className="flex flex-col gap-1">
            <span className="text-[15px] font-bold">Who can reply?</span>
            <select
              aria-label="Choose who can reply to this Article"
              className="h-9 rounded-md border border-white/[0.24] bg-black px-2 text-[15px]"
              value={replySettings}
              onChange={(e) => setReplySettings(e.target.value as ReplySettings)}
            >
              {REPLIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[15px] font-bold">Add a caption to your article</span>
            <textarea
              aria-label="Add a caption to your article"
              placeholder="Provide a caption (optional)"
              rows={3}
              className="resize-none rounded-md border border-white/[0.24] bg-transparent p-2 text-[15px] outline-hidden focus:border-[#1d9bf0]"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
            <span className="text-[13px] text-[#71767b]">
              Optional. Your Article link will be added automatically.
            </span>
          </label>
          <p className="text-[13px] text-[#71767b]">
            Audience and reply controls are not editable after an article has been published.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={cn(pill, "hover:bg-white/10")}
              onClick={() => setStep("menu")}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy !== null || way("publish").blocked !== null}
              className={cn(pill, "bg-[#1d9bf0] text-white")}
              onClick={() => run("publish")}
            >
              {busy === "publish" ? "Publishing…" : "Publish"}
              <Cost tone="solid" label="free" />
            </button>
          </div>
        </div>
      ) : step === "schedule" ? (
        <div className="flex flex-col gap-3 p-3">
          <p className="text-[15px] font-bold">Schedule through the X API</p>
          <span className="flex gap-1.5">
            <input
              type="date"
              aria-label="Publish on"
              className="h-9 flex-1 rounded-md border border-white/[0.24] bg-transparent px-2 font-mono text-[13px]"
              value={when.slice(0, 10)}
              onChange={(e) => setWhen(`${e.target.value}T${when.slice(11, 16)}`)}
            />
            <TimeField
              label="Publish at"
              className="h-9"
              value={when.slice(11, 16)}
              onChange={(time) => setWhen(`${when.slice(0, 10)}T${time}`)}
            />
          </span>
          <p className="text-[12px] text-[#71767b]">{zone}</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={cn(pill, "hover:bg-white/10")}
              onClick={() => setStep("menu")}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                busy !== null ||
                way("schedule").blocked !== null ||
                localInputToInstant(zone, when) === null
              }
              className={cn(pill, "bg-foreground text-background")}
              onClick={() => run("schedule")}
            >
              Schedule
              {way("schedule").cost}
            </button>
          </div>
        </div>
      ) : (
        <ul aria-label="Ways out">
          {ways.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                disabled={w.blocked !== null || busy !== null}
                className="flex w-full cursor-pointer items-center gap-3 rounded-[calc(var(--radius)-4px)] px-3 py-2.5 text-left hover:bg-white/7 disabled:cursor-default disabled:opacity-60"
                onClick={() => (w.id === "queue" ? run("queue") : setStep(w.id))}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold">{w.label}</span>
                  <span className="block text-[13px] text-[#71767b]">{w.blocked ?? w.detail}</span>
                </span>
                {w.cost}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}

/** B's bubble over selected text: X's bold, italic and link, and Rewrite at its price. */
function Bubble({
  at,
  price,
  busy,
  onStyle,
  onLink,
  onRewrite,
}: {
  readonly at: Selected;
  readonly price: string;
  readonly busy: boolean;
  readonly onStyle: (command: "bold" | "italic") => void;
  readonly onLink: () => void;
  readonly onRewrite: () => void;
}) {
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();
  return (
    <div
      role="toolbar"
      aria-label="Selection"
      style={{ top: Math.max(at.top - 52, 8), left: at.left }}
      className="fixed z-40 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-white/[0.16] bg-black px-1.5 py-1 shadow-lg shadow-white/5"
    >
      <button
        type="button"
        aria-label="Bold"
        className={cn(iconButton, "text-foreground")}
        onMouseDown={keep}
        onClick={() => onStyle("bold")}
      >
        <Bold />
      </button>
      <button
        type="button"
        aria-label="Italicize"
        className={cn(iconButton, "text-foreground")}
        onMouseDown={keep}
        onClick={() => onStyle("italic")}
      >
        <Italic />
      </button>
      <button
        type="button"
        aria-label="Insert link"
        className={cn(iconButton, "text-foreground")}
        onMouseDown={keep}
        onClick={onLink}
      >
        <Link2 />
      </button>
      <span className="mx-1 h-5 w-px bg-white/[0.16]" />
      <button
        type="button"
        disabled={busy || price === "…"}
        className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[15px] hover:bg-white/10 disabled:opacity-50"
        onMouseDown={keep}
        onClick={onRewrite}
      >
        <Sparkles className="size-4" />
        Rewrite
        <Cost label={price} />
      </button>
    </div>
  );
}
