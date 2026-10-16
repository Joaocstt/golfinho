import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource-variable/geist";
import "./style.css";
import { applyUiScale, readUiScale } from "./uiScale";
applyUiScale(readUiScale());
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
