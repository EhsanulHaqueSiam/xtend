import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import {
  charCount,
  ComposeError,
  type DraftPoll,
  MEDIA_MAX_BYTES,
  MEDIA_MAX_IMAGES,
  type MediaKind,
  POST_LIMIT,
  type ReplySettings,
} from "@xtend/contracts";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import {
  AtSign,
  BadgeCheck,
  CalendarClock,
  Earth,
  Image,
  ListChecks,
  ListPlus,
  Smile,
  UserCheck,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { isElectron } from "../../env";
import { cn, toBase64 } from "../../lib/utils";
import {
  createDraftAtom,
  deleteDraftAtom,
  mediaAddAtom,
  sessionPostNowAtom,
} from "../../state/compose";
import { engineAtom, youFollow } from "../../state/engine";
import { settingsAtom, useSessionLane } from "../../state/settings";
import { failText } from "../compose/AssistPanel";
import { NEW_POLL, PollEditor } from "../compose/PollEditor";
import { REPLY_OPTIONS } from "../compose/ThreadEditor";
import { Popover } from "../ui/popover";
import { toastAtom } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { mentionAt, mentionMatches } from "./mentions";
import { Avatar } from "./XPostView";

/** The user's own face: X's signed-in account, else any of their posts the engine has seen. */
export const useOwnAvatar = () => {
  const engine = useAtomValue(engineAtom);
  const handle = AsyncResult.getOrElse(useAtomValue(settingsAtom), () => null)?.handle ?? null;
  if (engine.viewer?.avatarUrl != null) return engine.viewer.avatarUrl;
  if (handle === null) return null;
  const lower = handle.toLowerCase();
  for (const p of engine.posts.values())
    if (p.author.handle.toLowerCase() === lower) return p.avatarUrl;
  return null;
};

/** A file picked into the box, previewed from its object URL until it goes to the service. */
interface Attached {
  readonly file: File;
  readonly kind: MediaKind;
  readonly url: string;
}

interface BoxPost {
  readonly text: string;
  readonly quoteUrl?: string | null;
  readonly replySettings?: ReplySettings;
  readonly poll?: DraftPoll | null;
  readonly files?: ReadonlyArray<Attached>;
}

/**
 * The box as a draft, its files stored through mediaAdd: what Post sends and Compose opens. A
 * file that fails deletes the draft and the files before it, so a retry starts clean.
 */
const useBoxDraft = () => {
  const create = useAtomSet(createDraftAtom, { mode: "promiseExit" });
  const mediaAdd = useAtomSet(mediaAddAtom, { mode: "promiseExit" });
  const remove = useAtomSet(deleteDraftAtom, { mode: "promiseExit" });
  return async ({
    text,
    quoteUrl = null,
    replySettings = "everyone",
    poll = null,
    files = [],
  }: BoxPost) => {
    let draft = await create({
      blocks: [{ text }],
      quoteUrl,
      ...(replySettings === "everyone" ? {} : { replySettings }),
      ...(poll === null ? {} : { poll }),
    });
    // One at a time on purpose: positions follow the order the files were picked in.
    for (const { file, kind } of files) {
      if (Exit.isFailure(draft)) return draft;
      const id = draft.value.id;
      // A file that changed or went away since it was picked fails like an upload.
      const base64 = await toBase64(file).catch(() => null);
      draft =
        base64 === null
          ? Exit.fail(
              new ComposeError({ operation: "mediaAdd", detail: `Could not read ${file.name}` }),
            )
          : await mediaAdd({ draftId: id, blockIndex: 0, kind, name: file.name, base64 });
      if (Exit.isFailure(draft)) await remove(id);
    }
    return draft;
  };
};

/**
 * One post through the user's own session, free, for their click on Post: its media, poll and
 * who-can-reply set in X's own composer, and `quoteUrl` under the text, where X makes it a quote.
 * Resolves true once X has it, otherwise says why and resolves false. The service refuses it
 * rather than take the paid API lane when the session cannot post.
 */
export const useSessionPost = () => {
  const boxDraft = useBoxDraft();
  const postNow = useAtomSet(sessionPostNowAtom, { mode: "promiseExit" });
  const setToast = useAtomSet(toastAtom);
  return async (post: BoxPost) => {
    const draft = await boxDraft(post);
    const exit = Exit.isSuccess(draft) ? await postNow(draft.value.id) : draft;
    if (Exit.isFailure(exit))
      return (setToast({ text: `Not posted: ${failText(exit.cause)}` }), false);
    // The publisher answers with the draft: only "posted" means X has it; the text stays otherwise.
    if (exit.value.status !== "posted")
      return (setToast({ text: `Not posted: ${exit.value.error ?? exit.value.status}` }), false);
    setToast({ text: "Posted on X" });
    return true;
  };
};

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime";
const REPLY_ICONS = {
  everyone: Earth,
  following: UserCheck,
  verified: BadgeCheck,
  mentionedUsers: AtSign,
};
// X's button names the setting; verified is the odd one out ("Only Verified accounts can reply").
const replyButtonLabel = (value: ReplySettings) =>
  value === "verified"
    ? "Only Verified accounts can reply"
    : `${REPLY_OPTIONS.find(([v]) => v === value)?.[1] ?? ""} can reply`;
// macOS and Windows have an emoji picker Electron can open; Linux and the browser have none.
const emojiPanel =
  isElectron &&
  (window.desktopBridge?.platform === "darwin" || window.desktopBridge?.platform === "win32");

const tool =
  "-m-1.5 grid size-[34px] cursor-pointer place-items-center rounded-full text-[#1d9bf0] transition-colors duration-150 hover:bg-[#1d9bf0]/10 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent";

function Tool({
  label,
  disabled = false,
  onClick,
  children,
}: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            disabled={disabled}
            className={tool}
            // Keeps the caret in the text, where the emoji panel and a mention land.
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * X's "What's happening?" at the top of Home. Post is one click through the user's own session,
 * free, X's own composer setting the poll and reply limit; mentions come from people the engine
 * already saw. With session actions off, on the web alone, or over 280 characters, the box moves
 * to Compose as a draft, where the lane and its price are shown.
 */
export function HomeComposer() {
  const avatarUrl = useOwnAvatar();
  const navigate = useNavigate();
  const engine = useAtomValue(engineAtom);
  const settings = AsyncResult.getOrElse(useAtomValue(settingsAtom), () => null);
  const session = useSessionLane();
  const sessionPost = useSessionPost();
  const boxDraft = useBoxDraft();
  const setToast = useAtomSet(toastAtom);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<ReadonlyArray<Attached>>([]);
  const [poll, setPoll] = useState<DraftPoll | null>(null);
  const [reply, setReply] = useState<ReplySettings>("everyone");
  const [opened, setOpened] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // The textarea's selection: a mention pick replaces the token around it.
  const [caret, setCaret] = useState({ start: 0, end: 0 });
  const [pick, setPick] = useState(0);
  // The mention the user closed with Escape, by where its @ sits; typing another reopens.
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  // Object URLs of the files in the box, freed when it goes away with them.
  const urls = useRef(new Set<string>());
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- frees the previews' object URLs on unmount.
  useEffect(() => {
    const live = urls.current;
    return () => {
      for (const url of live) URL.revokeObjectURL(url);
    };
  }, []);

  const length = charCount(text);
  const tooLong = length > POST_LIMIT;
  const video = files.some((f) => f.kind === "video");
  const blank = text.trim() === "" && files.length === 0;
  const pollBlank = poll !== null && poll.options.some((o) => o.trim() === "");
  const plain = files.length === 0 && poll === null && reply === "everyone";

  const mention = opened && !busy ? mentionAt(text, caret.start, caret.end) : null;
  const self = settings?.handle ?? engine.viewer?.handle ?? null;
  const people =
    mention === null || mention.start === closedAt
      ? []
      : mentionMatches(engine.users.values(), mention.query, (u) => youFollow(engine, u), self);
  const active = Math.min(pick, people.length - 1);

  const free = (url: string) => {
    URL.revokeObjectURL(url);
    urls.current.delete(url);
  };

  const clear = () => {
    for (const f of files) free(f.url);
    setText("");
    setFiles([]);
    setPoll(null);
    setReply("everyone");
  };

  const addFiles = (picked: ReadonlyArray<File>) => {
    const next = [...files];
    for (const file of picked) {
      const kind: MediaKind = file.type.startsWith("video/") ? "video" : "image";
      if (file.size > MEDIA_MAX_BYTES) {
        setToast({ text: `${file.name} is over ${MEDIA_MAX_BYTES / 1024 / 1024} MB` });
        continue;
      }
      // X's rule: up to four images, or one video alone.
      if (
        next.some((f) => f.kind === "video") ||
        (kind === "video" ? next.length > 0 : next.length >= MEDIA_MAX_IMAGES)
      ) {
        setToast({ text: "Up to 4 images or 1 video" });
        break;
      }
      const url = URL.createObjectURL(file);
      urls.current.add(url);
      next.push({ file, kind, url });
    }
    setFiles(next);
  };

  const removeFile = (url: string) => {
    free(url);
    setFiles((fs) => fs.filter((f) => f.url !== url));
  };

  const choose = (handle: string) => {
    if (mention === null) return;
    const inserted = `@${handle} `;
    const at = mention.start + inserted.length;
    flushSync(() => {
      setText(text.slice(0, mention.start) + inserted + text.slice(mention.end));
      setCaret({ start: at, end: at });
    });
    box.current?.setSelectionRange(at, at);
  };

  const post = { text: text.trim(), replySettings: reply, poll, files };
  const handOff = async () => {
    if (plain) return void navigate({ href: `/compose?text=${encodeURIComponent(text)}` });
    // Media, a poll or a reply limit ride along as a draft, which Compose opens.
    setReplyOpen(false);
    setBusy(true);
    const draft = await boxDraft(post).finally(() => setBusy(false));
    if (Exit.isFailure(draft)) return setToast({ text: `Not moved: ${failText(draft.cause)}` });
    clear();
    void navigate({ href: `/compose?draft=${draft.value.id}` });
  };

  const send = async () => {
    if (blank || busy || pollBlank) return;
    if (!session || tooLong) return handOff();
    setReplyOpen(false);
    setBusy(true);
    const posted = await sessionPost(post).finally(() => setBusy(false));
    if (posted) clear();
  };

  const hint = session
    ? "free · your session"
    : isElectron
      ? "session actions off"
      : "posting free needs the desktop app";
  const ReplyIcon = REPLY_ICONS[reply];

  return (
    <div
      data-x="composer"
      className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-3 border-b border-border px-4 pt-3"
    >
      <Avatar url={avatarUrl} size={40} />
      {/* Frozen while Post or a handoff sends, so nothing added meanwhile is lost to clear(). */}
      <fieldset disabled={busy} className="relative m-0 min-w-0 border-0 p-0">
        <textarea
          ref={box}
          aria-label="Post text"
          aria-autocomplete="list"
          aria-controls={people.length > 0 ? "home-mentions" : undefined}
          placeholder={poll === null ? "What's happening?" : "Ask a question"}
          rows={text === "" ? 1 : 3}
          className="block w-full resize-none bg-transparent py-2 text-[20px] leading-6 outline-hidden placeholder:text-[#71767b]"
          value={text}
          onFocus={() => setOpened(true)}
          onChange={(e) => {
            setText(e.target.value);
            setCaret({ start: e.target.selectionStart, end: e.target.selectionEnd });
            setPick(0);
          }}
          onSelect={(e) =>
            setCaret({ start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd })
          }
          onKeyDown={(e) => {
            if (people.length > 0) {
              const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
              if (step !== undefined) {
                e.preventDefault();
                return setPick((active + step + people.length) % people.length);
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                return choose(people[active]!.handle);
              }
              if (e.key === "Escape") return setClosedAt(mention?.start ?? null);
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {people.length > 0 ? (
          <ul
            id="home-mentions"
            role="listbox"
            aria-label="People to mention"
            className="absolute inset-x-0 z-30 max-h-80 overflow-y-auto rounded-xl border border-border bg-background py-1 shadow-[0_0_15px_rgb(255_255_255/0.12)]"
          >
            {people.map((u, i) => (
              <li
                key={u.userId}
                role="option"
                aria-selected={i === active}
                className={cn(
                  "flex cursor-pointer items-center gap-3 px-4 py-2.5",
                  i === active && "bg-white/7",
                )}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setPick(i)}
                onClick={() => choose(u.handle)}
              >
                <Avatar url={u.avatarUrl} size={40} />
                <span className="min-w-0 leading-5">
                  <span className="flex items-center gap-1 truncate text-[15px] font-bold">
                    {u.name}
                    {u.verified ? <BadgeCheck className="size-4 shrink-0 text-[#1d9bf0]" /> : null}
                  </span>
                  <span className="block truncate text-[15px] text-[#71767b]">@{u.handle}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {files.length > 0 ? (
          <ul
            aria-label="Attached media"
            className={cn("my-2 grid gap-2", files.length > 1 && "grid-cols-2")}
          >
            {files.map((f) => (
              <li key={f.url} className="relative h-36 overflow-hidden rounded-2xl bg-white/7">
                {f.kind === "video" ? (
                  <video src={f.url} muted className="size-full object-cover" />
                ) : (
                  <img src={f.url} alt="" className="size-full object-cover" />
                )}
                <button
                  type="button"
                  aria-label={`Remove ${f.file.name}`}
                  className="absolute top-1 left-1 grid size-8 cursor-pointer place-items-center rounded-full bg-black/75 hover:bg-black/60"
                  onClick={() => removeFile(f.url)}
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {poll === null ? null : (
          <div className="my-2">
            <PollEditor poll={poll} onChange={setPoll} />
          </div>
        )}
        {opened ? (
          <div className="border-b border-border pb-3">
            <Popover
              open={replyOpen}
              onOpenChange={setReplyOpen}
              align="start"
              className="w-80 p-0 py-3"
              trigger={
                <button
                  type="button"
                  aria-label={replyButtonLabel(reply)}
                  className="-ml-3 flex cursor-pointer items-center gap-1 rounded-full px-3 py-0.5 text-[14px] font-bold text-[#1d9bf0] hover:bg-[#1d9bf0]/10"
                >
                  <ReplyIcon className="size-4" />
                  {replyButtonLabel(reply)}
                </button>
              }
            >
              <p className="px-4 text-[15px] font-bold">Who can reply?</p>
              <p className="px-4 pb-2 text-[13px] text-muted-foreground">
                Choose who can reply to this post. Anyone mentioned can always reply.
              </p>
              {/* X's own shape: a radio per row; a pick leaves the popover open. */}
              <div role="radiogroup" aria-label="Who can reply?">
                {REPLY_OPTIONS.map(([value, label]) => {
                  const Icon = REPLY_ICONS[value];
                  return (
                    <label
                      key={value}
                      className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-[15px] hover:bg-white/7"
                    >
                      <span className="grid size-10 place-items-center rounded-full bg-[#1d9bf0] text-white">
                        <Icon className="size-5" />
                      </span>
                      <span className="flex-1 font-bold">{label}</span>
                      <input
                        type="radio"
                        name="home-reply"
                        checked={value === reply}
                        onChange={() => setReply(value)}
                        className="size-5 accent-[#1d9bf0]"
                      />
                    </label>
                  );
                })}
              </div>
            </Popover>
          </div>
        ) : null}
        <div className="flex items-center gap-3.5 py-2.5">
          <input
            ref={picker}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            aria-label="Media files"
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <Tool
            label="Media"
            disabled={poll !== null || video || files.length >= MEDIA_MAX_IMAGES}
            onClick={() => picker.current?.click()}
          >
            <Image className="size-[18px]" />
          </Tool>
          <Tool
            label="Poll"
            disabled={poll !== null || files.length > 0}
            onClick={() => setPoll(NEW_POLL)}
          >
            <ListChecks className="size-[18px]" />
          </Tool>
          {emojiPanel ? (
            <Tool
              label="Emoji"
              onClick={() => {
                box.current?.focus();
                window.desktopBridge?.showEmojiPanel();
              }}
            >
              <Smile className="size-[18px]" />
            </Tool>
          ) : null}
          <Tool label="Schedule in Compose" onClick={() => void handOff()}>
            <CalendarClock className="size-[18px]" />
          </Tool>
          <Tool label="Make a thread in Compose" onClick={() => void handOff()}>
            <ListPlus className="size-[18px]" />
          </Tool>
          <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
            {[hint, text === "" ? null : `${length}/${POST_LIMIT}`].filter(Boolean).join(" · ")}
          </span>
          <button
            type="button"
            disabled={blank || busy || pollBlank}
            className="h-9 cursor-pointer rounded-full bg-foreground px-4 text-[15px] font-bold text-background transition-opacity duration-150 disabled:cursor-default disabled:opacity-50"
            onClick={() => void send()}
          >
            {session && !tooLong ? "Post" : "Continue in Compose"}
          </button>
        </div>
      </fieldset>
    </div>
  );
}
