import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { EngineBookmarkFolder } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Check, ChevronDown, Folder } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { Menu, MenuItem } from "../components/ui/menu";
import { Popover } from "../components/ui/popover";
import { XLink } from "../components/ui/x-link";
import { Timeline } from "../components/xnative/Timeline";
import { useXPress } from "../components/xnative/useXPress";
import { XTitle } from "../components/xnative/XColumn";
import { at, bookmarkFolderSurface, engineAtom, FOLDERS_CLAIM } from "../state/engine";
import { settingsAtom } from "../state/settings";
import { xFolderDialog, xGo, xNavigate, xOverAtom } from "../state/x";

/** X's own upgrade page, as X's bookmark folders upsell opens it. */
const UPGRADE_URL = "https://x.com/i/premium_sign_up?referring_page=bookmark_folders";

/** The title as the trigger of X's folder menu: the open folder's name with X's chevron. */
const titleButton = (name: string) => (
  <button
    type="button"
    aria-label={`${name}, bookmark folders`}
    className="no-drag -mx-2 flex max-w-full cursor-pointer items-center gap-1 rounded-full px-2 transition-colors duration-150 hover:bg-white/10"
  >
    <span className="truncate">{name}</span>
    <ChevronDown className="size-4 shrink-0" />
  </button>
);

/** A folder's picture as X's menu draws it, or X's folder icon where it has none. */
const thumbnail = (url: string | null) =>
  url === null ? (
    <Folder className="size-5 shrink-0" />
  ) : (
    <img src={url} alt="" className="size-5 shrink-0 rounded-full object-cover" />
  );

/**
 * X's bookmark folders (Premium), as X's folder menu on its Bookmarks tab offers them: All
 * Bookmarks and each folder, X's Create Folder, and for the open folder X's Edit and Delete, which
 * open X's own dialogs for the user's click.
 */
function FolderMenu({
  name,
  open,
  folders,
  onPick,
  onDialog,
}: {
  readonly name: string;
  readonly open: string | undefined;
  readonly folders: ReadonlyArray<EngineBookmarkFolder> | null;
  readonly onPick: (folderId: string | undefined) => void;
  readonly onDialog: (folderId: string | null, remove: boolean) => void;
}) {
  const row = (label: ReactNode, on: boolean, pick: () => void, key: string) => (
    <MenuItem key={key} onClick={pick}>
      {label}
      {on ? <Check aria-label="Open" className="ml-auto size-4 text-[#1d9bf0]" /> : null}
    </MenuItem>
  );
  return (
    <Menu label="Bookmark folders" trigger={titleButton(name)}>
      {row("All Bookmarks", open === undefined, () => onPick(undefined), "all")}
      {folders === null ? (
        <MenuItem disabled onClick={() => {}}>
          Loading folders from X
        </MenuItem>
      ) : (
        folders.map((f) =>
          row(
            <>
              {thumbnail(f.imageUrl)}
              <span className="truncate">{f.name}</span>
            </>,
            f.folderId === open,
            () => onPick(f.folderId),
            f.folderId,
          ),
        )
      )}
      <div role="separator" className="my-1 h-px bg-border" />
      <MenuItem onClick={() => onDialog(null, false)}>Create Folder</MenuItem>
      {open === undefined ? null : (
        <>
          <MenuItem onClick={() => onDialog(open, false)}>Edit Folder</MenuItem>
          <MenuItem onClick={() => onDialog(open, true)}>Delete Folder</MenuItem>
        </>
      )}
    </Menu>
  );
}

/** What X shows an account without folders that reaches for them: its upsell, with X's Upgrade. */
function FolderUpsell() {
  const [shown, setShown] = useState(false);
  return (
    <Popover open={shown} onOpenChange={setShown} align="start" trigger={titleButton("Bookmarks")}>
      <p className="text-[15px] leading-5 font-bold">Unlock bookmark folders with Plus</p>
      <p className="mt-1 text-[#71767b]">
        Plus and higher plans include bookmark folders. Upgrade to continue.
      </p>
      <XLink
        href={UPGRADE_URL}
        className="mt-3 inline-flex h-8 items-center rounded-full bg-foreground px-3.5 text-[14px] font-bold text-background"
      >
        Upgrade
      </XLink>
    </Popover>
  );
}

