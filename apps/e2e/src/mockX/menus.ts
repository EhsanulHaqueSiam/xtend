import type { MockState } from "./state.ts";

/**
 * The rows of X's menus on the mock, in X's order and wording (the "..." on a post and on a
 * profile, Share, the reply sort), and what each does when pressed: a write, a confirm dialog, a
 * toast, or X's own page for it. The page script runs them; nothing here is sent anywhere.
 */

/** A change the page sends to mock X, at the path x.com sends it to. */
export interface Write {
  readonly path: string;
  readonly body: Record<string, unknown>;
}

interface Step {
  readonly trend?: { readonly name: string; readonly hidden: boolean };
  readonly write?: Write;
  /** Turns every follow button for the person, as X does once a follow went through. */
  readonly follow?: { readonly userId: string; readonly on: boolean };
  /** Relabels a Community's membership button, as X does once a join, ask or leave went through. */
  readonly community?: { readonly id: string; readonly label: string };
  /** X's own page for the row, through its router; `replace` keeps the history entry. */
  readonly go?: string;
  readonly replace?: string;
  readonly toast?: { readonly text: string; readonly undo?: Step };
  readonly dialog?: Dialog;
}

export interface Dialog {
  readonly title: string;
  readonly body: string;
  /** X's confirm sheet (Unfollow, Block) carries its test ids; other dialogs are plain modals. */
  readonly sheet?: boolean;
  readonly buttons: ReadonlyArray<{
    readonly label: string;
    readonly step?: Step;
    readonly testid?: string;
  }>;
}

export interface Row extends Step {
  readonly label: string;
  readonly testid?: string;
  readonly checked?: boolean;
}

const graphql = (op: string, variables: Record<string, unknown>): Write => ({
  path: `/i/api/graphql/${opHash(op)}/${op}`,
  body: { variables, queryId: opHash(op) },
});
const rest = (name: string, body: Record<string, unknown>): Write => ({
  path: `/i/api/1.1/${name}.json`,
  body,
});

/** X's persisted-query id stands in front of each operation; the mock's are made up per name. */
export const opHash = (op: string) =>
  [...op]
    .reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381)
    .toString(36)
    .padStart(7, "0") + "MockX";

const close = { label: "Cancel", testid: "confirmationSheetCancel" };

/** The confirm X asks before an unfollow, and the follow it then undoes. */
export const unfollowSheet = (userId: string, handle: string): Dialog => ({
  title: `Unfollow @${handle}?`,
  body: "Their posts will no longer show up in your Following timeline. You can still view their profile, unless their posts are protected.",
  sheet: true,
  buttons: [
    {
      label: "Unfollow",
      testid: "confirmationSheetConfirm",
      step: {
        write: rest("friendships/destroy", { user_id: userId }),
        follow: { userId, on: false },
      },
    },
    close,
  ],
});

/**
 * X's "Ask to join": the Community's numbered rules and "Agree and ask to join", which sends the
 * request for its moderators.
 */
export const askToJoinDialog = (c: {
  readonly communityId: string;
  readonly name: string;
  readonly rules: ReadonlyArray<{ readonly name: string }> | null;
}): Dialog => ({
  title: `${c.name} Rules`,
  body: (c.rules ?? []).map((r, i) => `${i + 1}. ${r.name}`).join(" "),
  buttons: [
    {
      label: "Agree and ask to join",
      step: {
        write: graphql("RequestToJoinCommunity", { communityId: c.communityId }),
        community: { id: c.communityId, label: "Requested" },
      },
    },
  ],
});

/** The confirm X asks before leaving a Community. */
export const leaveCommunitySheet = (c: { readonly communityId: string }): Dialog => ({
  title: "Leave this Community?",
  body: "You will no longer be able to post or reply in it.",
  sheet: true,
  buttons: [
    {
      label: "Leave",
      testid: "confirmationSheetConfirm",
      step: {
        write: graphql("LeaveCommunity", { communityId: c.communityId }),
        community: { id: c.communityId, label: "Join" },
      },
    },
    close,
  ],
});

