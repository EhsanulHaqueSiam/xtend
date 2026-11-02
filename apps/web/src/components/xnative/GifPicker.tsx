import { Dialog } from "@base-ui/react/dialog";
import { useAtomValue } from "@effect/atom-react";
import type { EngineGif } from "@xtend/contracts";
import { ArrowLeft, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { VirtuosoGrid } from "react-virtuoso";

import { at, engineAtom, gifSurface } from "../../state/engine";
import { xGifClose, xGifMore, xGifSearch } from "../../state/x";
import { Switch } from "../ui/switch";

/**
 * X's GIF picker over Home's box. The engine opens X's own GIF search and types the query there,
 * so the tiles are what X sends for it, paged as X pages; leaving the picker leaves X's search.
 * A pick only fills the box: X's tile is pressed by the desktop, for the user's Post.
 */
export function GifPicker({
  onPick,
  onClose,
}: {
  readonly onPick: (gif: EngineGif, query: string) => void;
  readonly onClose: () => void;
}) {
  const engine = useAtomValue(engineAtom);
  const [query, setQuery] = useState("");
  // Null until X's search shows: false when it never did.
  const [shown, setShown] = useState<boolean | null>(null);
  const [autoplay, setAutoplay] = useState(true);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- holds X's GIF search open in the engine while the picker is mounted.
  useEffect(() => {
    void xGifSearch("").then(setShown);
    return () => void xGifClose();
  }, []);

  const surface = gifSurface(query);
  const gifs = at(engine.gifs, surface);
  const answered = engine.cursors[surface] !== undefined;
  const more = engine.cursors[surface]?.bottom != null;
  const note =
    shown === false
      ? "X's GIF search did not open. Close this and try again."
      : gifs.length > 0 || query === ""
        ? null
        : answered
          ? `No results for "${query}"`
          : "Loading from X";

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-[#5b7083]/40" />
        <Dialog.Popup
          aria-label="Choose a GIF"
          className="fixed top-[5vh] left-1/2 z-50 flex w-[600px] max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl bg-black outline-hidden"
        >
          <div className="flex items-center gap-3 px-3 py-2">
            <Dialog.Close
              aria-label="Back"
              className="grid size-[34px] shrink-0 cursor-pointer place-items-center rounded-full transition-colors duration-150 hover:bg-white/10"
            >
              <ArrowLeft className="size-5" />
            </Dialog.Close>
            <label className="flex h-10 flex-1 items-center gap-3 rounded-full border border-border px-4 focus-within:border-[#1d9bf0]">
              <Search className="size-4 shrink-0 text-[#71767b]" />
              <input
                aria-label="Search for GIFs"
                placeholder="Search for GIFs"
                autoFocus
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-hidden placeholder:text-[#71767b]"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  void xGifSearch(e.target.value);
                }}
              />
            </label>
          </div>
          {note === null ? (
            <VirtuosoGrid
              // Virtuoso's own inline height (100%) would beat a class: the dialog has none to fill.
              style={{ height: 520 }}
              className="max-h-[70vh]"
              data={gifs}
              computeItemKey={(_, g) => g.id}
              listClassName="grid grid-cols-3 gap-0.5"
              // The grid's endReached never fires here; its last tile in view is the end of X's list.
              rangeChanged={({ endIndex }) => {
                if (more && endIndex === gifs.length - 1) void xGifMore();
              }}
              itemContent={(_, g) => (
                <button
                  type="button"
                  aria-label={`${g.altText ?? ""} GIF`.trim()}
                  className="block h-[140px] w-full cursor-pointer bg-white/7"
                  onClick={() => onPick(g, query)}
                >
                  <img
                    src={autoplay ? g.url : (g.stillUrl ?? g.url)}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover"
                  />
                </button>
              )}
            />
          ) : (
            <p className="h-[520px] max-h-[70vh] px-4 py-8 text-center text-[15px] text-[#71767b]">
              {note}
            </p>
          )}
          <label className="flex items-center justify-between border-t border-border px-4 py-3 text-[15px]">
            Auto-play GIFs
            <Switch checked={autoplay} onChange={setAutoplay} label="Auto-play GIFs" />
          </label>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
