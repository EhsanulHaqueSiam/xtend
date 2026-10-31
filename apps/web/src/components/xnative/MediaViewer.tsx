import { Dialog } from "@base-ui/react/dialog";
import { useAtom } from "@effect/atom-react";
import * as Atom from "effect/reactivity/Atom";
import type { EngineMedia } from "@xtend/contracts";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

/** The photo open full window, with the others of its post; null when closed. */
export const viewerAtom = Atom.make<{
  readonly media: ReadonlyArray<EngineMedia>;
  readonly index: number;
} | null>(null);

/**
 * X's photo viewer: the photo as large as the window allows, arrows (and the arrow keys) through
 * the post's others, Esc or a click outside to close. Videos stay in their own player.
 */
export function MediaViewer() {
  const [open, setOpen] = useAtom(viewerAtom);
  const photos = open?.media.filter((m) => m.kind === "photo") ?? [];
  const at = open === null ? 0 : Math.min(open.index, photos.length - 1);
  const photo = photos[at];
  const step = (by: number) =>
    open !== null && setOpen({ ...open, index: (at + by + photos.length) % photos.length });
  const nav =
    "absolute top-1/2 grid size-10 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-black/60 transition-colors duration-150 hover:bg-white/15";
  return (
    <Dialog.Root open={photo !== undefined} onOpenChange={(next) => !next && setOpen(null)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/90" />
        <Dialog.Popup
          aria-label="Photo"
          className="fixed inset-0 z-50 grid place-items-center outline-hidden"
          onClick={() => setOpen(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") step(1);
            else if (e.key === "ArrowLeft") step(-1);
          }}
        >
          {photo === undefined ? null : (
            <img
              src={photo.url.replace(/(\?|&)name=\w+/, "$1name=orig")}
              alt=""
              className="max-h-[92vh] max-w-[92vw] object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <Dialog.Close
            aria-label="Close"
            className="absolute top-3 left-3 grid size-9 cursor-pointer place-items-center rounded-full bg-black/60 transition-colors duration-150 hover:bg-white/15"
          >
            <X className="size-5" />
          </Dialog.Close>
          {photos.length > 1 ? (
            <>
              <button
                type="button"
                aria-label="Previous photo"
                className={`${nav} left-4`}
                onClick={(e) => {
                  e.stopPropagation();
                  step(-1);
                }}
              >
                <ChevronLeft className="size-5" />
              </button>
              <button
                type="button"
                aria-label="Next photo"
                className={`${nav} right-4`}
                onClick={(e) => {
                  e.stopPropagation();
                  step(1);
                }}
              >
                <ChevronRight className="size-5" />
              </button>
              <span className="absolute bottom-4 font-mono text-xs text-muted-foreground">
                {at + 1} / {photos.length}
              </span>
            </>
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
