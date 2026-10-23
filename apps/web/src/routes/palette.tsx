import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { PaletteBody } from "../components/shell/CommandPalette";
import { shellBridge } from "../components/shell/bridge";

/** The ⌘K palette as a slot: picking a screen opens it in the center slot, which replaces this one. */
function PaletteSlot() {
  const navigate = useNavigate();
  const bridge = shellBridge();
  return (
    <PaletteBody
      go={(href) =>
        bridge === undefined
          ? void navigate({ href })
          : bridge.openSlot({ kind: "center", route: href })
      }
      onClose={() =>
        bridge === undefined ? void navigate({ to: "/" }) : bridge.closeSlot({ kind: "palette" })
      }
    />
  );
}

export const Route = createFileRoute("/palette")({ component: PaletteSlot });
