import { RegistryContext } from "@effect/atom-react";
import { createBrowserHistory, createHashHistory, RouterProvider } from "@tanstack/react-router";
import { AtomRegistry } from "effect/reactivity";
import React from "react";
import ReactDOM from "react-dom/client";

import "./index.css";
import { isElectron } from "./env";
import { getRouter } from "./router";

// Electron loads the app from a file-backed shell in packaged builds, so hash history avoids path resolution issues.
const router = getRouter(isElectron ? createHashHistory() : createBrowserHistory());
const registry = AtomRegistry.make();

if (isElectron) {
  document.documentElement.classList.add("electron");
  if (window.desktopBridge?.platform === "darwin")
    document.documentElement.classList.add("electron-mac");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RegistryContext.Provider value={registry}>
      <RouterProvider router={router} />
    </RegistryContext.Provider>
  </React.StrictMode>,
);
