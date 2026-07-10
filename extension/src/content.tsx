// Onside content script — mounts the market overlay on stream pages.
// Top frame: full market overlay. Player iframes (all_frames): a minimal
// tracker so pins can anchor to the real <video> inside embeds.
import React from "react";
import { createRoot } from "react-dom/client";
import { Overlay } from "./overlay/Overlay";
import { FrameTracker } from "./tracking/ui/FrameTracker";
import { findMainVideo } from "./tracking/videoFinder";

const CONTAINER_ID = "onside-overlay-root";
const IS_TOP = window.top === window;

function makeContainer(): HTMLDivElement {
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
  return container;
}

function mount() {
  if (document.getElementById(CONTAINER_ID)) return;
  createRoot(makeContainer()).render(<Overlay />);
}

/** Child frames: only mount when this frame hosts a big video (the player embed). */
function mountInFrame() {
  if (document.getElementById(CONTAINER_ID)) return;
  const v = findMainVideo();
  if (!v) return;
  const r = v.getBoundingClientRect();
  if (r.width < 400 || r.height < 200) return;
  createRoot(makeContainer()).render(<FrameTracker />);
}

if (IS_TOP) {
  // YouTube is an SPA — re-check on navigation.
  mount();
  document.addEventListener("yt-navigate-finish", mount);
} else {
  mountInFrame();
}

// Generic SPA guard (ČT / Nova / Tipsport players re-render aggressively):
// if our container gets removed by a route change, remount it.
setInterval(() => {
  if (IS_TOP) mount();
  else mountInFrame();
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
