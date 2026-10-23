import { createContext, use, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** The element over X's right column, when the center slot is wide; null otherwise. */
export const CompanionTarget = createContext<HTMLElement | null>(null);

/**
 * A page's companion cards (preview, assist, context). In a wide center slot they move into
 * X's right column, beside the page; anywhere else they follow the page's content.
 */
export function Companion({ children }: { readonly children: ReactNode }) {
  const target = use(CompanionTarget);
  return target === null ? (
    <div className="flex flex-col gap-4 border-t border-border p-4">{children}</div>
  ) : (
    createPortal(children, target)
  );
}
