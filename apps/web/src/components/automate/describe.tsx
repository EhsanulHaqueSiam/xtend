import type { Action, RuleRunStatus, Trigger } from "@xtend/contracts";

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
  }
};

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
  }
};

export const statusTone: Record<RuleRunStatus, string> = {
  ok: "text-success-foreground",
  failed: "text-error-foreground",
  skipped: "text-muted-foreground",
  dry_run: "text-warning-foreground",
};
