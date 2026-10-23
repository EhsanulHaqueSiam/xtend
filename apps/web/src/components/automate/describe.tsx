import type { Action, Conditions, RuleRunStatus, Trigger } from "@xtend/contracts";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const describeTrigger = (t: Trigger): string => {
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

export const describeConditions = (c: Conditions): string =>
  [
    c.withinHours !== undefined ? `within ${c.withinHours}h` : null,
    c.link === "has" ? "has a link" : c.link === "none" ? "no link" : null,
    c.notReply === true ? "not a reply" : null,
    c.minAuthorFollowers !== undefined ? `author ${c.minAuthorFollowers}+ followers` : null,
    c.notInListId !== undefined ? `not in list ${c.notInListId}` : null,
  ]
    .filter((s) => s !== null)
    .join(", ");

export const describeAction = (a: Action): string => {
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

export const statusTone: Record<RuleRunStatus, string> = {
  ok: "text-success-foreground",
  failed: "text-error-foreground",
  skipped: "text-muted-foreground",
  dry_run: "text-warning-foreground",
  pending: "text-warning-foreground",
};
