import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useEffect } from "react";

import { errorMessage } from "../library/shared";

interface Toast {
  readonly text: string;
  /** Reverses the action through the service; the toast then says so. */
  readonly undo?: () => Promise<unknown>;
}

/** The one toast on screen; a new one replaces it. */
export const toastAtom = Atom.make<Toast | null>(null);

const SHOWN_MS = 4000;

/** One white pill at the bottom centre: the result of a drop or a quick action, with Undo. */
export function Toasts() {
  const toast = useAtomValue(toastAtom);
  const setToast = useAtomSet(toastAtom);
  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), SHOWN_MS);
    return () => clearTimeout(timer);
  }, [toast, setToast]);
  if (toast === null) return null;
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center"
    >
      <div className="pointer-events-auto flex h-8 items-center gap-3 rounded-full bg-foreground pr-1.5 pl-3.5 text-[13px] font-medium text-background shadow-lg transition-[transform,opacity] duration-200 ease-out starting:translate-y-2 starting:opacity-0">
        {toast.text}
        {toast.undo !== undefined ? (
          <button
            type="button"
            className="h-6 cursor-pointer rounded-full bg-background/10 px-2.5 text-xs hover:bg-background/20"
            onClick={() => {
              const undo = toast.undo!;
              setToast({ text: "Undoing" });
              void undo().then(
                () => setToast({ text: "Undone" }),
                (e: unknown) => setToast({ text: errorMessage(e) }),
              );
            }}
          >
            Undo
          </button>
        ) : null}
      </div>
    </div>
  );
}
