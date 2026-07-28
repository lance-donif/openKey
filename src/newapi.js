(function attachOpenKeyNewApi(root, factory) {
  const core = root.OpenKeyCore || (typeof require === "function" ? require("./core.js") : null);
  const api = factory(core);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.OpenKeyNewApi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createOpenKeyNewApi(CORE) {
  "use strict";

  const BUDGET_MS = 900;
  const CLIPBOARD_CHANNEL = "openkey-clipboard-v1";
  const DESTRUCTIVE = /删除|delete|移除|remove|禁用|disable|编辑|edit|聊天|chat/i;
  const KEY_ITEM = /^(?:复制密钥|Copy Key)$/;

  function text(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function nodeLabel(node) {
    return text([
      node?.getAttribute?.("aria-label"),
      node?.getAttribute?.("title"),
      node?.textContent
    ].filter(Boolean).join(" "));
  }

  function isDestructiveControl(node) {
    return DESTRUCTIVE.test(nodeLabel(node));
  }

  function rowHas(rows, selector) {
    return rows.some(row => row.rowEl?.querySelector?.(selector));
  }

  function detectAdapter(doc, rows = []) {
    if (rowHas(rows, '[aria-label="toggle token visibility"]')
      || doc?.querySelector?.('[aria-label="toggle token visibility"]')) return "reveal";
    if (rowHas(rows, '[title="复制到剪贴板"]')
      || doc?.querySelector?.('[title="复制到剪贴板"]')) return "direct-copy";
    if (rowHas(rows, '[data-slot="dropdown-menu-trigger"][aria-label="打开菜单"]')
      || rowHas(rows, '[data-slot="dropdown-menu-trigger"][aria-label="Open menu"]')
      || doc?.querySelector?.('[data-slot="dropdown-menu-trigger"][aria-label="打开菜单"]')) return "menu";
    return "";
  }

  async function captureClipboard(run, timeout, win = window) {
    const token = `${Date.now()}-${Math.random()}`;
    return new Promise(resolve => {
      let done = false;
      let started = false;
      const start = () => {
        if (started) return;
        started = true;
        clearTimeout(armTimer);
        Promise.resolve().then(run).then(clicked => {
          if (clicked === false) finish("");
        }).catch(() => finish(""));
      };
      const finish = value => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearTimeout(armTimer);
        win.removeEventListener("message", onMessage);
        win.postMessage({
          channel: CLIPBOARD_CHANNEL,
          type: "disarm",
          token
        }, "*");
        resolve(text(value));
      };
      const onMessage = event => {
        const payload = event?.data;
        if (payload?.channel !== CLIPBOARD_CHANNEL || payload.token !== token) return;
        if (payload.type === "armed") start();
        if (payload.type === "clipboard") finish(payload.text);
      };
      const timer = setTimeout(() => finish(""), Math.max(0, timeout));
      const armTimer = setTimeout(start, Math.min(32, Math.max(0, timeout)));
      win.addEventListener("message", onMessage);
      win.postMessage({
        channel: CLIPBOARD_CHANNEL,
        type: "arm",
        token
      }, "*");
    });
  }

  function remaining(deadline) {
    return Math.max(0, deadline - Date.now());
  }

  async function waitFor(check, deadline) {
    while (remaining(deadline) > 0) {
      const value = check();
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    return null;
  }

  function visible(node) {
    return Boolean(node)
      && !node.hidden
      && node.getAttribute?.("aria-hidden") !== "true"
      && (!node.getClientRects || node.getClientRects().length > 0);
  }

  function findMenuItem(doc, labelPattern) {
    return [...doc.querySelectorAll(
      '[role="menuitem"], [data-slot="dropdown-menu-item"], [data-radix-collection-item]'
    )].find(node => visible(node)
      && !isDestructiveControl(node)
      && labelPattern.test(text(node.textContent)));
  }

  function readKey(row) {
    const inputValues = [...(row.keyCell?.querySelectorAll?.("input") || [])].map(input => input.value);
    return [...inputValues, ...(CORE.getElementCandidates(row.keyCell) || [])]
      .map(CORE.normalizeNewApiKey)
      .find(Boolean) || "";
  }

  function applyCopied(row, copied, sourceUrl) {
    if (!copied) return;
    Object.assign(row, CORE.mergeNewApiCopiedInfo(row, copied, sourceUrl));
    row.apiKey = CORE.normalizeNewApiKey(row.apiKey);
  }

  async function collectMenuSelection(row, trigger, itemPattern, doc, win, sourceUrl, deadline) {
    if (!trigger || isDestructiveControl(trigger) || remaining(deadline) <= 0) return;
    const timeout = Math.min(550, remaining(deadline));
    const actionDeadline = Date.now() + timeout;
    const copied = await captureClipboard(async () => {
      trigger.click();
      const item = await waitFor(() => findMenuItem(doc, itemPattern), actionDeadline);
      if (!item) return false;
      item.click();
      return true;
    }, timeout, win);
    applyCopied(row, copied, sourceUrl);
  }

  async function collectDirectRow(row, win, sourceUrl, deadline, selector) {
    const button = row.keyCell?.querySelector?.(selector);
    if (!button || isDestructiveControl(button) || remaining(deadline) <= 0) return;
    const copied = await captureClipboard(() => {
      button.click();
      return true;
    }, Math.min(550, remaining(deadline)), win);
    applyCopied(row, copied, sourceUrl);
  }

  async function collectRevealRow(row, doc, win, sourceUrl, deadline) {
    row.apiKey = readKey(row);
    if (row.apiKey) return;
    const toggle = row.keyCell?.querySelector?.('[aria-label="toggle token visibility"]');
    if (toggle && !isDestructiveControl(toggle)) {
      toggle.click();
      row.apiKey = await waitFor(
        () => readKey(row),
        Math.min(deadline, Date.now() + 160)
      ) || "";
    }
    if (!row.apiKey) {
      const trigger = row.keyCell?.querySelector?.('[aria-label="copy token key"]');
      await collectMenuSelection(row, trigger, KEY_ITEM, doc, win, sourceUrl, deadline);
    }
  }

  async function collectDomRows(rows, adapter, doc, win, sourceUrl, deadline) {
    for (const row of rows) {
      if (row.apiKey || remaining(deadline) <= 0) continue;
      if (adapter === "reveal") await collectRevealRow(row, doc, win, sourceUrl, deadline);
      if (adapter === "direct-copy") {
        await collectDirectRow(row, win, sourceUrl, deadline, '[title="复制到剪贴板"]');
      }
    }
  }

  function maskedParts(value) {
    return text(value)
      .replace(/^sk[-_]/i, "")
      .split(/(?:\*+|•+|…+|\.{3,})/)
      .filter(Boolean);
  }

  function sameMaskedKey(left, right) {
    const leftParts = maskedParts(left);
    const rightParts = maskedParts(right);
    return leftParts.length > 1
      && rightParts.length > 1
      && leftParts[0] === rightParts[0]
      && leftParts.at(-1) === rightParts.at(-1);
  }

  function findTokenItem(row, items) {
    const rawName = text(row.rawName || (row.tokenId ? String(row.tokenId) : ""));
    const byName = items.filter(item => rawName && text(item?.name) === rawName);
    if (byName.length === 1) return byName[0];
    const byMask = items.filter(item => sameMaskedKey(row.maskedKey, item?.key));
    return byMask.length === 1 ? byMask[0] : null;
  }

  function readModernTokenId(rowElement) {
    const fiberKey = Object.keys(rowElement || {}).find(key => key.startsWith("__reactFiber$"));
    let fiber = fiberKey ? rowElement[fiberKey] : null;
    for (let level = 0; fiber && level < 12; level += 1, fiber = fiber.return) {
      const id = fiber.memoizedProps?.row?.original?.id
        ?? fiber.pendingProps?.row?.original?.id;
      if (Number.isInteger(id) && id > 0) return id;
    }
    return 0;
  }

  async function collectMappedApiRows(rows, origin, fetchImpl, deadline) {
    if (remaining(deadline) <= 0) return;
    const unresolved = [];
    for (const row of rows) {
      const id = readModernTokenId(row.rowEl);
      if (id) row.tokenId = id;
      else unresolved.push(row);
    }
    if (unresolved.length) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(450, remaining(deadline)));
      let items = [];
      try {
        items = await CORE.fetchNewApiTokenList(origin, fetchImpl, {
          signal: controller.signal,
          size: Math.max(20, rows.length)
        });
      } finally {
        clearTimeout(timer);
      }
      for (const row of unresolved) {
        const item = findTokenItem(row, items);
        if (item?.id) row.tokenId = Number(item.id);
      }
    }
    await Promise.all(rows.map(row => collectApiRow(row, origin, fetchImpl, deadline)));
  }

  async function collectApiRow(row, origin, fetchImpl, deadline) {
    if (row.apiKey || !row.tokenId || remaining(deadline) <= 0) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(600, remaining(deadline)));
    try {
      const key = await CORE.fetchNewApiTokenKey(
        origin,
        row.tokenId,
        fetchImpl,
        { signal: controller.signal }
      );
      if (!row.apiKey && key) row.apiKey = key;
    } finally {
      clearTimeout(timer);
    }
  }

  function pageUrl(locationValue) {
    try {
      const url = new URL(locationValue.href);
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    } catch (_error) {
      return locationValue.origin || "";
    }
  }

  async function collect(options = {}) {
    const doc = options.document || document;
    const locationValue = options.location || location;
    const win = options.window || window;
    const sourceUrl = locationValue.href;
    const rows = CORE.extractNewApiRows(doc, sourceUrl);
    const adapter = detectAdapter(doc, rows);
    const deadline = Date.now() + (options.budgetMs || BUDGET_MS);
    const apiWork = adapter === "menu"
      ? collectMappedApiRows(rows, locationValue.origin, options.fetch, deadline)
      : Promise.all(rows.map(row => collectApiRow(row, locationValue.origin, options.fetch, deadline)));
    await Promise.all([
      collectDomRows(rows, adapter, doc, win, sourceUrl, deadline),
      apiWork
    ]);
    const name = pageUrl(locationValue);
    return rows.map(row => ({
      id: row.id,
      name: name || row.endpoint || locationValue.origin,
      endpoint: row.endpoint || locationValue.origin,
      apiKey: CORE.normalizeNewApiKey(row.apiKey),
      model: "",
      source: sourceUrl,
      needsManualKey: !CORE.normalizeNewApiKey(row.apiKey)
    }));
  }

  return {
    captureClipboard,
    collect,
    detectAdapter,
    isDestructiveControl
  };
});
