import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Select } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  type AdvancedSearch as Form,
  type Include,
  LANGUAGES,
  readQuery,
  writeQuery,
} from "./searchOperators";

const languageName = new Intl.DisplayNames(["en"], { type: "language" });
const LANGUAGE_OPTIONS = [
  { value: "", label: "Any language" },
  ...LANGUAGES.map((code) => ({ value: code, label: languageName.of(code) ?? code })).sort((a, b) =>
    a.label.localeCompare(b.label),
  ),
];
const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1).padStart(2, "0"),
  label: new Date(2000, i, 1).toLocaleString("en", { month: "long" }),
}));
const DAYS = Array.from({ length: 31 }, (_, i) => ({
  value: String(i + 1).padStart(2, "0"),
  label: String(i + 1),
}));
// X opened in 2006; its own year list starts there.
const YEARS = Array.from({ length: new Date().getFullYear() - 2005 }, (_, i) => {
  const year = String(new Date().getFullYear() - i);
  return { value: year, label: year };
});

/**
 * X's "Advanced search", over the search it edits: the fields start from the query's own
 * operators, and Search hands back the query X's form would write.
 */
export function AdvancedSearch({
  open,
  query,
  onClose,
  onSearch,
}: {
  readonly open: boolean;
  readonly query: string;
  readonly onClose: () => void;
  readonly onSearch: (query: string) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-[#5b7083]/40" />
        <Dialog.Popup
          aria-label="Advanced search"
          className="fixed top-[5vh] left-1/2 z-50 max-h-[90vh] w-[600px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-y-auto rounded-2xl bg-black outline-hidden"
        >
          {/* Mounted only while open, so each opening starts from the search it edits. */}
          <Fields query={query} onSearch={onSearch} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Fields({
  query,
  onSearch,
}: {
  readonly query: string;
  readonly onSearch: (query: string) => void;
}) {
  const [form, setForm] = useState(() => readQuery(query));
  const set =
    <K extends keyof Form>(key: K) =>
    (value: Form[K]) =>
      setForm((f) => ({ ...f, [key]: value }));
  const text = (key: Exclude<keyof Form, "replies" | "links">, label: string, example: string) => (
    <TextField label={label} example={example} value={form[key]} onChange={set(key)} />
  );
  const count = (key: "minReplies" | "minLikes" | "minReposts", label: string, example: string) => (
    <TextField
      label={label}
      example={example}
      value={form[key]}
      numeric
      onChange={(v) => set(key)(v.replace(/\D/g, ""))}
    />
  );
  const written = writeQuery(form);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (written !== "") onSearch(written);
      }}
    >
      <div className="sticky top-0 z-10 flex h-[53px] items-center gap-6 bg-black/90 px-4 backdrop-blur-md">
        <Dialog.Close
          aria-label="Close"
          className="-m-1.5 grid size-[34px] cursor-pointer place-items-center rounded-full transition-colors duration-150 hover:bg-white/10"
        >
          <X className="size-5" />
        </Dialog.Close>
        <Dialog.Title className="flex-1 text-[20px] font-bold">Advanced search</Dialog.Title>
        <button
          type="submit"
          disabled={written === ""}
          className="h-8 cursor-pointer rounded-full bg-foreground px-4 text-[14px] font-bold text-background transition-opacity duration-150 disabled:cursor-default disabled:opacity-50"
        >
          Search
        </button>
      </div>
      <Group title="Words">
        {text(
          "all",
          "All of these words",
          `what's happening · contains both "what's" and "happening"`,
        )}
        {text("phrase", "This exact phrase", `happy hour · contains the exact phrase "happy hour"`)}
        {text(
          "any",
          "Any of these words",
          `cats dogs · contains either "cats" or "dogs" (or both)`,
        )}
        {text(
          "none",
          "None of these words",
          `cats dogs · does not contain "cats" and does not contain "dogs"`,
        )}
        {text(
          "hashtags",
          "These hashtags",
          "#ThrowbackThursday · contains the hashtag #ThrowbackThursday",
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-[15px]">Language</span>
          <Select
            label="Language"
            value={form.lang}
            onChange={set("lang")}
            options={LANGUAGE_OPTIONS}
            className="h-14 w-full px-2 text-[17px]"
          />
        </div>
      </Group>
      <Group title="Accounts">
        {text("from", "From these accounts", "@Xsupport · sent from @Xsupport")}
        {text("to", "To these accounts", "@Xsupport · sent in reply to @Xsupport")}
        {text(
          "mentioning",
          "Mentioning these accounts",
          "@SFBART @Caltrain · mentions @SFBART or mentions @Caltrain",
        )}
      </Group>
      <Group title="Filters">
        <Filter
          name="Replies"
          value={form.replies}
          onChange={set("replies")}
          include="Include replies and original posts"
          only="Only show replies"
        />
        <Filter
          name="Links"
          value={form.links}
          onChange={set("links")}
          include="Include posts with links"
          only="Only show posts with links"
        />
      </Group>
      <Group title="Engagement">
        {count("minReplies", "Minimum replies", "280 · posts with at least 280 replies")}
        {count("minLikes", "Minimum Likes", "280 · posts with at least 280 Likes")}
        {count("minReposts", "Minimum reposts", "280 · posts with at least 280 reposts")}
      </Group>
      <Group title="Dates">
        <DateField label="From" value={form.since} onChange={set("since")} />
        <DateField label="To" value={form.until} onChange={set("until")} />
      </Group>
    </form>
  );
}

/** A section of the form: X's bold heading over its fields, a hairline above. */
function Group({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-border px-4 pt-3 pb-5">
      <h2 className="text-[17px] font-bold">{title}</h2>
      {children}
    </section>
  );
}

/** X's outlined field: the name inside the box, an example under it. */
function TextField({
  label,
  example,
  value,
  numeric = false,
  onChange,
}: {
  readonly label: string;
  readonly example: string;
  readonly value: string;
  readonly numeric?: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="flex flex-col rounded-[4px] border border-border px-2 pt-1.5 pb-1 transition-[border-color] duration-150 focus-within:border-[#1d9bf0]">
        <span className="text-[13px] text-[#71767b]">{label}</span>
        <input
          className="bg-transparent text-[17px] outline-hidden"
          inputMode={numeric ? "numeric" : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      <p className="mt-1 px-2 text-[13px] text-[#71767b]">Example: {example}</p>
    </div>
  );
}

/** Replies or Links: off leaves them out; on, they come with the rest or are all that shows. */
function Filter({
  name,
  value,
  onChange,
  include,
  only,
}: {
  readonly name: string;
  readonly value: Include;
  readonly onChange: (value: Include) => void;
  readonly include: string;
  readonly only: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between py-1 text-[15px]">
        {name}
        <Switch
          label={name}
          checked={value !== "exclude"}
          onChange={(on) => onChange(on ? "include" : "exclude")}
        />
      </div>
      {value === "exclude"
        ? null
        : (["include", "only"] as const).map((mode) => (
            <label
              key={mode}
              className="flex cursor-pointer items-center justify-between py-2 text-[15px]"
            >
              {mode === "include" ? include : only}
              <input
                type="radio"
                name={name}
                checked={value === mode}
                onChange={() => onChange(mode)}
                className="size-4 accent-[#1d9bf0]"
              />
            </label>
          ))}
    </div>
  );
}

/** X's Month, Day and Year lists; the date counts once all three are picked. */
function DateField({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (date: string) => void;
}) {
  const [parts, setParts] = useState(() => {
    const [year = "", month = "", day = ""] = value === "" ? [] : value.split("-");
    return { year, month, day };
  });
  const pick = (key: keyof typeof parts) => (next: string) => {
    const p = { ...parts, [key]: next };
    setParts(p);
    onChange(
      p.year !== "" && p.month !== "" && p.day !== "" ? `${p.year}-${p.month}-${p.day}` : "",
    );
  };
  const list = (
    key: keyof typeof parts,
    name: string,
    options: ReadonlyArray<{ value: string; label: string }>,
  ) => (
    <Select
      label={`${label} ${name.toLowerCase()}`}
      value={parts[key]}
      onChange={pick(key)}
      options={[{ value: "", label: name }, ...options]}
      className="h-12 flex-1 text-[15px]"
    />
  );
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[15px]">{label}</span>
      <div className="flex gap-3">
        {list("month", "Month", MONTHS)}
        {list("day", "Day", DAYS)}
        {list("year", "Year", YEARS)}
      </div>
    </div>
  );
}