/**
 * X's bookmarks, drawn by Xtend from the engine on x.com/i/bookmarks, and one bookmark folder's
 * posts on x.com/i/bookmarks/<id> (`folder`).
 */
function BookmarksScreen() {
  const handle = AsyncResult.getOrElse(useAtomValue(settingsAtom), () => null)?.handle ?? null;
  const { folder } = Route.useSearch();
  const navigate = useNavigate();
  const engine = useAtomValue(engineAtom);
  const setOver = useAtomSet(xOverAtom);
  const { blocked, setToast } = useXPress();
  const folders = engine.bookmarkFolders;
  const listed = folders?.find((f) => f.folderId === folder);
  // X keeps folders to accounts its claims give them; until X says, its own page decides.
  const premium = engine.claims === null ? null : engine.claims.has(FOLDERS_CLAIM);
  // A folder X no longer lists (deleted here or on x.com), or no folders at all, leaves All
  // Bookmarks open, as on X.
  const open =
    folder !== undefined && premium !== false && (folders === null || listed !== undefined)
      ? folder
      : undefined;
  const url =
    open === undefined ? "https://x.com/i/bookmarks" : `https://x.com/i/bookmarks/${open}`;
  const surface = open === undefined ? "bookmarks" : bookmarkFolderSurface(open);
  // Through X's router: a page X still holds shows from its cache, and the store keeps its posts.
  const go = useCallback(() => void xGo(url), [url]);
  // "Load again": a full load of the same page, since X's router does nothing on the page it shows.
  const reload = () => void xNavigate(url);

  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) to this screen's X page while it is open.
  useEffect(go, [go]);
  const latest = useRef(go);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- keeps this screen's latest page move for after X's dialog, which X may leave on another page.
  useEffect(() => {
    latest.current = go;
  });
  const dialog = async (folderId: string | null, remove: boolean) => {
    const why = blocked();
    if (why !== null) return setToast({ text: why });
    const shown = await xFolderDialog(folderId, remove, setOver);
    if (shown === false)
      setToast({ text: "X did not open its folder dialog. Try again in a moment." });
    else if (shown) latest.current();
  };
  const name = listed?.name ?? "Bookmarks";
  // X answered with no posts in the folder: its cursors are in, its posts are not.
  const none =
    open !== undefined &&
    at(engine.lists, surface).length === 0 &&
    engine.cursors[surface] !== undefined;
  return (
    <Timeline
      surface={surface}
      keepPlace
      header={
        <XTitle
          title={
            premium === null ? (
              name
            ) : premium ? (
              <FolderMenu
                name={name}
                open={open}
                folders={folders}
                onPick={(id) =>
                  void navigate({
                    to: "/bookmarks",
                    search: id === undefined ? {} : { folder: id },
                  })
                }
                onDialog={(id, remove) => void dialog(id, remove)}
              />
            ) : (
              <FolderUpsell />
            )
          }
          detail={handle === null ? undefined : `@${handle}`}
        />
      }
      top={
        none ? (
          <div className="px-8 py-10">
            <p className="text-[31px] leading-9 font-extrabold">Save posts for later</p>
            <p className="mt-2 text-[15px] text-[#71767b]">
              Bookmark posts to easily find them again in the future.
            </p>
          </div>
        ) : undefined
      }
      empty={
        none
          ? null
          : open === undefined
            ? "Loading your bookmarks from X."
            : "Loading the folder from X."
      }
      onReopen={reload}
    />
  );
}

export const Route = createFileRoute("/bookmarks")({
  validateSearch: (s: Record<string, unknown>): { folder?: string } =>
    typeof s.folder === "string" && /^\d{1,25}$/.test(s.folder) ? { folder: s.folder } : {},
  component: BookmarksScreen,
});
