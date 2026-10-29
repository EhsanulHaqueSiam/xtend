import { Link } from "@tanstack/react-router";

import { isElectron } from "../../env";
import { Button } from "./button";
import { Empty } from "./layout";

/**
 * Where a screen needs the user's own handle and there is none yet. The desktop reads it
 * from the signed-in X session; in a browser there is no session, so it is typed in
 * Settings. `subject` starts the line: "Mentions need".
 */
export function NoHandle({ subject }: { readonly subject: string }) {
  return (
    <Empty
      action={
        isElectron ? (
          <Button size="sm" variant="outline" render={<Link to="/x" />}>
            Open X
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            render={<Link to="/settings" search={{ tab: "account" }} />}
          >
            Set handle
          </Button>
        )
      }
    >
      {isElectron
        ? `${subject} your handle, which comes from the signed-in X session.`
        : `${subject} your handle. The desktop app reads it from your X session; here, set it in Settings.`}
    </Empty>
  );
}
