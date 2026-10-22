import { useAtomValue } from "@effect/atom-react";
import { createFileRoute } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { Tabs } from "../components/analyze/ui";
import { Agents } from "../components/leads/Agents";
import { Followers } from "../components/leads/Followers";
import { Lists } from "../components/leads/Lists";
import { People } from "../components/leads/People";
import { PageHeader } from "../components/PageHeader";
import { agentsAtom, listsAtom, peopleAtom } from "../state/leads";

const TABS = ["People", "Lists", "Agents", "New followers"] as const;

const count = <A,>(r: AsyncResult.AsyncResult<ReadonlyArray<A>, unknown>) =>
  AsyncResult.getOrElse(
    AsyncResult.map(r, (v) => String(v.length)),
    () => "–",
  );

function LeadsScreen() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("People");
  const people = useAtomValue(peopleAtom(null));
  const lists = useAtomValue(listsAtom);
  const agents = useAtomValue(agentsAtom);
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Leads"
        detail={`${count(people)} people · ${count(lists)} lists · ${count(agents)} agents`}
      />
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 overflow-y-auto px-4 py-3">
        {tab === "People" ? (
          <People listId={null} />
        ) : tab === "Lists" ? (
          <Lists />
        ) : tab === "Agents" ? (
          <Agents />
        ) : (
          <Followers />
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/leads")({ component: LeadsScreen });
