import React from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { App } from "./App";
import { loadSettings } from "../settings";
import { setBaseUrl } from "../shared/api-client";

Office.onReady(() => {
  const settings = loadSettings();
  setBaseUrl(settings.backendUrl);
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  root.render(
    <FluentProvider theme={webLightTheme}>
      <App />
    </FluentProvider>
  );
});
