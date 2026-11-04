import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useRouter } from "@tanstack/react-router";
import { ArrowDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import {
  advance,
  armed,
  type Gesture,
  IDLE,
  progress,
  release,
  type WheelAction,
  WHEEL_PAUSE_MS,
} from "../../lib/wheelGesture";
import { type AnySurface, engineAtom, resetSurface, updateEngine } from "../../state/engine";
import { spaceDockAtom } from "../../state/spaces";
import { loadNewPosts, setScreenRefresh } from "../../state/x";
import { DayGlance } from "../shell/HomeCompanion";
import { MediaViewer } from "./MediaViewer";
import { QuoteComposer } from "./QuoteComposer";
import { SpaceDock } from "./SpaceDock";

/** The element that scrolls an X screen; lists inside virtualize against it. */
const ScrollParent = createContext<HTMLElement | null>(null);
export const useXScrollParent = () => useContext(ScrollParent);

// A browser draws its own swipe and pull. Sideways swipes follow macOS's "Swipe between pages".
const GESTURES = isElectron;
const SWIPES = window.desktopBridge?.swipeNavigation !== false;
const COLUMN_SHIFT_PX = 64;
const PULL_ROW_PX = 44;

// One gesture for the whole app: momentum that outlives a Back must not go back again on the
// screen it lands on, whose column is a new one.
let gesture: Gesture = IDLE;
let pause: ReturnType<typeof setTimeout> | undefined;

/** A menu, a dialog or a row that scrolls sideways keeps the gesture for itself. */
const keepsGesture = (target: EventTarget | null, scroller: HTMLElement) => {
  if (!(target instanceof Element)) return false;
  if (target.closest('[role="menu"], [role="dialog"]')) return true;
  for (let el: Element | null = target; el !== null && el !== scroller; el = el.parentElement)
    if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX))
      return true;
  return false;
};

/**
 * Two fingers sideways go back or forward with the column following them, and two fingers down
 * at the top of a list load newer posts, as X's apps and the Mac's own pages do.
 */
