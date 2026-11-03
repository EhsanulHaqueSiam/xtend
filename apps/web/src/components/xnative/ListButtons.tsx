import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type { EngineList } from "@xtend/contracts";
import * as Atom from "effect/reactivity/Atom";
import { Pin } from "lucide-react";

import {
  askList,
  engineAtom,
  listFollowing,
  listNameShared,
  listPinned,
  updateEngine,
} from "../../state/engine";
import { xListDialog, xListFollow, xListPin, xOverAtom } from "../../state/x";
import { useXPress } from "./useXPress";

/**
 * True while a List press (Follow, Pin) waits on X: one runs at a time, so a second press never
 * starts a run that cuts the first short. Kept across remounts (the Lists page and a List's own).
 */
const listPressAtom = Atom.make(false).pipe(Atom.keepAlive);

function useListPress() {
  const pending = useAtomValue(listPressAtom);
  const setPending = useAtomSet(listPressAtom);
  const run = async (press: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    try {
      await press();
    } finally {
      setPending(false);
    }
  };
  return { pending, run };
}

const PILL =
  "h-9 shrink-0 cursor-pointer rounded-full px-4 text-[15px] font-bold transition-colors duration-150 disabled:cursor-default disabled:opacity-60";
const OUTLINED = `${PILL} border border-white/[0.35] hover:bg-white/[0.06]`;

/**
 * X's Follow or Following under a List's counts, for the user's click on X's own button. What X
 * took holds until X's answer for the List agrees; a button X has turned since is not pressed,
 * and Xtend's takes X's word.
 */
export function ListFollowButton({ list }: { readonly list: EngineList }) {
  const { blocked, setToast } = useXPress();
  const setOver = useAtomSet(xOverAtom);
  const engine = useAtomValue(engineAtom);
  const setEngine = useAtomSet(engineAtom);
  const { pending, run } = useListPress();
  const following = listFollowing(engine, list);
  const press = async () => {
    const why = blocked();
    if (why !== null) return setToast({ text: why });
    const after = await xListFollow(list, !following, setOver);
    if (after === null) return setToast({ text: "X did not take that. Try again in a moment." });
    const now = after.label !== "Follow";
    setEngine(updateEngine((s) => askList(s, list.listId, { following: now })));
    if (after.refused)
      setToast({
        text: `X shows this List ${now ? "followed" : "not followed"} now, so nothing was pressed.`,
      });
    else if (after.toast !== null) setToast({ text: after.toast });
  };
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`${following ? "Following" : "Follow"} ${list.name}`}
      className={
        following
          ? OUTLINED
          : `${PILL} bg-foreground text-background hover:opacity-90 disabled:opacity-60`
      }
      onClick={() => void run(press)}
    >
      {following ? "Following" : "Follow"}
    </button>
  );
}

/**
 * X's own Create a new List (`listId` null) or Edit List for the user's click, over the main
 * area; then Xtend shows where X settled: the List it saved, or its Lists page after Delete List.
 */
export function useListDialog() {
  const navigate = useNavigate();
  const setOver = useAtomSet(xOverAtom);
  const { blocked, setToast } = useXPress();
  return async (listId: string | null) => {
    const why = blocked();
    if (why !== null) return setToast({ text: why });
    const settled = await xListDialog(listId, setOver);
    if (settled === false)
      return setToast({ text: "X did not open its List dialog. Try again in a moment." });
    if (settled === null) return;
    const id = /^\/i\/lists\/(\d+)$/.exec(settled)?.[1];
    void navigate(id === undefined ? { to: "/lists" } : { to: "/lists/$id", params: { id } });
  };
}

/** X's Edit List on the user's own List, which opens X's own dialog for it. */
export function ListEditButton({ list }: { readonly list: EngineList }) {
  const open = useListDialog();
  return (
    <button type="button" className={OUTLINED} onClick={() => void open(list.listId)}>
      Edit List
    </button>
  );
}

/**
 * X's Pin on a row of Your Lists, for the user's click on X's own, in that row of X's Lists page
 * (`handle`'s). Pinned, the List is a tab on Home; at X's limit X keeps it unpinned and says so.
 */
export function ListPinButton({
  list,
  handle,
}: {
  readonly list: EngineList;
  readonly handle: string;
}) {
  const { blocked, setToast } = useXPress();
  const setOver = useAtomSet(xOverAtom);
  const engine = useAtomValue(engineAtom);
  const setEngine = useAtomSet(engineAtom);
  const { pending, run } = useListPress();
  const pinned = listPinned(engine, list);
  const press = async () => {
    const why = blocked();
    if (why !== null) return setToast({ text: why });
    if (listNameShared(engine, list))
      return setToast({
        text: "Another List has this name, so X's Lists page cannot tell its row apart. Pin it on x.com.",
      });
    const after = await xListPin(list, handle, !pinned, setOver);
    if (after === null) return setToast({ text: "X did not take that. Try again in a moment." });
    // Only X's button says whether it took the pin.
    const now = after.label === "Unpin List";
    setEngine(updateEngine((s) => askList(s, list.listId, { pinned: now })));
    if (after.refused)
      setToast({
        text: `X shows this List ${now ? "pinned" : "not pinned"} now, so nothing was pressed.`,
      });
    else if (after.toast !== null) setToast({ text: after.toast });
  };
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={pinned ? "Unpin List" : "Pin List"}
      aria-pressed={pinned}
      className="mr-2 grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-[#1d9bf0] transition-colors duration-150 hover:bg-[#1d9bf0]/10 disabled:cursor-default disabled:opacity-60"
      onClick={() => void run(press)}
    >
      <Pin className={pinned ? "size-5 fill-current" : "size-5"} />
    </button>
  );
}
