import "./styles.css";

import {
  assetsOf,
  detect,
  latest,
  RELEASES,
  TARGETS,
  withArch,
  type Channel,
  type Release,
  type Target,
} from "./release.ts";

// The page works without this script: every link already points at the releases page.
const all = <E extends Element = HTMLElement>(selector: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll<E>(selector));

interface UAData {
  readonly getHighEntropyValues?: (hints: Array<string>) => Promise<{ architecture?: string }>;
}
const uaData = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;

let target = detect(navigator.userAgent, navigator.platform);
let channel: Channel = "stable";
const releases: Partial<Record<Channel, Promise<Release | undefined>>> = {};

function render(release: Release | undefined) {
  const assets = release === undefined ? {} : assetsOf(release);
  const fallback = release?.html_url ?? (channel === "stable" ? `${RELEASES}/latest` : RELEASES);
  const yours = assets[target];

  for (const el of all(".js-for")) el.textContent = ` for ${TARGETS[target].os}`;
  for (const el of all(".js-chip")) el.textContent = TARGETS[target].chip;
  // The page's own download buttons always offer stable; only the grid follows the channel.
  if (channel === "stable")
    for (const a of all<HTMLAnchorElement>(".js-download"))
      a.href = yours?.browser_download_url ?? fallback;
  for (const a of all<HTMLAnchorElement>("[data-t]")) {
    const t = a.dataset.t as Target;
    const asset = assets[t];
    a.classList.toggle("you", t === target);
    a.href = asset?.browser_download_url ?? fallback;
    const fn = a.querySelector(".fn");
    const go = a.querySelector(".go");
    // Before the API answers, the placeholder names stay; after, a missing build says so.
    if (fn && release !== undefined) fn.textContent = asset?.name ?? "Not in this release yet";
    if (go) go.textContent = asset === undefined && release !== undefined ? "Release" : "Download";
  }
  for (const el of all(".js-ver"))
    el.textContent = release === undefined ? "" : `Version ${release.tag_name.replace(/^v/, "")}. `;
}

async function show(next: Channel) {
  channel = next;
  for (const b of all("[data-chan]"))
    b.setAttribute("aria-pressed", String(b.dataset.chan === next));
  render(undefined);
  const release = await (releases[next] ??= latest(next));
  if (channel === next) render(release);
}

for (const b of all("[data-chan]"))
  b.addEventListener("click", () => show(b.dataset.chan as Channel));
show("stable");

uaData
  ?.getHighEntropyValues?.(["architecture"])
  .then(({ architecture }) => {
    if (architecture === undefined || architecture === "") return;
    target = withArch(target, architecture);
    releases[channel]?.then((release) => render(release));
  })
  .catch(() => undefined);

// The tour: one window whose sidebar, screen and caption swap with the tab.
const tabs = all<HTMLButtonElement>('[role="tab"]');
const panel = document.getElementById("tour-panel");
function select(tab: HTMLButtonElement, focus: boolean) {
  const pane = tab.dataset.pane;
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
  }
  if (panel === null) return;
  panel.setAttribute("aria-labelledby", tab.id);
  for (const el of all("[data-pane]", panel)) el.hidden = el.dataset.pane !== pane;
  for (const el of all("[data-tool]", panel)) el.classList.toggle("on", el.dataset.tool === pane);
  panel
    .querySelector(".js-tour")
    ?.setAttribute("aria-label", `Xtend's ${tab.textContent?.trim()} screen`);
  if (focus) tab.focus();
}
tabs.forEach((tab, i) => {
  tab.addEventListener("click", () => select(tab, false));
  tab.addEventListener("keydown", (event) => {
    const last = tabs.length - 1;
    const index = new Map([
      ["ArrowRight", i === last ? 0 : i + 1],
      ["ArrowLeft", i === 0 ? last : i - 1],
      ["Home", 0],
      ["End", last],
    ]).get(event.key);
    const to = index === undefined ? undefined : tabs[index];
    if (to === undefined) return;
    event.preventDefault();
    select(to, true);
  });
});
