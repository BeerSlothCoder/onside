// Onside content script — mounts the market overlay on stream pages.
import React from "react";
import { createRoot } from "react-dom/client";
import { Overlay } from "./overlay/Overlay";

const CONTAINER_ID = "onside-overlay-root";

function mount() {
  if (document.getElementById(CONTAINER_ID)) return;
  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  Object.assign(container.style, {
    position: "fixed",
    top: "0",
    right: "0",
    zIndex: "2147483646",
    pointerEvents: "none",
  });
  document.body.appendChild(container);
  createRoot(container).render(<Overlay />);
}

// YouTube is an SPA — re-check on navigation.
mount();
document.addEventListener("yt-navigate-finish", mount);

// Generic SPA guard (ČT / Nova / Tipsport players re-render aggressively):
// if our container gets removed by a route change, remount it.
setInterval(() => {
  if (!document.getElementById(CONTAINER_ID)) mount();
}, 3000);

// Fullscreen: only the fullscreened element's subtree is rendered, so reparent
// our root into it (players fullscreen a wrapper div, not the raw <video>).
document.addEventListener("fullscreenchange", () => {
  const root = document.getElementById(CONTAINER_ID);
  if (!root) return;
  const fe = document.fullscreenElement as HTMLElement | null;
  const host = fe && fe.tagName !== "VIDEO" ? fe : document.body;
  if (root.parentElement !== host) host.appendChild(root);
});
