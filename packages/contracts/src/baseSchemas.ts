import * as Schema from "effect/Schema";

export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const PortSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

/** ISO 8601 timestamp. Rows store strings so SQLite can order and compare them. */
export const IsoDateTime = Schema.String;
export type IsoDateTime = typeof IsoDateTime.Type;

/** X's numeric ids exceed 2^53, so every id travels as a string. */
export const XId = Schema.String.check(Schema.isPattern(/^\d{1,25}$/));
export type XId = typeof XId.Type;

export const XHandle = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_]{1,15}$/));
export type XHandle = typeof XHandle.Type;

/** The taste an assist draft takes (replies, DMs, posts); the chooser offers these in this order. */
export const ReplyTone = Schema.Literals([
  "agree",
  "add",
  "ask",
  "contrarian",
  "sarcastic",
  "warm",
  "short",
]);
export type ReplyTone = typeof ReplyTone.Type;
