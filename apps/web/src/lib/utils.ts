import { XHandle, XId } from "@xtend/contracts";
import { type CxOptions, cx } from "class-variance-authority";
import * as Schema from "effect/Schema";
import { extendTailwindMerge } from "tailwind-merge";

// The theme's extra font sizes (index.css). Unregistered, tailwind-merge reads
// text-2xs as a colour and drops it next to text-muted-foreground.
const twMerge = extendTailwindMerge({ extend: { theme: { text: ["2xs", "3xs"] } } });

export function cn(...inputs: CxOptions) {
  return twMerge(cx(inputs));
}

const isHandle = Schema.is(XHandle);
const isPostId = Schema.is(XId);

/**
 * A handle as typed ("@levelsio ", "levelsio"), or null when X would not accept it.
 * Inputs check here so a typo is a message, not a schema error from the rpc.
 */
export const parseHandle = (text: string): string | null => {
  const handle = text.trim().replace(/^@/, "");
  return isHandle(handle) ? handle : null;
};

export const NOT_A_HANDLE = "Not an X handle: up to 15 letters, digits or underscores.";

/** A post id, or the id out of a pasted post URL (x.com/<handle>/status/<id>); null otherwise. */
export const parsePostId = (text: string): string | null => {
  const id = /\/status(?:es)?\/(\d+)/.exec(text)?.[1] ?? text.trim();
  return isPostId(id) ? id : null;
};
