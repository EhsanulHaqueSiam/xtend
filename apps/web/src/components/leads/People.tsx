import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Person, Stage, XPost } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { cn } from "../../lib/utils";
import {
  draftDmAtom,
  draftReplyAtom,
  latestPostAtom,
  peopleAtom,
  personAtom,
  personProfileAtom,
  sendDmAtom,
  sendReplyAtom,
  updatePersonAtom,
} from "../../state/leads";
import { useQuoteLabel, useRates, usd } from "../../state/costs";
import { Empty, ErrorText, errorText, fmt, inputClass } from "../analyze/ui";
import { Button } from "../ui/button";
import { ago, STAGES, StagePill, useAction } from "./ui";

/** People table for one list (or everyone) with a detail panel for the selected row. */
export function People({ listId }: { readonly listId: number | null }) {
  const people = useAtomValue(peopleAtom(listId));
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="flex gap-3">
      <div className="min-w-0 flex-1">
        {AsyncResult.match(people, {
          onInitial: () => <Empty>Loading people…</Empty>,
          onFailure: (f) => <ErrorText>{errorText(f.cause)}</ErrorText>,
          onSuccess: ({ value }) =>
            value.length === 0 ? (
              <Empty>No people yet. Build a list, run an agent or check new followers.</Empty>
            ) : (
              <PeopleTable people={value} listId={listId} open={open} onOpen={setOpen} />
            ),
        })}
      </div>
      {open !== null ? (
        <PersonPanel id={open} listId={listId} onClose={() => setOpen(null)} />
      ) : null}
    </div>
  );
}

