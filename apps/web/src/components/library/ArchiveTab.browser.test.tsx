import type { LibraryFilters } from "@xtend/contracts";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { useState } from "react";

import { render } from "../../../test/render";
import { FilterBar } from "./ArchiveTab";

function Harness({
  initial,
  onChange,
}: {
  readonly initial: LibraryFilters;
  readonly onChange: (f: LibraryFilters) => void;
}) {
  const [filters, setFilters] = useState<LibraryFilters>(initial);
  return (
    <FilterBar
      value={filters}
      onChange={(next) => {
        setFilters(next);
        onChange(next);
      }}
    />
  );
}

it("builds the filter set from the bar, and Clear keeps the header's format", async () => {
  let last: LibraryFilters = {};
  await using screen = await render(
    <Harness initial={{ format: "thread" }} onChange={(f) => (last = f)} />,
  );

  await userEvent.fill(screen.getByLabelText("Min views"), "5000");
  await userEvent.selectOptions(screen.getByLabelText("author size"), "1M+");
  await userEvent.selectOptions(screen.getByLabelText("hook"), "number hook");
  expect(last).toEqual({
    format: "thread",
    minViews: 5000,
    authorBand: "1M+",
    hookPattern: "number hook",
  });

  await userEvent.selectOptions(screen.getByLabelText("author size"), "");
  expect(last).toEqual({ format: "thread", minViews: 5000, hookPattern: "number hook" });

  await userEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(last).toEqual({ format: "thread" });
  await expect.element(screen.getByRole("button", { name: "Clear" })).not.toBeInTheDocument();
});
