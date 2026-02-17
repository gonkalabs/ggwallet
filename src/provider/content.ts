/**
 * Content script — bridge between the inpage provider and the background.
 *
 * 1. Injects the inpage script into the host page.
 * 2. Listens for postMessage from the inpage script, forwards to background.
 * 3. Sends background responses back to the inpage script via postMessage.
 */

const CHANNEL = "gonka-wallet-provider";

// ------------------------------------------------------------------
//  Inject the inpage script into the page's main world
// ------------------------------------------------------------------

function injectScript(): void {
  try {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("src/provider/inpage.js");
    script.type = "module";
    // Insert as early as possible
    const container = document.head || document.documentElement;
    container.insertBefore(script, container.children[0] || null);
    script.onload = () => script.remove();
  } catch (err) {
    console.error("[GG Wallet] Failed to inject inpage script:", err);
  }
}

injectScript();

// ------------------------------------------------------------------
//  Relay messages: inpage -> background -> inpage
// ------------------------------------------------------------------

window.addEventListener("message", async (event) => {
  // Only accept messages from our page
  if (event.source !== window) return;

  const data = event.data;
  if (!data || data.channel !== CHANNEL || data.direction !== "to-content") return;

  const { id, method, params } = data;

  try {
    // Forward to background service worker, including the page origin
    const response = await chrome.runtime.sendMessage({
      type: "PROVIDER_REQUEST",
      method,
      params,
      origin: window.location.origin,
    });

    if (response && response.error) {
      window.postMessage(
        { channel: CHANNEL, direction: "to-inpage", id, error: response.error },
        "*",
      );
    } else {
      window.postMessage(
        { channel: CHANNEL, direction: "to-inpage", id, result: response?.result ?? response },
        "*",
      );
    }
  } catch (err: any) {
    window.postMessage(
      { channel: CHANNEL, direction: "to-inpage", id, error: err.message || String(err) },
      "*",
    );
  }
});

// ------------------------------------------------------------------
//  Listen for events from background (e.g. keystore changes)
// ------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "KEYSTORE_CHANGED") {
    // Dispatch a custom event that dApps can listen for (Keplr compatibility)
    window.dispatchEvent(new Event("keplr_keystorechange"));
  }
});

console.log("[GG Wallet] Content script loaded");
