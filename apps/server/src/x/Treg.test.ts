import { describe, expect, it } from "@effect/vitest";

import { costOf } from "./Treg.ts";

describe("Treg.costOf", () => {
  it("falls back to the quoted price when treg sends no cost, and says which it used", () => {
    expect(costOf({ "x-treg-cost-usd": "0.0007" }, {}, 0.001)).toEqual({
      costUsd: 0.0007,
      source: "header",
    });
    expect(costOf({}, { cost_usd: 0.0004 }, 0.001)).toEqual({ costUsd: 0.0004, source: "body" });
    expect(costOf({}, { data: [] }, 0.001)).toEqual({ costUsd: 0.001, source: "quote" });
  });
});