function useWheelGestures(
  scroller: HTMLElement | null,
  page: RefObject<HTMLElement | null>,
  arrow: RefObject<HTMLElement | null>,
  pull: RefObject<HTMLElement | null>,
  refreshes: boolean,
) {
  const router = useRouter();
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- listens to the column's wheel events while it shows.
  useEffect(() => {
    if (!GESTURES || scroller === null) return;
    const draw = () => {
      const p = progress(gesture);
      const on = armed(gesture);
      const action = gesture.kind === "drag" ? gesture.action : null;
      const sideways = action === "back" || action === "forward";
      const shift = sideways ? (action === "back" ? 1 : -1) * p * COLUMN_SHIFT_PX : 0;
      if (page.current !== null) {
        page.current.style.transform = shift === 0 ? "" : `translateX(${shift}px)`;
        page.current.style.transition = sideways ? "none" : "transform 150ms ease-out";
      }
      if (arrow.current !== null) {
        // Centred in the gap the page leaves at the main area's edge, halfway down.
        const area = scroller.getBoundingClientRect();
        arrow.current.hidden = !sideways;
        arrow.current.dataset.side = action ?? "";
        arrow.current.dataset.armed = String(on);
        arrow.current.style.left = `${action === "back" ? area.left + shift / 2 : area.right + shift / 2}px`;
        arrow.current.style.top = `${area.top + area.height / 2}px`;
      }
      if (pull.current !== null) {
        pull.current.style.height = `${action === "refresh" ? Math.round(p * PULL_ROW_PX) : 0}px`;
        pull.current.dataset.armed = String(on);
        const label = pull.current.querySelector("span");
        if (label !== null) label.textContent = on ? "Release to refresh" : "Pull to refresh";
      }
    };
    const act = (action: WheelAction) =>
      action === "refresh"
        ? loadNewPosts()
        : action === "back"
          ? router.history.back()
          : router.history.forward();
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return; // a pinch zooms
      if (gesture.kind === "idle" && keepsGesture(event.target, scroller))
        gesture = { kind: "scroll" };
      const next = advance(gesture, {
        dx: event.deltaX,
        dy: event.deltaY,
        atTop: scroller.scrollTop <= 0,
        can: {
          back: SWIPES && window.navigation.canGoBack,
          forward: SWIPES && window.navigation.canGoForward,
          refresh: refreshes,
        },
      });
      gesture = next.gesture;
      // Pushing back up during a pull shrinks it rather than scrolling the list.
      if (gesture.kind === "drag" && gesture.action === "refresh") event.preventDefault();
      draw();
      if (next.fire !== undefined) act(next.fire);
      clearTimeout(pause);
      pause = setTimeout(() => {
        const action = release(gesture);
        gesture = IDLE;
        draw();
        if (action !== null) act(action);
      }, WHEEL_PAUSE_MS);
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, [scroller, page, arrow, pull, refreshes, router]);
}

/**
 * X's own reading shape: one 600px column between hairlines, and Xtend's rail beside it (the
 * screen's own panels, then the day at a glance, or the Space the user opened). The
 * whole area scrolls, as X's page does, so the wheel works over the rail too; the column header
 * and the rail stay put. When the main area is narrower than both, the rail folds away.
 */
export function XColumn({
  header,
  float,
  rail,
  docked = true,
  refresh,
  children,
}: {
  /**
   * What ⌘R or F5 does here, as reloading x.com would: the screen's lists empty and its page
   * loads from X again in full, so X sends it fresh in X's own order.
   */
  readonly refresh?: {
    readonly surfaces: ReadonlyArray<AnySurface>;
    readonly load: () => void;
    /** Shows posts already waiting behind the pill; false when none wait, so X is asked. */
    readonly showNew?: () => boolean;
  };
  readonly header: ReactNode;
  /** Floats just under the header while the column scrolls, as X's "Show N posts" does. */
  readonly float?: ReactNode;
  readonly rail?: ReactNode;
  /** False where the screen is the Space itself, which the dock would only repeat. */
  readonly docked?: boolean;
  readonly children: ReactNode;
}) {
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const setEngine = useAtomSet(engineAtom);
  const dock = useAtomValue(spaceDockAtom);
  const space = docked ? dock : null;
  const latest = useRef(refresh);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- keeps the latest refresh callback for the screen-refresh registration below, without re-registering.
  useEffect(() => {
    latest.current = refresh;
  });
  const refreshes = refresh !== undefined;
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- registers this screen's refresh with the global refresh hotkey, released on unmount.
  useEffect(() => {
    if (!refreshes) return;
    return setScreenRefresh((mode) => {
      const r = latest.current;
      if (r === undefined) return;
      scroller?.scrollTo({ top: 0 });
      if (mode === "new" && r.showNew?.() === true) return;
      setEngine(updateEngine((s) => r.surfaces.reduce(resetSurface, s)));
      r.load();
    });
  }, [refreshes, scroller, setEngine]);
  const page = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLDivElement>(null);
  const pull = useRef<HTMLDivElement>(null);
  useWheelGestures(scroller, page, arrow, pull, refreshes);
  return (
    <div
      ref={setScroller}
      // The engine benchmark scrolls lists through this hook, as it did Virtuoso's own scroller.
      data-virtuoso-scroller
      className="@container h-full min-h-0 overflow-y-auto [overflow-anchor:none]"
    >
      <div ref={page} className="flex min-h-full justify-center gap-7 px-4">
        <section
          data-x="column"
          className="relative flex min-h-full w-full max-w-[600px] min-w-0 flex-col border-x border-border"
        >
          <div
            className={cn(
              "sticky top-0 z-20 border-b border-border bg-black/90 backdrop-blur-md",
              isElectron && "drag-region",
            )}
          >
            {header}
            {float === undefined || float === null ? null : (
              <div className="no-drag absolute top-full left-1/2 mt-3 -translate-x-1/2">
                {float}
              </div>
            )}
          </div>
          {GESTURES && refreshes ? (
            <div
              ref={pull}
              aria-hidden="true"
              data-armed="false"
              className="group flex h-0 shrink-0 items-center justify-center gap-1.5 overflow-hidden text-[13px] text-[#71767b] data-[armed=true]:text-foreground"
            >
              <ArrowDown className="size-3.5 group-data-[armed=true]:rotate-180" />
              <span>Pull to refresh</span>
            </div>
          ) : null}
          <ScrollParent value={scroller}>{children}</ScrollParent>
          <MediaViewer />
          <QuoteComposer />
        </section>
        <aside className="sticky top-0 flex h-fit w-[340px] shrink-0 flex-col gap-4 py-3 @max-[1000px]:hidden">
          {/* X docks an open Space in its right column, in place of what the column holds. */}
          {space === null ? (
            <>
              {rail}
              {/* Xtend's day beside every X screen, where X keeps its own right column. */}
              <section className="rounded-2xl border border-white/[0.12] px-4 pt-1 pb-0 [&>a:first-child]:border-t-0">
                <DayGlance />
              </section>
            </>
          ) : (
            <SpaceDock spaceId={space} />
          )}
        </aside>
      </div>
      {GESTURES ? (
        <div
          ref={arrow}
          hidden
          aria-hidden="true"
          data-armed="false"
          className="group pointer-events-none fixed z-30 grid size-9 -translate-1/2 place-items-center text-[#71767b] data-[armed=true]:text-foreground"
        >
          <ChevronLeft className="size-5 group-data-[side=forward]:hidden group-data-[armed=true]:size-6" />
          <ChevronRight className="hidden size-5 group-data-[side=forward]:block group-data-[armed=true]:size-6" />
        </div>
      ) : null}
    </div>
  );
}

/** The column's title row: an optional back button, the title and a muted line under it. */
export function XTitle({
  title,
  detail,
  onBack,
  actions,
}: {
  readonly title: ReactNode;
  readonly detail?: ReactNode;
  readonly onBack?: (() => void) | undefined;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-[53px] items-center gap-6 px-4">
      {onBack === undefined ? null : (
        <button
          type="button"
          aria-label="Back"
          className="no-drag -m-2 grid size-9 shrink-0 cursor-pointer place-items-center rounded-full transition-colors duration-150 hover:bg-white/10"
          onClick={onBack}
        >
          <svg
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M19 12H5M11 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[19px] leading-6 font-bold tracking-[-0.01em]">{title}</h1>
        {detail === undefined ? null : (
          <p className="truncate text-[13px] text-[#71767b]">{detail}</p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="no-drag flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

/**
 * X's search bar atop a search page: Back, the rounded box (`label` names it, `placeholder` is
 * X's hint in it), and the page's own buttons after it. Enter runs `onSubmit` with what was typed.
 */
export function XSearchBar({
  label,
  placeholder = "Search",
  value,
  onChange,
  onSubmit,
  onBack,
  children,
}: {
  readonly label: string;
  readonly placeholder?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onBack: () => void;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 px-4 pt-1.5 pb-1">
      <button
        type="button"
        aria-label="Back"
        className="no-drag -m-2 grid size-9 shrink-0 cursor-pointer place-items-center rounded-full transition-colors duration-150 hover:bg-white/10"
        onClick={onBack}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M19 12H5M11 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <form
        className="no-drag flex h-[42px] flex-1 items-center gap-3 rounded-full border border-transparent bg-[#202327] px-4 focus-within:border-[#1d9bf0] focus-within:bg-black"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <Search className="size-4 shrink-0 text-[#71767b]" />
        <input
          autoFocus={value === ""}
          aria-label={label}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-hidden placeholder:text-[#71767b]"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </form>
      {children}
    </div>
  );
}

/**
 * X's tab row: plain words, the open one bold with a short blue bar under it. A few tabs share
 * the width; many scroll sideways, as X's pinned lists do.
 */
export function XTabs<Id extends string>({
  label,
  tabs,
  value,
  onChange,
}: {
  readonly label: string;
  readonly tabs: ReadonlyArray<{ readonly id: Id; readonly label: string }>;
  readonly value: Id;
  readonly onChange: (id: Id) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="no-drag flex overflow-x-auto [scrollbar-width:none]"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          className="group flex h-[53px] min-w-fit flex-1 cursor-pointer justify-center px-4 text-[15px] text-[#71767b] transition-colors duration-150 hover:bg-white/[0.06] aria-selected:font-bold aria-selected:text-foreground"
          onClick={() => onChange(t.id)}
        >
          <span className="flex flex-col justify-between pt-4 whitespace-nowrap">
            {t.label}
            <span className="h-1 rounded-full group-aria-selected:bg-[#1d9bf0]" />
          </span>
        </button>
      ))}
    </div>
  );
}
