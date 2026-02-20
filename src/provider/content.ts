/**
 * Content script — bridge between the inpage provider and the background.
 *
 * 1. Injects the inpage script into the host page.
 * 2. Listens for postMessage from the inpage script, forwards to background.
 * 3. Sends background responses back to the inpage script via postMessage.
 * 4. When a request fails with "locked", queues it and retries automatically
 *    once KEYSTORE_CHANGED fires (i.e. after the user unlocks).
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
//  Pending-unlock queue
//  Requests that returned a "locked" error are held here and retried
//  automatically when the wallet is unlocked (KEYSTORE_CHANGED).
// ------------------------------------------------------------------

interface QueuedRequest {
  id: number;
  method: string;
  params: any;
}

const _lockedQueue: QueuedRequest[] = [];

function isLockedError(error: string): boolean {
  return error.toLowerCase().includes("locked");
}

async function sendToBackground(method: string, params: any): Promise<any> {
  return chrome.runtime.sendMessage({
    type: "PROVIDER_REQUEST",
    method,
    params,
    origin: window.location.origin,
  });
}

function replyToPage(id: number, response: any): void {
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
}

// ------------------------------------------------------------------
//  Relay messages: inpage -> background -> inpage
// ------------------------------------------------------------------

window.addEventListener("message", async (event) => {
  if (event.source !== window) return;

  const data = event.data;
  if (!data || data.channel !== CHANNEL || data.direction !== "to-content") return;

  const { id, method, params } = data;

  try {
    const response = await sendToBackground(method, params);

    // If the wallet is locked, queue the request and open the unlock popup.
    // It will be retried automatically when KEYSTORE_CHANGED fires.
    if (response?.error && isLockedError(response.error)) {
      _lockedQueue.push({ id, method, params });
      return; // Don't reply yet — wait for unlock
    }

    replyToPage(id, response);
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

    // Retry all requests that were queued while the wallet was locked
    if (_lockedQueue.length > 0) {
      const queued = _lockedQueue.splice(0);
      for (const req of queued) {
        sendToBackground(req.method, req.params)
          .then((response) => replyToPage(req.id, response))
          .catch((err) => replyToPage(req.id, { error: err.message || String(err) }));
      }
    }
  }
});

console.log("[GG Wallet] Content script loaded");
