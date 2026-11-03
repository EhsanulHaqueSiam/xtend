import { useAtomValue } from "@effect/atom-react";
import type { PostCommunity } from "@xtend/contracts";
import { ChevronDown, Earth } from "lucide-react";
import { useState } from "react";

import { at, engineAtom } from "../../state/engine";
import { xAudienceCard } from "../../state/x";
import { fmt } from "../analyze/ui";
import { Popover } from "../ui/popover";
import { Switch } from "../ui/switch";

const row =
  "flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left text-[15px] hover:bg-white/7";

/**
 * X's "Choose audience": Everyone, or one of the user's Communities in X's order and words, and
 * X's "Also share with followers" once one is picked. Opening it opens X's own card on the engine
 * (picking nothing) so X sends the user's Communities. Only X's composer posts to a Community, so
 * this shows only where the session posts.
 */
export function AudiencePicker({
  value,
  onChange,
}: {
  readonly value: PostCommunity | null;
  readonly onChange: (value: PostCommunity | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const engine = useAtomValue(engineAtom);
  const mine = at(engine.communityIds, "communities:mine").flatMap(
    (id) => engine.communities.get(id) ?? [],
  );
  const pick = (next: PostCommunity | null) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) void xAudienceCard();
        }}
        align="start"
        className="w-80 p-0 py-3"
        trigger={
          <button
            type="button"
            aria-label="Choose audience"
            className="flex cursor-pointer items-center gap-1 rounded-full border border-[#1d9bf0]/50 px-3 py-0.5 text-[14px] font-bold text-[#1d9bf0] hover:bg-[#1d9bf0]/10"
          >
            {value?.name ?? "Everyone"}
            <ChevronDown className="size-4" />
          </button>
        }
      >
        <div role="group" aria-label="Choose audience">
          <p className="px-4 pb-2 text-[20px] font-bold">Choose audience</p>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={value === null}
            className={row}
            onClick={() => pick(null)}
          >
            <span className="grid size-10 place-items-center rounded-full bg-[#1d9bf0] text-white">
              <Earth className="size-5" />
            </span>
            <span className="font-bold">Everyone</span>
          </button>
          {mine.length === 0 ? null : (
            <p className="px-4 pt-3 pb-1 text-[15px] font-bold">My Communities</p>
          )}
          {mine.map((c) => (
            <button
              key={c.communityId}
              type="button"
              role="menuitemradio"
              aria-checked={value?.id === c.communityId}
              className={row}
              onClick={() =>
                pick({
                  id: c.communityId,
                  name: c.name,
                  shareWithFollowers: value?.shareWithFollowers ?? false,
                })
              }
            >
              {c.bannerUrl === null ? (
                <span className="size-10 shrink-0 rounded-lg bg-white/10" />
              ) : (
                <img
                  src={c.bannerUrl}
                  alt=""
                  className="size-10 shrink-0 rounded-lg object-cover"
                />
              )}
              <span className="min-w-0">
                <span className="block truncate font-bold">{c.name}</span>
                {c.members === null ? null : (
                  <span className="block text-[13px] text-[#71767b]">{fmt(c.members)} Members</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </Popover>
      {value === null ? null : (
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[#71767b]">
          <Switch
            checked={value.shareWithFollowers}
            onChange={(shareWithFollowers) => onChange({ ...value, shareWithFollowers })}
          />
          Also share with followers
        </label>
      )}
    </div>
  );
}
