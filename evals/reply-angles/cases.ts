import type { SeenReply, XPost } from "@xtend/contracts";

import type { Expect } from "./grade.ts";

/**
 * Posts the Angles chooser reads. Every case also gets the checks every read gets (see grade.ts);
 * `expect` adds the case's own. Handles and posts are invented.
 */
export type Case = {
  readonly id: string;
  /** The PR or commit whose behavior the case guards, or "control" for ordinary work. */
  readonly source: string;
  readonly post: XPost;
  readonly thread?: ReadonlyArray<string>;
  readonly replies?: ReadonlyArray<SeenReply>;
  readonly correction?: string;
  /** The user's own replies that did best. */
  readonly own?: ReadonlyArray<string>;
  readonly expect?: Expect;
};

const post = (handle: string, text: string): XPost => ({
  postId: "1900000000000000001",
  url: `https://x.com/${handle}/status/1900000000000000001`,
  text,
  createdAt: "2026-11-20T10:00:00.000Z",
  lang: null,
  isReply: false,
  isRepost: false,
  hasMedia: false,
  hasLink: false,
  author: {
    userId: "1800000000000000001",
    handle,
    name: handle,
    followers: 4200,
    verified: false,
    avatarUrl: null,
  },
  metrics: { views: 18000, likes: 140, reposts: 9, replies: 31, quotes: 2, bookmarks: 12 },
});

const reply = (author: string, likes: number, followers: number, text: string): SeenReply => ({
  author,
  followers,
  verified: false,
  likes,
  text,
});

export const cases: ReadonlyArray<Case> = [
  {
    id: "skip-top-replies",
    source: "#146 angles read the post's top replies and must not repeat them",
    post: post(
      "acme_dev",
      "We cut CI from 22 minutes to 6 by caching node_modules on the lockfile hash. Nothing else changed.",
    ),
    replies: [
      reply(
        "ci_nerd",
        88,
        900,
        "Lockfile hash caching is the move. We went from 18 to 5 the same way.",
      ),
      reply(
        "cloud_kim",
        41,
        52000,
        "Which CI? GitHub Actions caps the cache at 10GB and that bit us hard.",
      ),
      reply(
        "monorepo_max",
        30,
        3100,
        "Did you try a remote build cache on top? That got us under 3.",
      ),
      reply("perf_pat", 12, 700, "6 minutes is still long. What's the slowest step now?"),
    ],
  },
  {
    id: "sarcastic-jab",
    source: "0d0d3446 never answer sarcasm as if it were sincere",
    post: post(
      "foo_founder",
      "Love how every AI startup's moat is now 'we have a waitlist'. Truly unbeatable.",
    ),
    expect: { read: /sarcas|iron|jab|mock|snark|dig|joke|satir|roast/i },
  },
  {
    id: "correction-wins",
    source: "0d0d3446 a correction is the post's read",
    post: post("bar_ships", "Is anyone else still writing the tests after the code?"),
    correction: "Sarcastic jab",
    expect: { read: /sarcas/i },
  },
  {
    id: "plain-question",
    source: "control",
    post: post("acme_dev", "What's the one CLI tool you install first on every new machine?"),
  },
  {
    id: "own-taste",
    source: "control",
    post: post(
      "foo_founder",
      "Unpopular opinion: most teams under 10 people don't need a project management tool.",
    ),
    own: [
      "We dropped the tracker for one markdown file at 6 people. Nobody asked for it back.",
      "Standups died the week we wrote decisions in the PR instead.",
    ],
  },
  {
    id: "japanese-post",
    source: "control",
    post: post(
      "tokyo_builds",
      "個人開発で月10万円の売上に届きました。広告ゼロ、Xでの発信だけです。",
    ),
    expect: { everyAngle: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u },
  },
];