function PeopleTable({
  people,
  listId,
  open,
  onOpen,
}: {
  readonly people: ReadonlyArray<Person>;
  readonly listId: number | null;
  readonly open: number | null;
  readonly onOpen: (id: number) => void;
}) {
  const refresh = useAtomRefresh(peopleAtom(listId));
  const update = useAtomSet(updatePersonAtom, { mode: "promise" });
  const { error, run } = useAction();
  const setStage = (id: number, stage: Stage) => run(() => update({ id, stage }).then(refresh));
  return (
    <>
      {error !== null ? <ErrorText>{error}</ErrorText> : null}
      <table className="w-full text-xs">
        <thead className="text-2xs text-muted-foreground">
          <tr>
            <th className="py-1 text-left font-normal">Person</th>
            <th className="py-1 text-right font-normal">Score</th>
            <th className="py-1 text-right font-normal">Followers</th>
            <th className="py-1 pl-3 text-left font-normal">Source</th>
            <th className="py-1 pl-3 text-left font-normal">Stage</th>
            <th className="py-1 text-right font-normal">Last</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr
              key={p.id}
              className={cn(
                "cursor-pointer border-t border-border hover:bg-accent/60",
                p.id === open && "bg-accent/60",
                p.stage === "ignored" && "text-muted-foreground",
              )}
              onClick={() => onOpen(p.id)}
            >
              <td className="max-w-xs truncate py-1 pr-2">
                @{p.handle} <span className="text-muted-foreground">{p.name}</span>
              </td>
              <td className="py-1 text-right font-mono text-2xs">
                {fmt(p.score)}
                {p.tier !== null ? <span className="text-muted-foreground"> {p.tier}</span> : null}
              </td>
              <td className="py-1 text-right font-mono text-2xs">{fmt(p.followers)}</td>
              <td className="max-w-32 truncate py-1 pl-3 font-mono text-2xs text-muted-foreground">
                {p.source}
              </td>
              <td className="py-1 pl-3" onClick={(e) => e.stopPropagation()}>
                <select
                  className="cursor-pointer bg-transparent font-mono text-2xs text-foreground outline-hidden"
                  value={p.stage}
                  onChange={(e) => void setStage(p.id, e.target.value as Stage)}
                >
                  {STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-1 text-right font-mono text-2xs text-muted-foreground">
                {ago(p.lastActivity)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function PersonPanel({
  id,
  listId,
  onClose,
}: {
  readonly id: number;
  readonly listId: number | null;
  readonly onClose: () => void;
}) {
  const rates = useRates();
  const data = useAtomValue(personAtom(id));
  const refresh = useAtomRefresh(personAtom(id));
  const refreshList = useAtomRefresh(peopleAtom(listId));
  const update = useAtomSet(updatePersonAtom, { mode: "promise" });
  const profile = useAtomSet(personProfileAtom, { mode: "promise" });
  const draftDm = useAtomSet(draftDmAtom, { mode: "promise" });
  const sendDm = useAtomSet(sendDmAtom, { mode: "promise" });
  const { busy, error, run } = useAction();
  const [notes, setNotes] = useState<string | null>(null);
  const [dm, setDm] = useState("");

  return (
    <aside className="flex w-80 shrink-0 flex-col gap-2 rounded-lg border border-border bg-card p-3 text-xs">
      {AsyncResult.match(data, {
        onInitial: () => <Empty>Loading…</Empty>,
        onFailure: (f) => <ErrorText>{errorText(f.cause)}</ErrorText>,
        onSuccess: ({ value: { person, activity } }) => (
          <>
            <div className="flex items-center justify-between">
              <a
                href={`https://x.com/${person.handle}`}
                target="_blank"
                rel="noreferrer"
                className="font-medium hover:underline"
              >
                @{person.handle}
              </a>
              <Button variant="ghost-muted" size="xs" onClick={onClose}>
                close
              </Button>
            </div>
            <div className="flex gap-3 font-mono text-2xs text-muted-foreground">
              <span>
                score {fmt(person.score)}
                {person.tier !== null ? ` ${person.tier}` : ""}
              </span>
              <span>{fmt(person.followers)} followers</span>
              <StagePill stage={person.stage} />
            </div>
            <p className="text-muted-foreground">
              {person.bio || "No bio loaded."}{" "}
              <button
                type="button"
                className="cursor-pointer text-foreground hover:underline"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    profile(id).then(() => {
                      refresh();
                      refreshList();
                    }),
                  )
                }
              >
                fetch profile ({usd(rates?.scraperProfile ?? 0)})
              </button>
            </p>
            <textarea
              className={inputClass}
              rows={3}
              placeholder="Notes"
              value={notes ?? person.notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => {
                if (notes !== null && notes !== person.notes)
                  void run(() => update({ id, notes }).then(refresh));
              }}
            />
            <textarea
              className={inputClass}
              rows={4}
              placeholder="DM text"
              value={dm}
              onChange={(e) => setDm(e.target.value)}
            />
            <div className="flex gap-1.5">
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() => void run(() => draftDm(id).then(setDm))}
              >
                Draft with AI
              </Button>
              <Button
                size="xs"
                disabled={busy || dm.trim() === ""}
                onClick={() =>
                  void run(() =>
                    sendDm({ id, text: dm }).then(() => {
                      setDm("");
                      refresh();
                      refreshList();
                    }),
                  )
                }
              >
                Send DM ({usd(rates?.dm ?? 0)})
              </Button>
            </div>
            {error !== null ? <ErrorText>{error}</ErrorText> : null}
            <Reply id={id} handle={person.handle} onSent={() => void (refresh(), refreshList())} />
            <ul className="flex flex-col gap-0.5 border-t border-border pt-2">
              {activity.length === 0 ? (
                <li className="text-muted-foreground">No activity yet.</li>
              ) : (
                activity.map((a) => (
                  <li key={a.id} className="flex gap-2">
                    <span className="w-8 shrink-0 font-mono text-2xs text-muted-foreground">
                      {ago(a.at)}
                    </span>
                    <span className="font-mono text-2xs">{a.kind}</span>
                    <span className="truncate text-muted-foreground">{a.detail}</span>
                  </li>
                ))
              )}
            </ul>
          </>
        ),
      })}
    </aside>
  );
}

/** Their latest post, an AI draft, and a reply through the X connection; every paid step is priced on its button. */
function Reply({
  id,
  handle,
  onSent,
}: {
  readonly id: number;
  readonly handle: string;
  readonly onSent: () => void;
}) {
  const loadPost = useAtomSet(latestPostAtom, { mode: "promise" });
  const draft = useAtomSet(draftReplyAtom, { mode: "promise" });
  const send = useAtomSet(sendReplyAtom, { mode: "promise" });
  const { busy, error, run } = useAction();
  const [post, setPost] = useState<XPost | null | undefined>(undefined);
  const [text, setText] = useState("");
  const [sentId, setSentId] = useState<string | null>(null);
  const postQuote = useQuoteLabel({ kind: "userPosts", handle });
  const replyQuote = useQuoteLabel({ kind: "post", text });
  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-2">
      <div className="flex items-center justify-between">
        <span className="font-medium">Reply to their latest post</span>
        <Button
          size="xs"
          variant="ghost-muted"
          disabled={busy}
          onClick={() => void run(() => loadPost(id).then(setPost))}
        >
          Load post ({postQuote})
        </Button>
      </div>
      {post === null ? (
        <p className="text-muted-foreground">No recent post found.</p>
      ) : post !== undefined ? (
        <p className="line-clamp-3 text-muted-foreground">{post.text}</p>
      ) : null}
      {post !== undefined && post !== null ? (
        <>
          <textarea
            className={inputClass}
            rows={3}
            placeholder="Reply text"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex gap-1.5">
            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  draft(id).then((d) => {
                    setPost(d.post);
                    setText(d.text);
                  }),
                )
              }
            >
              Draft with AI
            </Button>
            <Button
              size="xs"
              disabled={busy || text.trim() === ""}
              onClick={() =>
                void run(() =>
                  send({ id, postId: post.postId, text }).then((r) => {
                    setSentId(r.postId);
                    setText("");
                    onSent();
                  }),
                )
              }
            >
              Reply ({replyQuote})
            </Button>
          </div>
        </>
      ) : null}
      {sentId !== null ? (
        <p className="font-mono text-2xs text-success-foreground">replied, post {sentId}</p>
      ) : null}
      {error !== null ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}
