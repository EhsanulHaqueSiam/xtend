import { createFileRoute } from "@tanstack/react-router";

import { Dms } from "../components/engage/Dms";
import { SentReplies } from "../components/engage/Inbox";
import { Inbox } from "../components/engage/Mentions";
import { Targets } from "../components/engage/Targets";
import { useSection } from "../components/shell/sections";

/** Engage's sections are rows in the sidebar; each one draws its own header and triage list. */
function EngageScreen() {
  const section = useSection("/engage");
  return (
    <div className="flex h-full flex-col">
      {section === "targets" ? (
        <Targets />
      ) : section === "inbox" ? (
        <Inbox />
      ) : section === "sent" ? (
        <SentReplies />
      ) : (
        <Dms />
      )}
    </div>
  );
}

export const Route = createFileRoute("/engage")({ component: EngageScreen });
