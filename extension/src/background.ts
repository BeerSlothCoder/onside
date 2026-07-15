// Onside background service worker.
chrome.runtime.onInstalled.addListener(() => {
  console.log("Onside installed — devnet mode");
});

// Proxy relay: content scripts run inside https stream pages, where fetching
// the local http://127.0.0.1:8787 data proxy can be blocked by the page CSP
// or Chrome's Private Network Access. The service worker runs on the extension
// origin with host_permissions, so it can reach the proxy freely. Content
// scripts send { onsideProxy: "/path" } and get the parsed JSON back.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && typeof msg.onsideProxy === "string") {
    const base = msg.base || "http://127.0.0.1:8787";
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3500);
    fetch(`${base}${msg.onsideProxy}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => sendResponse({ ok: true, data }))
      .catch(() => sendResponse({ ok: true, data: null }))
      .finally(() => clearTimeout(t));
    return true; // keep the message channel open for the async response
  }
  return undefined;
});
