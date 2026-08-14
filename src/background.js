const DEFAULT_SUB2API_URL = "http://localhost:8080/admin/accounts";
const SESSION_KEY = "openKeyPendingImport";

function parseHttpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return /^https?:$/.test(url.protocol) && Boolean(url.hostname) ? url : null;
  } catch (_error) {
    return null;
  }
}

function getSessionStorage() {
  return chrome.storage.session || chrome.storage.local;
}

function makeTaskId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function respondAsync(task, sendResponse) {
  Promise.resolve(task)
    .then((value) => sendResponse({ ok: true, ...value }))
    .catch((error) =>
      sendResponse({ ok: false, error: error?.message || "操作失败" })
    );
}

async function getSettings() {
  const result = await chrome.storage.local.get({
    sub2apiUrl: DEFAULT_SUB2API_URL,
    ccApp: "claude",
  });
  return result;
}

async function openOrFocusSub2Api() {
  const { sub2apiUrl } = await getSettings();
  const url = parseHttpUrl(sub2apiUrl)?.toString() || DEFAULT_SUB2API_URL;
  // Match patterns cannot contain "?" or "#"; query/hash are stripped only
  // for tab lookup — tab creation keeps the full URL.
  const parsed = parseHttpUrl(url);
  const patternBase = parsed ? `${parsed.origin}${parsed.pathname}` : url;
  const tabs = await chrome.tabs.query({
    url: [patternBase, `${patternBase}*`],
  });
  if (tabs.length) {
    // Never pass `url` here: reloading a tab that is already on the target
    // page would kill a content script mid-import. Focus only; if the tab
    // has no receiver, notifyPendingImportReady reloads to re-inject.
    await chrome.tabs.update(tabs[0].id, { active: true });
    await notifyPendingImportReady(tabs[0].id, url);
    return tabs[0].id;
  }
  const tab = await chrome.tabs.create({ url });
  await notifyPendingImportReady(tab.id);
  return tab.id;
}

async function notifyPendingImportReady(tabId, reloadUrl) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PENDING_IMPORT_READY" });
  } catch (error) {
    // A fresh tab's content script just hasn't loaded yet — it reads storage
    // on init. Only an existing tab with no receiver (e.g. after an
    // extension reload) needs a reload to re-inject the script; that cannot
    // interrupt an import because an unscripted tab has none running.
    if (
      reloadUrl &&
      /Receiving end does not exist/i.test(String(error?.message || ""))
    ) {
      await chrome.tabs.update(tabId, { url: reloadUrl });
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SAVE_SUB2API_IMPORT") {
    (async () => {
      const taskId = makeTaskId();
      const createdAt = Date.now();
      const storage = getSessionStorage();
      const previous = (await storage.get(SESSION_KEY))[SESSION_KEY] || null;
      await storage.set({
        [SESSION_KEY]: {
          taskId,
          createdAt,
          configs: Array.isArray(message.configs) ? message.configs : [],
        },
      });
      try {
        const tabId = await openOrFocusSub2Api();
        sendResponse({ ok: true, tabId, taskId });
      } catch (error) {
        const current = await storage.get(SESSION_KEY);
        if (current[SESSION_KEY]?.taskId === taskId) {
          if (previous) await storage.set({ [SESSION_KEY]: previous });
          else await storage.remove(SESSION_KEY);
        }
        throw error;
      }
    })().catch((error) =>
      sendResponse({ ok: false, error: error.message || "操作失败" })
    );
    return true;
  }

  if (message?.type === "OPEN_CCSWITCH_LINK") {
    (async () => {
      const url = String(message.url || "");
      if (!url.startsWith("ccswitch://"))
        throw new Error("无效的 CC Switch 深链接");
      const tab = await chrome.tabs.create({ url });
      sendResponse({ ok: true, tabId: tab.id });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "GET_SETTINGS") {
    respondAsync(
      getSettings().then((settings) => ({ settings })),
      sendResponse
    );
    return true;
  }

  if (message?.type === "GET_PENDING_IMPORT") {
    respondAsync(
      getSessionStorage()
        .get(SESSION_KEY)
        .then((result) => ({ pending: result[SESSION_KEY] || null })),
      sendResponse
    );
    return true;
  }

  if (message?.type === "CLEAR_PENDING_IMPORT") {
    respondAsync(
      getSessionStorage()
        .remove(SESSION_KEY)
        .then(() => ({})),
      sendResponse
    );
    return true;
  }

  if (message?.type === "UPDATE_PENDING_IMPORT") {
    const configs = Array.isArray(message.configs) ? message.configs : [];
    const taskId = String(message.taskId || "");
    const createdAt = Number.isFinite(Number(message.createdAt))
      ? Number(message.createdAt)
      : Date.now();
    const storage = getSessionStorage();
    const task = storage.get(SESSION_KEY).then((result) => {
      const current = result[SESSION_KEY];
      if (taskId && current?.taskId && current.taskId !== taskId) {
        throw new Error("待导入任务已被其他页面更新");
      }
      return configs.length
        ? storage.set({ [SESSION_KEY]: { taskId, createdAt, configs } })
        : storage.remove(SESSION_KEY);
    });
    respondAsync(
      task.then(() => ({ taskId, createdAt: configs.length ? createdAt : 0 })),
      sendResponse
    );
    return true;
  }

  return false;
});
