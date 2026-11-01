import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { switchAccount } from "../../state/accounts";
import { eventsOfTypeAtom } from "../../state/shell";

/**
 * Follows an account switch made in any client. Every screen here holds the old account's rows
 * and its writes would land on the new one, so it reloads onto it as the sidebar switcher does.
 */
export function AccountSync() {
  const last = useAtomValue(eventsOfTypeAtom("account_switched")).at(-1);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- switches this window to the account another window switched to (service event to desktop bridge).
  useEffect(() => {
    const id = last?.payload.accountId;
    // A desktop window already on that account is the one that switched.
    if (typeof id === "number" && id !== window.desktopBridge?.accountId) switchAccount(id);
  }, [last]);
  return null;
}
