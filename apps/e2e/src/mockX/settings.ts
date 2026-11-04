/**
 * Mock X's settings pages as X's own components draw them (bundle.Settings, SettingsRevamp,
 * SettingsInternals; strings from X's i18n en chunk): the detail section X labels by its header,
 * link rows, <label> checkboxes, and X's REST writes for each change (client.ts sends them from
 * the `data-mock-write` on a checkbox). Values live in `MockSettings`.
 */

export type MockSettings = Record<string, boolean>;

/** What a fresh mock account has set, by X's own field names. */
export const mockSettings = (): MockSettings => ({
  protected: false,
  protected_videos: false,
  universal_quality_filtering: true,
  filter_not_following: false,
  filter_not_followed_by: false,
  filter_new_users: true,
  filter_default_profile_image: true,
  filter_no_confirmed_email: false,
  filter_no_confirmed_phone: false,
  optInFiltering: true,
  optInBlocking: true,
});

const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

const page = (title: string, body: string) =>
  `<section aria-labelledby="detail-header" role="region"><div><div><button data-testid="app-bar-back" aria-label="Back">←</button></div><div><h2 id="detail-header" role="heading" aria-level="2" dir="ltr"><span>${title}</span></h2><div dir="ltr"><span>@mock</span></div></div></div><div>${body}</div></section>`;
const link = (label: string, href: string, description = "") =>
  `<a href="${href}" role="tab" data-testid="pivot"><div><div dir="ltr"><span>${label}</span></div>${description === "" ? "" : `<div dir="ltr" data-testid="pivot-description"><span>${esc(description)}</span></div>`}</div></a>`;
const text = (t: string) => `<div dir="ltr"><span>${esc(t)}</span></div>`;
const heading = (t: string) =>
  `<div role="heading" aria-level="2"><div dir="ltr"><span>${esc(t)}</span></div></div>`;

/**
 * A checkbox X saves through `write` (`<REST path>:<field>`), as X's SettingsCheckbox draws it.
 * `confirm` is X's confirm sheet before turning it on (Protect your posts?).
 */
const check = (
  s: MockSettings,
  field: string,
  write: string,
  label: string,
  help = "",
  confirm?: { readonly title: string; readonly body: string; readonly yes: string },
) =>
  `<div><label><div><div dir="ltr"><span>${esc(label)}</span></div><div><div></div><input type="checkbox" data-mock-write="${write}:${field}"${confirm === undefined ? "" : ` data-mock-confirm="${esc(JSON.stringify(confirm))}"`}${s[field] === true ? " checked" : ""}></div></div>${help === "" ? "" : text(help)}</label></div>`;

// oxlint-disable-next-line xtend/no-em-dash-copy -- X's own words, as its i18n en chunk spells them.
const FILTERS_ABOUT = "Choose the notifications you’d like to see — and those you don’t.";
const ACCOUNT = "/i/api/1.1/account/settings.json";
const FILTERS = "/i/api/1.1/mutes/advanced_filters.json";
const SEARCH = "/i/api/1.1/strato/column/User/1700000000000000001/search/searchSafety";

