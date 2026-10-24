import type { Action, Conditions, RateCard, Rule, RuleRunStatus, Trigger } from "@xtend/contracts";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const describeTrigger = (t: Trigger): string => {
  switch (t.kind) {
    case "post_crosses_threshold":
      return `when my post reaches ${t.threshold.toLocaleString()} ${t.metric}`;
    case "schedule":
      return `every ${t.weekdays.map((d) => DAYS[d]).join(", ") || "(no day)"} ${t.time}`;
    case "new_engager":
      return "when someone new engages with me";
    case "keyword_post":
      return `when a post matches "${t.query}"`;
    case "post_engaged":
      return `when someone ${t.via === "like" ? "likes" : "reposts"} post ${t.postId}`;
    case "new_follower":
      return "when someone follows me";
    case "agent_match":
      return `when an agent finds someone scoring ${t.minScore}+`;
    case "webhook":
      return "when the webhook URL is called";
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

const describeConditions = (c: Conditions): string =>
  [
    c.withinHours !== undefined ? `within ${c.withinHours}h` : null,
    c.link === "has" ? "has a link" : c.link === "none" ? "no link" : null,
    c.notReply === true ? "not a reply" : null,
    c.minAuthorFollowers !== undefined ? `author ${c.minAuthorFollowers}+ followers` : null,
    c.notInListId !== undefined ? `not in list ${c.notInListId}` : null,
  ]
    .filter((s) => s !== null)
    .join(", ");

const describeAction = (a: Action): string => {
  switch (a.kind) {
    case "auto_plug":
      return `reply with "${a.text}"`;
    case "auto_dm":
      return `DM template "${a.template}"`;
    case "auto_retweet":
      return a.evergreen ? "repost one of my top posts" : "repost the post";
    case "clean_profile":
      return `undo my reposts of others after ${a.afterHours}h`;
    case "auto_delete":
      return `delete posts older than ${a.olderThanDays}d with under ${a.maxViews} views`;
    case "auto_like":
      return "like the post";
    case "unrepost":
      return "undo the repost";
    case "add_to_list":
      return `add them to list ${a.listId}`;
    case "notify":
      return `notify me: "${a.message}"`;
    case "follow":
      return "follow them";
  }
};

/** The whole rule as one line: "When my post reaches 5,000 views, if no link, reply with …". */
export const describeRule = (rule: Rule): string => {
  const conditions = describeConditions(rule.conditions);
  const line = [
    describeTrigger(rule.trigger) + (conditions === "" ? "" : `, if ${conditions}`),
    rule.waitMinutes > 0 ? `after ${rule.waitMinutes} min` : null,
    describeAction(rule.action),
    rule.undoAfterHours !== null ? `undo after ${rule.undoAfterHours}h` : null,
  ]
    .filter((s) => s !== null)
    .join(", ");
  return line.charAt(0).toUpperCase() + line.slice(1);
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