const blockRow = (userId: string, handle: string, label = `Block @${handle}`): Row => ({
  label,
  dialog: {
    title: `Block @${handle}?`,
    body: `They will be able to see your public posts, but will no longer be able to engage with them. @${handle} will also not be able to follow or message you, and you will not see notifications from them.`,
    sheet: true,
    buttons: [
      {
        label: "Block",
        testid: "confirmationSheetConfirm",
        step: {
          write: rest("blocks/create", { user_id: userId }),
          toast: {
            text: `@${handle} has been blocked`,
            undo: { write: rest("blocks/destroy", { user_id: userId }) },
          },
        },
      },
      close,
    ],
  },
});

const muteRow = (userId: string, handle: string, label: string): Row => ({
  label,
  write: rest("mutes/users/create", { user_id: userId }),
  toast: {
    text: `@${handle} has been muted`,
    undo: { write: rest("mutes/users/destroy", { user_id: userId }) },
  },
});

const listsRow = (label: string, state: MockState): Row => ({
  label,
  dialog: {
    title: "Pick a List",
    body: `Create a new List · ${state
      .lists()
      .filter((l) => l.owner?.userId === state.viewer.userId)
      .map((l) => `${l.name}${l.isPrivate ? " 🔒" : ""}`)
      .join(" · ")}`,
    buttons: [{ label: "Save" }],
  },
});

const copied = { toast: { text: "Copied to clipboard" } };

