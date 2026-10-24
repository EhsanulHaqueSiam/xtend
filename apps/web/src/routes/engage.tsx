import { createFileRoute } from "@tanstack/react-router";

import { Dms } from "../components/engage/Dms";
import { Incoming, SentReplies } from "../components/engage/Inbox";
import { Mentions } from "../components/engage/Mentions";
import { Targets } from "../components/engage/Targets";
import { useSection } from "../components/shell/sections";

/** Engage's sections are rows in the sidebar; each one draws its own header and triage list. */
function EngageScreen() {
  const section = useSection("/engage");
  return (
    <div className="flex h-full flex-col">
      {section === "targets" ? (
        <Targets />
      ) : section === "mentions" ? (
        <Mentions />
      ) : section === "inbox" ? (
        <Incoming />
      ) : section === "sent" ? (
        <SentReplies view="sent" />
      ) : section === "follow-ups" ? (
        <SentReplies view="followUps" />
      ) : (
        <Dms />
      )}
    </div>
  );
}

export const Route = createFileRoute("/engage")({ component: EngageScreen });
