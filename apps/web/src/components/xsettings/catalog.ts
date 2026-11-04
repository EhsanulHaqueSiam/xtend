/**
 * X's settings, as X's own Settings lists and searches them (bundle.Settings and its search
 * index, strings from X's i18n en chunk): the sections Xtend's sidebar shows under Settings, and
 * the pages Settings search finds without loading any of them. X's page draws the rest itself.
 */

export interface XSettingsPage {
  readonly title: string;
  readonly path: string;
  /** X's other words for it, which its own search matches too. */
  readonly synonyms?: ReadonlyArray<string>;
}

/**
 * X's settings sections, in the order of X's Settings list, under the ids of their sidebar rows.
 * `path` is X's page for the section; a section that is X's own page opens it over the main area.
 */
export const X_SECTIONS = [
  {
    id: "x-account",
    label: "Your account",
    path: "/settings/account",
    pages: [
      { title: "Account information", path: "/settings/your_twitter_data/account" },
      {
        title: "Password reset",
        path: "/settings/password",
        synonyms: ["Change your password"],
      },
      { title: "Email", path: "/settings/email" },
      { title: "Country", path: "/settings/country" },
      { title: "Automation", path: "/settings/account/automation" },
      { title: "Parody label", path: "/settings/account/parody" },
      { title: "Download an archive of your data", path: "/settings/download_your_data" },
      { title: "Your X data", path: "/settings/your_twitter_data" },
      { title: "Deactivate your account", path: "/settings/deactivate" },
    ],
  },
  {
    id: "x-security",
    label: "Security and account access",
    path: "/settings/security_and_account_access",
    pages: [
      { title: "Security", path: "/settings/security" },
      { title: "Two-factor authentication", path: "/settings/account/login_verification" },
      { title: "Manage passkeys", path: "/settings/account/passkey" },
      {
        title: "Manage security keys",
        path: "/settings/account/login_verification/security_keys",
      },
      { title: "ID verification", path: "/settings/account/id_verification" },
      { title: "Apps and sessions", path: "/settings/apps_and_sessions" },
      { title: "Connected accounts", path: "/settings/connected_accounts" },
      { title: "Registered devices", path: "/settings/direct_messages/devices" },
      { title: "Delegate", path: "/settings/delegate" },
      { title: "Members you’ve delegated", path: "/settings/delegate/members" },
      { title: "Accounts delegated to you", path: "/settings/delegate/groups" },
    ],
  },
  {
    id: "x-privacy",
    label: "Privacy and safety",
    path: "/settings/privacy_and_safety",
    pages: [
      { title: "Audience and tagging", path: "/settings/audience_and_tagging" },
      { title: "Protect your posts", path: "/settings/audience_and_tagging" },
      { title: "Photo tagging", path: "/settings/tagging" },
      { title: "Your posts", path: "/settings/your_tweets" },
      { title: "Content you see", path: "/settings/content_you_see" },
      { title: "Search settings", path: "/settings/search" },
      { title: "Sensitive media", path: "/settings/sensitive_media" },
      { title: "Mute and block", path: "/settings/mute_and_block" },
      { title: "Muted words", path: "/settings/muted_keywords" },
      { title: "Reply filter", path: "/settings/replies" },
      { title: "Chat", path: "/settings/direct_messages" },
      { title: "Spaces", path: "/settings/spaces" },
      { title: "Discoverability and contacts", path: "/settings/contacts" },
      { title: "Ads preferences", path: "/settings/ads_preferences" },
      { title: "Cookie preferences", path: "/settings/cookie_preferences" },
      {
        title: "Data sharing with business partners",
        path: "/settings/data_sharing_with_business_partners",
      },
      { title: "Grok", path: "/settings/grok_settings" },
      { title: "Location information", path: "/settings/location_information" },
      { title: "Add location information to your posts", path: "/settings/location" },
    ],
  },
  {
    id: "x-notifications",
    label: "Notifications",
    path: "/settings/notifications",
    pages: [
      { title: "Filters", path: "/settings/notifications/filters", synonyms: ["Notifications"] },
      { title: "Quality filter", path: "/settings/notifications/filters" },
      { title: "Muted notifications", path: "/settings/notifications/advanced_filters" },
      {
        title: "Preferences",
        path: "/settings/notifications/preferences",
        synonyms: ["Notifications"],
      },
      { title: "Push notifications", path: "/settings/push_notifications" },
      { title: "Email notifications", path: "/settings/email_notifications" },
    ],
  },
  {
    id: "x-accessibility",
    label: "Accessibility, display, and languages",
    path: "/settings/accessibility_display_and_languages",
    pages: [
      { title: "Accessibility", path: "/settings/accessibility" },
      { title: "Autoplay", path: "/settings/autoplay" },
      { title: "Display", path: "/settings/display" },
      { title: "Languages", path: "/settings/languages" },
      { title: "Change display language", path: "/settings/language" },
      { title: "Data usage", path: "/settings/data" },
    ],
  },
  {
    id: "x-premium",
    label: "Premium",
    // X's Settings links its own Premium page for a subscriber, else its sign-up.
    path: "/i/premium_sign_up?referring_page=settings",
    pages: [
      { title: "Profile customization", path: "/settings/profile_customization" },
      { title: "Manage Subscription", path: "/settings/subscription" },
    ],
  },
  {
    id: "x-monetization",
    label: "Monetization",
    path: "/settings/monetization",
    pages: [
      { title: "Subscriptions", path: "/settings/superfollows" },
      { title: "Creator Subscriptions", path: "/settings/manage_subscriptions" },
    ],
  },
  {
    id: "x-resources",
    label: "Additional resources",
    path: "/settings/about",
    pages: [],
  },
] as const satisfies ReadonlyArray<{
  readonly id: `x-${string}`;
  readonly label: string;
  readonly path: string;
  readonly pages: ReadonlyArray<XSettingsPage>;
}>;

export type XSectionId = (typeof X_SECTIONS)[number]["id"];

export const xSection = (id: string) => X_SECTIONS.find((s) => s.id === id);

/**
 * Pages that stay X's own, shown over the main area with Xtend's bar, never read: the password,
 * two-factor, passkeys and security keys, X's sign-in sessions, and everything that pays or is
 * paid (Premium, Monetization). Any page off /settings is X's own too.
 */
const X_ONLY =
  /^\/settings\/(password|security|account\/(login_verification|passkey)|sessions|your_twitter_data\/login_history|monetization|monetization_idv|superfollows|manage_subscriptions|subscription|profile_customization|ad_rev_share_\w+|pre_roll_ads_\w+)(\/|$)/;

export const isXOnly = (path: string) => !path.startsWith("/settings/") || X_ONLY.test(path);

/** X's settings pages whose title or synonyms hold `query`, as X's own settings search finds them. */
export const searchXSettings = (query: string) => {
  const q = query.trim().toLocaleLowerCase();
  if (q === "") return [];
  return X_SECTIONS.flatMap((section) =>
    [{ title: section.label, path: section.path }, ...section.pages]
      .filter((p: XSettingsPage) =>
        [p.title, ...(p.synonyms ?? [])].some((w) => w.toLocaleLowerCase().includes(q)),
      )
      .map((page) => ({ section, page })),
  );
};
