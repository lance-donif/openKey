const DEFAULT_SUB2API_URL = "http://localhost:8080/admin/accounts";
const SESSION_KEY = "openKeyPendingImport";

function getSessionStorage() {
  return chrome.storage.session || chrome.storage.local;
}

async function getSettings() {
  const result = await chrome.storage.local.get({
    sub2apiUrl: DEFAULT_SUB2API_URL,
    ccApp: "claude"
  });
  return result;
}

async function openOrFocusSub2Api() {
  const { sub2apiUrl } = await getSettings();
  const url = /^https?:\/\//i.test(sub2apiUrl) ? sub2apiUrl : DEFAULT_SUB2API_URL;
  const tabs = await chrome.tabs.query({ url: [url, `${url}*`] });
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true, url });
    return tabs[0].id;
  }
  const tab = await chrome.tabs.create({ url });
  return tab.id;
}

async function notifyPendingImportReady(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PENDING_IMPORT_READY" });
  } catch (_error) {
    // A newly created tab may not have its content script yet; it will read storage on init.
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SAVE_SUB2API_IMPORT") {
    (async () => {
      await getSessionStorage().set({
        [SESSION_KEY]: {
          createdAt: Date.now(),
          configs: Array.isArray(message.configs) ? message.configs : []
        }
      });
      const tabId = await openOrFocusSub2Api();
      await notifyPendingImportReady(tabId);
      sendResponse({ ok: true, tabId });
    })().catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "OPEN_CCSWITCH_LINK") {
    (async () => {
      const url = String(message.url || "");
      if (!url.startsWith("ccswitch://")) throw new Error("无效的 CC Switch 深链接");
      const tab = await chrome.tabs.create({ url });
      sendResponse({ ok: true, tabId: tab.id });
    })().catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "GET_SETTINGS") {
    getSettings().then(settings => sendResponse({ ok: true, settings }));
    return true;
  }

  if (message?.type === "GET_PENDING_IMPORT") {
    getSessionStorage().get(SESSION_KEY).then(result => sendResponse({ ok: true, pending: result[SESSION_KEY] || null }));
    return true;
  }

  if (message?.type === "CLEAR_PENDING_IMPORT") {
    getSessionStorage().remove(SESSION_KEY).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "UPDATE_PENDING_IMPORT") {
    const configs = Array.isArray(message.configs) ? message.configs : [];
    const task = configs.length
      ? getSessionStorage().set({ [SESSION_KEY]: { createdAt: Date.now(), configs } })
      : getSessionStorage().remove(SESSION_KEY);
    task.then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});
