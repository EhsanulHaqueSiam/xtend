import type { Action, Conditions, RateCard, Rule, RuleRunStatus, Trigger } from "@xtend/contracts";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** A piece of the rule sentence: connective words, or a value the user set. */
export type Segment = string | { readonly tag: string };
const tag = (value: string | number): Segment => ({ tag: String(value) });

const describeTrigger = (t: Trigger): ReadonlyArray<Segment> => {
  switch (t.kind) {
    case "post_crosses_threshold":
      return ["when my post reaches ", tag(`${t.threshold.toLocaleString()} ${t.metric}`)];
    case "schedule":
      return [
        "every ",
        tag(t.weekdays.map((d) => DAYS[d]).join(", ") || "(no day)"),
        " ",
        tag(t.time),
      ];
    case "new_engager":
      return ["when someone new engages with me"];
    case "keyword_post":
      return ["when a post matches ", tag(`"${t.query}"`)];
    case "post_engaged":
      return [
        "when someone ",
        tag(t.via === "like" ? "likes" : "reposts"),
        " post ",
        tag(t.postId),
      ];
    case "new_follower":
      return ["when someone follows me"];
    case "agent_match":
      return ["when an agent finds someone scoring ", tag(`${t.minScore}+`)];
    case "webhook":
      return ["when the webhook URL is called"];
  }
};

/**
 * What the engine pays X on its own clock to watch a trigger, priced from the rate card. The
 * cadence is AutomationEngine's POLL_MS and the read cache's lifetime (search 30 min, own posts
 * 1 h). Dry runs never poll. Null for triggers that only read stored data.
 */
export const triggerPoll = (
  rates: RateCard,
  t: Trigger,
): { readonly usd: number; readonly every: string; readonly perDay: number } | null => {
  switch (t.kind) {
    case "post_engaged":
      return t.via === "like"
        ? { usd: rates.likersPage, every: "hour", perDay: 24 }
        : { usd: rates.repostersPage, every: "15 min", perDay: 96 };
    case "new_follower":
      return { usd: rates.followersPage, every: "15 min", perDay: 96 };
    case "keyword_post":
      return { usd: rates.searchPage, every: "30 min", perDay: 48 };
    case "post_crosses_threshold":
      return { usd: rates.searchPage, every: "hour", perDay: 24 };
    default:
      return null;
  }
};

const describeConditions = (c: Conditions): ReadonlyArray<Segment> =>
  [
    c.withinHours !== undefined ? tag(`within ${c.withinHours}h`) : null,
    c.link === "has" ? tag("has a link") : c.link === "none" ? tag("no link") : null,
    c.notReply === true ? tag("not a reply") : null,
    c.minAuthorFollowers !== undefined ? tag(`author ${c.minAuthorFollowers}+ followers`) : null,
    c.notInListId !== undefined ? tag(`not in list ${c.notInListId}`) : null,
  ]
    .filter((s) => s !== null)
    .flatMap((s, i) => (i === 0 ? [s] : [", ", s]));

const describeAction = (a: Action): ReadonlyArray<Segment> => {
  switch (a.kind) {
    case "auto_plug":
      return ["reply with ", tag(`"${a.text}"`)];
    case "auto_dm":
      return ["DM template ", tag(`"${a.template}"`)];
    case "auto_retweet":
      return a.evergreen ? ["repost one of my top posts"] : ["repost the post"];
    case "clean_profile":
      return ["undo my reposts of others after ", tag(`${a.afterHours}h`)];
    case "auto_delete":
      return [
        "delete posts older than ",
        tag(`${a.olderThanDays}d`),
        " with under ",
        tag(`${a.maxViews} views`),
      ];
    case "auto_like":
      return ["like the post"];
    case "unrepost":
      return ["undo the repost"];
    case "add_to_list":
      return ["add them to list ", tag(a.listId)];
    case "notify":
      return ["notify me: ", tag(`"${a.message}"`)];
    case "follow":
      return ["follow them"];
  }
};

/** The whole rule as one sentence: "When my post reaches 5,000 views, if no link, reply with …". */
export const describeRule = (rule: Rule): ReadonlyArray<Segment> => {
  const conditions = describeConditions(rule.conditions);
  const parts: ReadonlyArray<ReadonlyArray<Segment> | null> = [
    [
      ...describeTrigger(rule.trigger),
      ...(conditions.length === 0 ? [] : [", if ", ...conditions]),
    ],
    rule.waitMinutes > 0 ? ["after ", tag(`${rule.waitMinutes} min`)] : null,
    describeAction(rule.action),
    rule.undoAfterHours !== null ? ["undo after ", tag(`${rule.undoAfterHours}h`)] : null,
  ];
  const [first, ...rest] = parts
    .filter((s) => s !== null)
    .flatMap((s, i) => (i === 0 ? s : [", ", ...s]));
  return typeof first === "string"
    ? [first.charAt(0).toUpperCase() + first.slice(1), ...rest]
    : [first!, ...rest];
};

export const statusLabel: Record<RuleRunStatus, string> = {
  ok: "ok",
  failed: "failed",
  skipped: "skipped",
  dry_run: "dry run",
  pending: "pending",
};

export const statusTone: Record<RuleRunStatus, string> = {
  ok: "text-success-foreground",
  failed: "text-error-foreground",
  skipped: "text-muted-foreground",
  dry_run: "text-warning-foreground",
  pending: "text-warning-foreground",
};