/** Mock X's settings page at `path` as HTML, or undefined for one it does not draw. */
export function settingsPage(s: MockSettings, path: string): string | undefined {
  switch (path) {
    case "/settings/account":
      return page(
        "Your Account",
        text(
          "See information about your account, download an archive of your data, or learn about your account deactivation options",
        ) +
          link(
            "Account information",
            "/settings/your_twitter_data/account",
            "See your account information like your phone number and email address.",
          ) +
          link("Change your password", "/settings/password", "Change your password at any time.") +
          link(
            "Deactivate your account",
            "/settings/deactivate",
            "Find out how you can deactivate your account.",
          ),
      );
    case "/settings/your_twitter_data/account":
      // X asks for the password before it shows the account's details.
      return page(
        "Account information",
        heading("Confirm your password") +
          text("Please enter your password in order to get this.") +
          `<label><span>Password</span><input type="password" name="current_password"></label><button>Confirm</button>`,
      );
    case "/settings/password":
      return page(
        "Change your password",
        `<label><span>Current password</span><input type="password" name="current_password"></label><button>Save</button>`,
      );
    case "/settings/privacy_and_safety":
      return page(
        "Privacy and safety",
        heading("Your X activity") +
          link(
            "Audience, media and tagging",
            "/settings/audience_and_tagging",
            "Manage what information you allow other people on X to see.",
          ) +
          link(
            "Content you see",
            "/settings/content_you_see",
            "Decide what you see on X based on your preferences like Topics and interests",
          ),
      );
    case "/settings/audience_and_tagging":
      return page(
        "Audience, media and tagging",
        text("Manage what information you allow other people on X to see.") +
          check(
            s,
            "protected",
            ACCOUNT,
            "Protect your posts",
            "When selected, your posts and other account information are only visible to people who follow you.",
            {
              title: "Protect your posts?",
              body: "This will make them visible only to your X followers.",
              yes: "Protect",
            },
          ) +
          check(
            s,
            "protected_videos",
            "/i/api/graphql/oe9_UzzuQUeSU4qYVtMwQg/AudienceAndTaggingAllowVideoDownloadsMutation",
            "Protect your videos",
            "If selected, videos in your posts will not be downloadable by default. This setting applies to posts going forward and is not retroactive",
          ) +
          link("Photo tagging", "/settings/tagging", "Anyone can tag you"),
      );
    case "/settings/content_you_see":
      return page(
        "Content you see",
        text("Decide what you see on X based on your preferences like interests") +
          link("Explore settings", "/settings/explore") +
          link("Search settings", "/settings/search"),
      );
    case "/settings/search":
      return page(
        "Search settings",
        check(
          s,
          "optInFiltering",
          SEARCH,
          "Hide sensitive content",
          "This prevents posts with potentially sensitive content from displaying in your search results.",
        ) +
          check(
            s,
            "optInBlocking",
            SEARCH,
            "Remove blocked and muted accounts",
            "Use this to eliminate search results from accounts you’ve blocked or muted.",
          ),
      );
    case "/settings/notifications":
      return page(
        "Notifications",
        text(
          "Select the kinds of notifications you get about your activities, interests, and recommendations.",
        ) +
          link("Filters", "/settings/notifications/filters", FILTERS_ABOUT) +
          link(
            "Preferences",
            "/settings/notifications/preferences",
            "Select your preferences by notification type.",
          ),
      );
    case "/settings/notifications/filters":
      return page(
        "Filters",
        text(FILTERS_ABOUT) +
          check(
            s,
            "universal_quality_filtering",
            ACCOUNT,
            "Quality filter",
            "Choose to filter out content such as duplicate or automated posts. This doesn’t apply to notifications from accounts you follow or have interacted with recently.",
          ) +
          link("Muted notifications", "/settings/notifications/advanced_filters"),
      );
    case "/settings/notifications/advanced_filters":
      return page(
        "Muted notifications",
        heading("Mute notifications from people:") +
          check(s, "filter_not_following", FILTERS, "You don’t follow") +
          check(s, "filter_not_followed_by", FILTERS, "Who don’t follow you") +
          check(s, "filter_new_users", FILTERS, "With a new account") +
          check(s, "filter_default_profile_image", FILTERS, "Who have a default profile photo") +
          check(s, "filter_no_confirmed_email", FILTERS, "Who haven’t confirmed their email") +
          check(
            s,
            "filter_no_confirmed_phone",
            FILTERS,
            "Who haven’t confirmed their phone number",
          ),
      );
  }
  return undefined;
}

// X's settings writes, by the path X's page sends each to.
const WRITES =
  /^\/i\/api\/(?:1\.1\/(account\/settings|mutes\/advanced_filters)\.json|1\.1\/strato\/column\/User\/\d+\/search\/(searchSafety)|graphql\/[^/]+\/(AudienceAndTaggingAllowVideoDownloadsMutation))$/;

/** Which of X's settings writes a POST to `pathname` is, or undefined for any other call. */
export const settingWrite = (pathname: string) => {
  const m = WRITES.exec(pathname);
  return m === null ? undefined : (m[1] ?? m[2] ?? m[3])!;
};

/**
 * Applies one of X's settings writes as X sends it (`field` in the form, the search safety body,
 * the video downloads mutation's variable), answering as X does.
 */
export function writeSetting(s: MockSettings, name: string, input: Record<string, unknown>) {
  const flag = (v: unknown) => v === true || v === "true" || v === "enabled";
  if (name === "AudienceAndTaggingAllowVideoDownloadsMutation") {
    const vars = (input.variables ?? {}) as Record<string, unknown>;
    s.protected_videos = !flag(vars.isAllowed);
    return { data: { user_preferences_put: "Done" } };
  }
  for (const [k, v] of Object.entries(input)) if (k in s) s[k] = flag(v);
  return name === "mutes/advanced_filters"
    ? Object.fromEntries(Object.entries(s).filter(([k]) => k.startsWith("filter_")))
    : name === "searchSafety"
      ? { optInFiltering: s.optInFiltering, optInBlocking: s.optInBlocking }
      : {
          protected: s.protected,
          universal_quality_filtering: s.universal_quality_filtering ? "enabled" : "disabled",
        };
}
