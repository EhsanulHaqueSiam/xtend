import { Link } from "@tanstack/react-router";

import { isElectron } from "../../env";
import { Button } from "./button";
import { Empty } from "./layout";

/**
 * Where a screen needs the user's own handle and there is none yet. The service
 * reads it from the signed-in X session, so the fix is signing in there, not a
 * setting. `subject` starts the line: "Mentions need".
 */
export function NoHandle({ subject }: { readonly subject: string }) {
  return (
    <Empty
      action={
        isElectron ? (
          <Button size="sm" variant="outline" render={<Link to="/x" />}>
            Open X
          </Button>
        ) : undefined
      }
    >
      {isElectron
        ? `${subject} your handle, which comes from the signed-in X session.`
        : `${subject} your handle, which the desktop app reads from the signed-in X session.`}
    </Empty>
  );
}