/** The rows of the menu `spec` names (`post:<id>`, `share:<id>`, `profile:<handle>`, `sort:<id>`). */
export function menuRows(state: MockState, spec: string): ReadonlyArray<Row> {
  const [kind = "", ...parts] = spec.split(":");
  const arg = parts.join(":");
  if (kind === "post") {
    const p = state.post(arg);
    if (p === undefined) return [];
    const h = p.author.handle;
    const id = p.postId;
    const muteConversation: Row = {
      label: "Mute this conversation",
      dialog: {
        title: "Mute conversation",
        body: "You won't get notifications about this conversation anymore.",
        buttons: [
          {
            label: "Mute this",
            step: {
              write: graphql("MuteConversation", { tweet_id: id }),
              toast: {
                text: "You muted this conversation",
                undo: { write: graphql("UnmuteConversation", { tweet_id: id }) },
              },
            },
          },
          { label: "Cancel" },
        ],
      },
    };
    const activity: Row = { label: "View post activity", go: `/${h}/status/${id}/quotes` };
    const embed: Row = { label: "Embed post" };
    const note: Row = {
      label: "Request Community Note",
      dialog: {
        title: "Request a Community Note",
        body: "If you think this post would benefit from a Community Note, request one. Add a source link if you have one.",
        buttons: [{ label: "Agree & Request a note" }, { label: "Cancel" }],
      },
    };
    if (p.author.userId === state.viewer.userId)
      return [
        {
          label: "Delete",
          dialog: {
            title: "Delete post?",
            body: "This can't be undone and it will be removed from your profile, the timeline of any accounts that follow you, and from search results.",
            sheet: true,
            buttons: [
              {
                label: "Delete",
                testid: "confirmationSheetConfirm",
                step: { write: graphql("DeleteTweet", { tweet_id: id }) },
              },
              close,
            ],
          },
        },
        {
          label: "Pin to your profile",
          write: graphql("PinTweet", { tweet_id: id }),
          toast: { text: "Your post was pinned to your profile." },
        },
        { label: "Add/remove from Highlights", toast: { text: "Added to Highlights" } },
        listsRow(`Add/remove @${h} from Lists`, state),
        muteConversation,
        activity,
        embed,
        { label: "View post analytics", go: `/${h}/status/${id}/analytics` },
        note,
      ];
    const author = state.user(p.author.userId);
    return [
      author?.youFollow === true
        ? { label: `Unfollow @${h}`, dialog: unfollowSheet(p.author.userId, h) }
        : {
            label: `Follow @${h}`,
            write: rest("friendships/create", { user_id: p.author.userId }),
            follow: { userId: p.author.userId, on: true },
          },
      ...(state.isCreator(p.author.userId) ? [subscribeRow(h)] : []),
      listsRow(`Add/remove @${h} from Lists`, state),
      muteRow(p.author.userId, h, `Mute @${h}`),
      muteConversation,
      blockRow(p.author.userId, h),
      activity,
      embed,
      { label: "Report post", go: `/i/safety/report_story_start?tweet_id=${id}` },
      { label: "View hidden replies", go: `/${h}/status/${id}/hidden` },
      note,
    ];
  }
  if (kind === "share") {
    const p = state.post(arg);
    if (p === undefined) return [];
    return [
      { label: "Copy link", ...copied },
      { label: "Share post via …" },
      {
        label: "Send via Chat",
        go: `/messages/compose?text=${encodeURIComponent(`https://x.com/${p.author.handle}/status/${p.postId}`)}`,
      },
      {
        label: "Bookmark to Folder",
        dialog: {
          title: "Add to Folder",
          body: "Organize your Bookmarks into folders.",
          buttons: [{ label: "Done" }],
        },
      },
    ];
  }
  if (kind === "profile") {
    const u = state.byHandle(arg);
    if (u === undefined) return [];
    const h = u.handle;
    return [
      { label: "About this account", go: `/${h}/about` },
      { label: "View Topics", go: `/${h}/topics` },
      listsRow("Add/remove from Lists", state),
      { label: "View Lists", go: `/${h}/lists/memberships` },
      { label: `Share @${h} via...` },
      { label: "Copy link to profile", ...copied },
      {
        label: "Turn off reposts",
        write: rest("friendships/update", { id: u.userId, retweets: "false" }),
        toast: { text: `You'll no longer see reposts from @${h}` },
      },
      muteRow(u.userId, h, "Mute"),
      blockRow(u.userId, h),
      { label: `Report @${h}`, go: `/i/safety/report_story_start?reported_user_id=${u.userId}` },
    ];
  }
  if (kind === "sort") {
    const p = state.post(arg);
    if (p === undefined) return [];
    const base = `/${p.author.handle}/status/${p.postId}`;
    return [
      { label: "Relevant", replace: base },
      { label: "Recent", replace: `${base}?sort_replies=recency` },
      { label: "Likes", replace: `${base}?sort_replies=likes` },
    ];
  }
  if (kind === "retweet") {
    const p = state.post(arg);
    if (p === undefined) return [];
    return p.reposted
      ? [
          {
            label: "Undo repost",
            testid: "unretweetConfirm",
            write: graphql("DeleteRetweet", { source_tweet_id: p.postId }),
          },
        ]
      : [
          {
            label: "Repost",
            testid: "retweetConfirm",
            write: graphql("CreateRetweet", { tweet_id: p.postId }),
          },
          { label: "Quote", go: `/compose/post?quote=${p.postId}` },
        ];
  }
  if (kind === "trend")
    return [
      "The associated content is not relevant",
      "This trend is spam",
      "This trend is abusive or harmful",
      "Not interested in this",
      "This trend is a duplicate",
      "This trend is harmful or spammy",
    ].map((label) => ({
      label,
      trend: { name: arg, hidden: true },
      toast: {
        text: "Thanks. We'll use this to make your timeline better.",
        undo: { trend: { name: arg, hidden: false } },
      },
    }));
  if (kind === "search")
    return [
      {
        label: "Search settings",
        dialog: {
          title: "Search settings",
          body: "Hide sensitive content · Remove blocked and muted accounts",
          buttons: [{ label: "Done" }],
        },
      },
    ];
  return [];
}

/** X's Subscribe dialog for a creator: paying happens there, in X, never on the mock. */
export const subscribeDialog = (handle: string): Dialog => ({
  title: "Subscribe - $1.00/mo",
  body: `Support @${handle} and get their subscriber-only posts. Share your email address with them. By subscribing you agree to the Purchaser Terms.`,
  buttons: [{ label: "Close" }],
});
const subscribeRow = (handle: string): Row => ({
  label: `Subscribe to @${handle}`,
  dialog: subscribeDialog(handle),
});
