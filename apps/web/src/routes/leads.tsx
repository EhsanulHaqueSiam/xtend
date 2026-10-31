import { createFileRoute } from "@tanstack/react-router";

import { AgentsSection } from "../components/leads/Agents";
import { ListsSection } from "../components/leads/Lists";
import { PeopleSection } from "../components/leads/People";
import { useSection } from "../components/shell/sections";

/** Leads' sections are rows in the sidebar; each one draws its own header and table. */
function LeadsScreen() {
  const section = useSection("/leads");
  return (
    <div className="flex h-full flex-col">
      {section === "people" ? (
        <PeopleSection />
      ) : section === "lists" ? (
        <ListsSection />
      ) : (
        <AgentsSection />
      )}
    </div>
  );
}

export const Route = createFileRoute("/leads")({ component: LeadsScreen });
