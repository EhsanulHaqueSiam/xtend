import { Menu } from "@base-ui/react/menu";
import { useAtomMount, useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import type { SlotKind } from "../../desktopBridge";
import { cn } from "../../lib/utils";
import { sessionUrlAtom, slotAtom } from "../../state/shell";
import { shellBridge } from "./bridge";
import { GlanceSync } from "./GlanceSync";

interface Tab {
  readonly to: string;
  readonly label: string;
}

const TABS: ReadonlyArray<Tab> = [
  { to: "/plan", label: "Plan" },
  { to: "/compose", label: "Compose" },
  { to: "/engage", label: "Engage" },
  { to: "/leads", label: "Leads" },
  { to: "/library", label: "Library" },
  { to: "/scores", label: "Scores" },
];
const MORE: ReadonlyArray<Tab> = [
  { to: "/analyze", label: "Analyze" },
  { to: "/automate", label: "Automate" },
  { to: "/seen", label: "Seen" },
  { to: "/settings", label: "Settings" },
];

const isOn = (pathname: string, tab: Tab) =>
  pathname === tab.to || pathname.startsWith(`${tab.to}/`);

const tabClass = (on: boolean) =>
  cn(
    "relative flex flex-1 cursor-pointer items-center justify-center text-[15px] text-muted-foreground outline-hidden transition-colors duration-100 hover:bg-accent focus-visible:bg-accent",
    on && "font-bold text-foreground",
  );

/** X's active tab marker: 56px, 4px, rounded, blue. */
const Underline = () => (
  <span className="absolute bottom-0 left-1/2 h-1 w-14 -translate-x-1/2 rounded-sm bg-primary" />
);

/** Center pages: X's page header and tab row, hairlines on both sides like X's column. */
function CenterFrame({ children }: { readonly children: ReactNode }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const open = (route: string) => shellBridge()?.openSlot({ kind: "center", route });
  const moreOn = MORE.some((tab) => isOn(pathname, tab));
  return (
    <div className="flex h-full flex-col border-x border-border bg-background">
      <header className="flex h-[53px] shrink-0 items-center gap-6 bg-black/65 px-4 backdrop-blur-md">
        <button
          type="button"
          aria-label="Back"
          className="-ml-2 flex size-9 cursor-pointer items-center justify-center rounded-full text-foreground hover:bg-accent"
          onClick={() => shellBridge()?.closeSlot({ kind: "center" })}
        >
          <ArrowLeft className="size-5" />
        </button>
        <h1 className="text-xl font-bold">Xtend</h1>
      </header>
      <nav className="flex h-[53px] shrink-0 border-b border-border">
        {TABS.map((tab) => {
          const on = isOn(pathname, tab);
          return (
            <button
              key={tab.to}
              type="button"
              aria-current={on ? "page" : undefined}
              className={tabClass(on)}
              onClick={() => open(tab.to)}
            >
              {tab.label}
              {on ? <Underline /> : null}
            </button>
          );
        })}
        <Menu.Root>
          <Menu.Trigger className={tabClass(moreOn)}>
            More
            {moreOn ? <Underline /> : null}
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="end" sideOffset={2} className="z-50">
              <Menu.Popup className="min-w-40 rounded-xl border border-border bg-background py-1 shadow-[0_0_15px_rgba(255,255,255,0.2)] outline-hidden">
                {MORE.map((tab) => (
                  <Menu.Item
                    key={tab.to}
                    className="cursor-pointer px-4 py-2.5 text-[15px] text-foreground outline-hidden data-highlighted:bg-accent"
                    onClick={() => open(tab.to)}
                  >
                    {tab.label}
                  </Menu.Item>
                ))}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </nav>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

/** Floating slots keep the page transparent and draw a ringed panel; the padding leaves room for the shadow. */
const PANEL: Record<Exclude<SlotKind, "center">, string> = {
  palette: "h-full overflow-hidden rounded-xl bg-background ring-1 ring-border shadow-2xl",
  bar: "h-full bg-background border-b border-border",
  popover:
    "m-2 h-[calc(100%-16px)] overflow-hidden rounded-xl bg-background ring-1 ring-border shadow-2xl",
  sheet:
    "mx-2 mt-2 h-[calc(100%-8px)] overflow-hidden rounded-t-2xl bg-background ring-1 ring-border shadow-2xl",
  toast:
    "m-2 h-[calc(100%-16px)] overflow-hidden rounded-xl bg-background ring-1 ring-border shadow-2xl",
};

/**
 * Desktop shell: the app is one view that main moves between slots over x.com,
 * so there is no sidebar. The frame follows the slot kind and the route follows
 * what main asked for.
 */
export function SlotShell({ children }: { readonly children: ReactNode }) {
  const slot = useAtomValue(slotAtom);
  useAtomMount(sessionUrlAtom);
  const navigate = useNavigate();
  useEffect(() => {
    if (slot.kind !== null) void navigate({ href: slot.route });
  }, [navigate, slot]);
  // Hidden is invisible, so which frame it keeps does not matter; center is the common one.
  const kind = slot.kind ?? "center";
  return (
    <>
      <GlanceSync />
      {kind === "center" ? (
        <CenterFrame>{children}</CenterFrame>
      ) : (
        <div className={PANEL[kind]}>{children}</div>
      )}
    </>
  );
}
