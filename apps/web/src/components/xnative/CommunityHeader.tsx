import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { EngineCommunity } from "@xtend/contracts";
import * as Atom from "effect/reactivity/Atom";
import { Pin, Share } from "lucide-react";

import {
  askMembership,
  askPin,
  communityPinned,
  type CommunityRole,
  communityRole,
  engineAtom,
  updateEngine,
} from "../../state/engine";
import { type MembershipAction, xCommunityJoin, xCommunityPin, xOverAtom } from "../../state/x";
import { fmt } from "../analyze/ui";
import { Menu, MenuItem } from "../ui/menu";
import { useXPress } from "./useXPress";

/** X's round icon buttons in a Community's header and top bar. */
export const ICON_BUTTON =
  "no-drag grid size-9 shrink-0 cursor-pointer place-items-center rounded-full transition-colors duration-150 hover:bg-white/10 disabled:cursor-default disabled:opacity-60";

/**
 * True while a Community header press (Join, Pin) waits on X: one runs at a time, so a second
 * press never starts a run that cuts the first short. Kept across the header's remounts (a tab).
 */
const headerPressAtom = Atom.make(false).pipe(Atom.keepAlive);

/** The header's one pending press: `run` runs `press` unless another is still waiting on X. */
function useHeaderPress() {
  const pending = useAtomValue(headerPressAtom);
  const setPending = useAtomSet(headerPressAtom);
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

/**
 * X's header for a Community: banner, name, topic and members, then X's Pin, Share and Join.
 */
export function CommunityHeader({ community }: { readonly community: EngineCommunity }) {
  return (
    <>
      {community.bannerUrl === null ? (
        <div className="aspect-[3/1] bg-[#333639]" />
      ) : (
        <img src={community.bannerUrl} alt="" className="aspect-[3/1] w-full object-cover" />
      )}
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[24px] leading-7 font-extrabold">{community.name}</p>
          {community.topic === null ? null : (
            <p className="text-[15px] text-[#71767b]">{community.topic}</p>
          )}
          {community.members === null ? null : (
            <p className="mt-2 text-[15px] text-[#71767b]">
              <b className="font-bold text-foreground">{fmt(community.members)}</b> Members
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PinButton community={community} />
          <ShareMenu id={community.communityId} />
          <JoinButton community={community} />
        </div>
      </div>
    </>
  );
}

/** X's Share for a Community: its one row copies the Community's link, here, with no press on X. */
function ShareMenu({ id }: { readonly id: string }) {
  const { setToast } = useXPress();
  const copy = () =>
    void navigator.clipboard
      .writeText(`https://x.com/i/communities/${id}`)
      .then(() => setToast({ text: "Copied to clipboard" }));
  return (
    <Menu
      label="Share Community"
      align="end"
      trigger={
        <button
          type="button"
          aria-label="Share Community"
          className={`${ICON_BUTTON} border border-white/[0.35]`}
        >
          <Share className="size-[18px]" />
        </button>
      }
    >
      <MenuItem onClick={copy}>Copy link</MenuItem>
    </Menu>
  );
}

/**
 * X's Pin for the user's click, pressed on X's own button: pinned, the Community is a tab on Home.
 * What X took holds until X's pinned tabs agree, which X sends when its Home loads; a button X has
 * turned since is not pressed, and Xtend's takes X's word.
 */
function PinButton({ community }: { readonly community: EngineCommunity }) {
  const { blocked, setToast } = useXPress();
  const setOver = useAtomSet(xOverAtom);
  const engine = useAtomValue(engineAtom);
  const setEngine = useAtomSet(engineAtom);
  const { pending, run } = useHeaderPress();
  const pinned = communityPinned(engine, community.communityId);
  const press = async () => {
    const why = blocked();
    if (why !== null) return setToast({ text: why });
    const after = await xCommunityPin(community.communityId, !pinned, setOver);
    if (after === null) return setToast({ text: "X did not take that. Try again in a moment." });
    // Only X's button says whether it took the pin: X keeps it unpinned at its limit, with a toast.
    const now = after.label.startsWith("Unpin");
    setEngine(updateEngine((s) => askPin(s, community.communityId, now)));
    if (after.refused)
      setToast({
        text: `X shows this Community ${now ? "pinned" : "not pinned"} now, so nothing was pressed.`,
      });
    else if (after.toast !== null) setToast({ text: after.toast });
  };
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={pinned ? "Unpin Community" : "Pin Community"}
      aria-pressed={pinned}
      className={`${ICON_BUTTON} border border-white/[0.35]`}
      onClick={() => void run(press)}
    >
      <Pin className={pinned ? "size-[18px] fill-current" : "size-[18px]"} />
    </button>
  );
}

/** The role X's words on its membership button say the viewer has. */
const roleOf = (label: string): CommunityRole =>
  label === "Joined"
    ? "Member"
    : label === "Requested" || label === "Pending"
      ? "Requested"
      : "NonMember";

/** X's membership button for a role and policy: its words, and what pressing it does. */
const membershipButton = (
  role: string | null,
  joinPolicy: string | null,
): { readonly label: string; readonly action: MembershipAction | null } | null =>
  role === null
    ? null
    : role === "Requested"
      ? { label: "Requested", action: null }
      : role !== "NonMember"
        ? { label: "Joined", action: "leave" }
        : joinPolicy === "Open"
          ? { label: "Join", action: "join" }
          : { label: "Ask to join", action: "ask" };

/**
 * X's Join, Ask to join or Joined for the user's click, pressed on X's own button. Asking first
 * shows X's rules dialog over the main area, and leaving X's confirm. What X took stays in the
 * store until X's capture agrees, since X's own page shows it from its cache; a button X has
 * turned since is not pressed, and Xtend's takes X's words.
 */
function JoinButton({ community }: { readonly community: EngineCommunity }) {
  const { blocked, setToast } = useXPress();
  const setOver = useAtomSet(xOverAtom);
  const engine = useAtomValue(engineAtom);
  const setEngine = useAtomSet(engineAtom);
  const { pending, run } = useHeaderPress();
  const button = membershipButton(communityRole(engine, community), community.joinPolicy);
  if (button === null) return null;
  const { label, action } = button;
  const press = async () => {
    if (action === null) return;
    const why = blocked();
    if (why !== null) return setToast({ text: why });
    const after = await xCommunityJoin(community.communityId, action, setOver);
    if (after === null) return setToast({ text: "X did not take that. Try again in a moment." });
    setEngine(updateEngine((s) => askMembership(s, community.communityId, roleOf(after.label))));
    if (after.refused)
      setToast({ text: `X shows ${after.label} for this Community now, so nothing was pressed.` });
  };
  return (
    <button
      type="button"
      disabled={pending || action === null}
      aria-label={`${label} ${community.name}`}
      className={
        action === "join" || action === "ask"
          ? "h-9 shrink-0 cursor-pointer rounded-full bg-foreground px-4 text-[15px] font-bold text-background transition-opacity duration-150 hover:opacity-90 disabled:opacity-60"
          : "h-9 shrink-0 cursor-pointer rounded-full border border-white/[0.35] px-4 text-[15px] font-bold transition-colors duration-150 hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-60"
      }
      onClick={() => void run(press)}
    >
      {label}
    </button>
  );
}
