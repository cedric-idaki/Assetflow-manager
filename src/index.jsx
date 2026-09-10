import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { logger } from "./utils/logger";
import { registerServiceWorker } from "./utils/registerServiceWorker";
import "./styles/tailwind.css";
import "./styles/index.css";

// ErrorBoundary only sees errors thrown during React render. These two cover
// the rest — most importantly rejected promises from async Supabase calls,
// which are the common failure here and previously reached nothing at all.
window.addEventListener("unhandledrejection", (event) => {
  logger.error("Unhandled promise rejection", {
    message: event?.reason?.message ?? String(event?.reason),
    stack: event?.reason?.stack,
    path: window.location?.pathname,
  });
});

window.addEventListener("error", (event) => {
  // Resource load failures (img/script/link) surface here with no `error`
  // object; they are not app exceptions and would drown out the real ones.
  if (!event?.error) return;
  logger.error("Uncaught error", {
    message: event.error.message,
    stack: event.error.stack,
    path: window.location?.pathname,
  });
});

const container = document.getElementById("root");
const root = createRoot(container);

root.render(<App />);

registerServiceWorker();
