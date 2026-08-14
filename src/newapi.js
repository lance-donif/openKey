(function attachOpenKeyNewApi(root, factory) {
  const core =
    root.OpenKeyCore ||
    (typeof require === "function" ? require("./core.js") : null);
  const api = factory(core);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.OpenKeyNewApi = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function createOpenKeyNewApi(CORE) {
    "use strict";

    const BUDGET_MS = 3500;
    const CLIPBOARD_TIMEOUT_MS = 800;
    const CLIPBOARD_CHANNEL = "openkey-clipboard-v1";
    const DESTRUCTIVE =
      /删除|delete|移除|remove|禁用|disable|编辑|edit|聊天|chat/i;
    const KEY_ITEM =
      /^(?:复制密钥|Copy Key|复制连接信息|Copy Connection Info|复制链接信息)$/i;
    const DIRECT_COPY =
      '[title="复制到剪贴板"], [aria-label="复制到剪贴板"], [title="Copy to clipboard"], [aria-label="Copy to clipboard"]';
    const REVEAL_TOGGLE =
      '[aria-label="toggle token visibility"], [aria-label="Toggle token visibility"]';
    const REVEAL_COPY =
      '[aria-label="copy token key"], [aria-label="Copy token key"]';
    const MENU_TRIGGER = [
      '[data-slot="dropdown-menu-trigger"][aria-label="打开菜单"]',
      '[data-slot="dropdown-menu-trigger"][aria-label="Open menu"]',
      'button[aria-label="打开菜单"]',
      'button[aria-label="Open menu"]',
    ].join(", ");

    function text(value) {
      return String(value || "")
        .replace(/\s+/g, " ")
        .trim();
    }

    function nodeLabel(node) {
      return text(
        [
          node?.getAttribute?.("aria-label"),
          node?.getAttribute?.("title"),
          node?.textContent,
        ]
          .filter(Boolean)
          .join(" ")
      );
    }

    function isDestructiveControl(node) {
      return DESTRUCTIVE.test(nodeLabel(node));
    }

    function rowHas(rows, selector) {
      return rows.some((row) => row.rowEl?.querySelector?.(selector));
    }

    function detectAdapter(doc, rows = []) {
      // Row-level evidence outranks page-wide fallbacks: an unrelated control
      // elsewhere on the page must not mask the copy control inside these rows.
      if (rowHas(rows, REVEAL_TOGGLE)) return "reveal";
      if (rowHas(rows, DIRECT_COPY)) return "direct-copy";
      if (rowHas(rows, MENU_TRIGGER)) return "menu";
      if (doc?.querySelector?.(REVEAL_TOGGLE)) return "reveal";
      if (doc?.querySelector?.(DIRECT_COPY)) return "direct-copy";
      if (doc?.querySelector?.(MENU_TRIGGER)) return "menu";
      return "";
    }

    function defaultBudgetMs(rowCount = 1) {
      return Math.min(
        8000,
        Math.max(BUDGET_MS, 600 + Number(rowCount || 1) * 400)
      );
    }

    async function captureClipboard(run, timeout, win = window) {
      const token = `${Date.now()}-${Math.random()}`;
      return new Promise((resolve) => {
        let done = false;
        let started = false;
        const start = () => {
          if (started) return;
          started = true;
          clearTimeout(armTimer);
          Promise.resolve()
            .then(run)
            .then((clicked) => {
              if (clicked === false) finish("");
            })
            .catch(() => finish(""));
        };
        const finish = (value) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          clearTimeout(armTimer);
          win.removeEventListener("message", onMessage);
          win.postMessage(
            {
              channel: CLIPBOARD_CHANNEL,
              type: "disarm",
              token,
            },
            "*"
          );
          resolve(text(value));
        };
        const onMessage = (event) => {
          const payload = event?.data;
          if (payload?.channel !== CLIPBOARD_CHANNEL || payload.token !== token)
            return;
          if (payload.type === "armed") start();
          if (payload.type === "clipboard") finish(payload.text);
        };
        const timer = setTimeout(() => finish(""), Math.max(0, timeout));
        const armTimer = setTimeout(start, Math.min(32, Math.max(0, timeout)));
        win.addEventListener("message", onMessage);
        win.postMessage(
          {
            channel: CLIPBOARD_CHANNEL,
            type: "arm",
            token,
          },
          "*"
        );
      });
    }

    function remaining(deadline) {
      return Math.max(0, deadline - Date.now());
    }

    async function waitFor(check, deadline) {
      while (remaining(deadline) > 0) {
        const value = check();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      return null;
    }

    function visible(node) {
      return (
        Boolean(node) &&
        !node.hidden &&
        node.getAttribute?.("aria-hidden") !== "true" &&
        (!node.getClientRects || node.getClientRects().length > 0)
      );
    }

    function menuItemNodes(doc) {
      return [
        ...doc.querySelectorAll(
          '[role="menuitem"], [data-slot="dropdown-menu-item"], [data-radix-collection-item]'
        ),
      ];
    }

    function findMenuItem(doc, labelPattern, skipSet) {
      return menuItemNodes(doc).find(
        (node) =>
          !skipSet?.has(node) &&
          visible(node) &&
          !isDestructiveControl(node) &&
          labelPattern.test(text(node.textContent))
      );
    }

    function readKey(row) {
      const inputValues = [
        ...(row.keyCell?.querySelectorAll?.("input") || []),
      ].map((input) => input.value);
      return (
        [...inputValues, ...(CORE.getElementCandidates(row.keyCell) || [])]
          .map(CORE.normalizeNewApiKey)
          .find(Boolean) || ""
      );
    }

    function applyCopied(row, copied, sourceUrl) {
      if (!copied) return;
      Object.assign(row, CORE.mergeNewApiCopiedInfo(row, copied, sourceUrl));
      row.apiKey = CORE.normalizeNewApiKey(row.apiKey);
    }

    async function collectMenuSelection(
      row,
      trigger,
      itemPattern,
      doc,
      win,
      sourceUrl,
      deadline
    ) {
      if (!trigger || isDestructiveControl(trigger) || remaining(deadline) <= 0)
        return;
      const timeout = Math.min(CLIPBOARD_TIMEOUT_MS, remaining(deadline));
      const actionDeadline = Date.now() + timeout;
      // A previous row's menu can stay mounted during its exit animation.
      // Snapshot matching items before clicking so this row only ever clicks
      // an item opened by its own trigger; stale items fail closed.
      const staleItems = new Set(
        menuItemNodes(doc).filter(
          (node) => visible(node) && itemPattern.test(text(node.textContent))
        )
      );
      const copied = await captureClipboard(
        async () => {
          trigger.click();
          const item = await waitFor(
            () => findMenuItem(doc, itemPattern, staleItems),
            actionDeadline
          );
          if (!item) return false;
          item.click();
          return true;
        },
        timeout,
        win
      );
      applyCopied(row, copied, sourceUrl);
    }

    async function collectDirectRow(
      row,
      win,
      sourceUrl,
      deadline,
      selector = DIRECT_COPY
    ) {
      const button =
        row.keyCell?.querySelector?.(selector) ||
        row.rowEl?.querySelector?.(selector);
      if (!button || isDestructiveControl(button) || remaining(deadline) <= 0)
        return;
      const copied = await captureClipboard(
        () => {
          button.click();
          return true;
        },
        Math.min(CLIPBOARD_TIMEOUT_MS, remaining(deadline)),
        win
      );
      applyCopied(row, copied, sourceUrl);
    }

    async function collectRevealRow(row, doc, win, sourceUrl, deadline) {
      row.apiKey = readKey(row);
      if (row.apiKey) return;
      const toggle =
        row.keyCell?.querySelector?.(REVEAL_TOGGLE) ||
        row.rowEl?.querySelector?.(REVEAL_TOGGLE);
      if (toggle && !isDestructiveControl(toggle)) {
        toggle.click();
        row.apiKey =
          (await waitFor(
            () => readKey(row),
            Math.min(deadline, Date.now() + 200)
          )) || "";
      }
      if (!row.apiKey) {
        const trigger =
          row.keyCell?.querySelector?.(REVEAL_COPY) ||
          row.rowEl?.querySelector?.(REVEAL_COPY);
        await collectMenuSelection(
          row,
          trigger,
          KEY_ITEM,
          doc,
          win,
          sourceUrl,
          deadline
        );
      }
    }

    async function collectMenuRow(row, doc, win, sourceUrl, deadline) {
      if (row.apiKey || remaining(deadline) <= 0) return;
      const trigger =
        row.rowEl?.querySelector?.(MENU_TRIGGER) ||
        row.keyCell?.querySelector?.(MENU_TRIGGER);
      await collectMenuSelection(
        row,
        trigger,
        KEY_ITEM,
        doc,
        win,
        sourceUrl,
        deadline
      );
    }

    async function collectGenericCopyRow(row, doc, win, sourceUrl, deadline) {
      if (row.apiKey || remaining(deadline) <= 0) return;
      const nodes = [
        ...(row.keyCell?.querySelectorAll?.("button, [role='button'], a") ||
          []),
        ...(row.rowEl?.querySelectorAll?.("button, [role='button'], a") || []),
      ];
      const button = nodes.find((node) => {
        if (!visible(node) || isDestructiveControl(node)) return false;
        return /复制|copy|clipboard/i.test(nodeLabel(node));
      });
      if (!button) return;
      const copied = await captureClipboard(
        () => {
          button.click();
          return true;
        },
        Math.min(CLIPBOARD_TIMEOUT_MS, remaining(deadline)),
        win
      );
      applyCopied(row, copied, sourceUrl);
    }

    async function collectDomRows(
      rows,
      adapter,
      doc,
      win,
      sourceUrl,
      deadline
    ) {
      for (const row of rows) {
        if (row.apiKey || remaining(deadline) <= 0) continue;
        if (adapter === "reveal")
          await collectRevealRow(row, doc, win, sourceUrl, deadline);
        else if (adapter === "direct-copy")
          await collectDirectRow(row, win, sourceUrl, deadline);
        else if (adapter === "menu")
          await collectMenuRow(row, doc, win, sourceUrl, deadline);
        else {
          await collectGenericCopyRow(row, doc, win, sourceUrl, deadline);
          continue;
        }
        // A misdetected adapter must not strand an otherwise collectable row:
        // fall back to the row's own copy-labeled control (bounded, skips
        // destructive controls).
        if (!row.apiKey && remaining(deadline) > 0)
          await collectGenericCopyRow(row, doc, win, sourceUrl, deadline);
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
      return (
        leftParts.length > 1 &&
        rightParts.length > 1 &&
        leftParts[0] === rightParts[0] &&
        leftParts.at(-1) === rightParts.at(-1)
      );
    }

    function findTokenItem(row, items, usedIds) {
      const rawName = text(row.rawName || "");
      const available = items.filter((item) => {
        const id = Number(item?.id);
        return Number.isInteger(id) && id > 0 && !usedIds.has(id);
      });
      const byName = available.filter(
        (item) => rawName && text(item?.name) === rawName
      );
      if (byName.length === 1) return byName[0];
      const byMask = available.filter((item) =>
        sameMaskedKey(row.maskedKey, item?.key)
      );
      if (byMask.length === 1) return byMask[0];
      // Classic NewAPI token pages put the real id in the name column.
      if (rawName && /^\d+$/.test(rawName)) {
        const byId = available.filter(
          (item) => Number(item?.id) === Number(rawName)
        );
        if (byId.length === 1) return byId[0];
      }
      return null;
    }

    function listHasTokenId(items, tokenId) {
      const id = Number(tokenId);
      return (
        Number.isInteger(id) &&
        id > 0 &&
        items.some((item) => Number(item?.id) === id)
      );
    }

    function assignTokenId(row, id, source) {
      const tokenId = Number(id);
      if (!Number.isInteger(tokenId) || tokenId <= 0) return false;
      row.tokenId = tokenId;
      row.tokenIdSource = source;
      row.id = `token-${tokenId}`;
      return true;
    }

    function readModernTokenId(rowElement) {
      const fiberKey = Object.keys(rowElement || {}).find((key) =>
        key.startsWith("__reactFiber$")
      );
      let fiber = fiberKey ? rowElement[fiberKey] : null;
      for (
        let level = 0;
        fiber && level < 16;
        level += 1, fiber = fiber.return
      ) {
        const candidates = [
          fiber.memoizedProps?.row?.original?.id,
          fiber.pendingProps?.row?.original?.id,
          fiber.memoizedProps?.row?.id,
          fiber.pendingProps?.row?.id,
          fiber.memoizedProps?.original?.id,
          fiber.pendingProps?.original?.id,
          fiber.memoizedProps?.item?.id,
          fiber.pendingProps?.item?.id,
          fiber.memoizedProps?.token?.id,
          fiber.pendingProps?.token?.id,
          fiber.memoizedProps?.data?.id,
          fiber.pendingProps?.data?.id,
        ];
        for (const id of candidates) {
          if (Number.isInteger(id) && id > 0) return id;
          const numeric = Number(id);
          if (
            Number.isInteger(numeric) &&
            numeric > 0 &&
            String(id).trim() === String(numeric)
          ) {
            return numeric;
          }
        }
      }
      return 0;
    }

    async function resolveTokenIds(rows, origin, fetchImpl, deadline) {
      if (!rows.length || remaining(deadline) <= 0) return;

      for (const row of rows) {
        // Fiber ids only fill gaps: an id column / data-row-key is the most
        // trusted source and must not be replaced by an ancestor fiber's
        // data.id, which may belong to another entity (group, user, wrapper).
        if (row.tokenIdSource === "id" || row.tokenIdSource === "attr")
          continue;
        const fiberId = readModernTokenId(row.rowEl);
        if (fiberId) assignTokenId(row, fiberId, "fiber");
      }

      const needsList = rows.some(
        (row) => !row.tokenId || row.tokenIdSource === "name"
      );
      if (!needsList || remaining(deadline) <= 0) return;

      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        Math.min(1200, remaining(deadline))
      );
      let items = [];
      try {
        items = await CORE.fetchNewApiTokenList(origin, fetchImpl, {
          signal: controller.signal,
          size: Math.min(200, Math.max(20, rows.length * 2)),
        });
      } finally {
        clearTimeout(timer);
      }
      if (!items.length) return;

      const usedIds = new Set(
        rows
          .filter((row) => row.tokenId && row.tokenIdSource !== "name")
          .map((row) => Number(row.tokenId))
          .filter((id) => Number.isInteger(id) && id > 0)
      );
      // Drop name-derived ids that are not real token ids on this site, or
      // that collide with another row's id (duplicate numeric names are
      // allowed in NewAPI and must not export one token's key twice).
      for (const row of rows) {
        if (row.tokenIdSource !== "name" || !row.tokenId) continue;
        if (!usedIds.has(row.tokenId) && listHasTokenId(items, row.tokenId)) {
          usedIds.add(row.tokenId);
          row.tokenIdSource = "list-id";
          continue;
        }
        row.tokenId = 0;
        row.tokenIdSource = "";
      }

      for (const row of rows) {
        if (row.tokenId) continue;
        const item = findTokenItem(row, items, usedIds);
        if (item?.id && assignTokenId(row, item.id, "list"))
          usedIds.add(row.tokenId);
      }
    }

    async function collectApiRow(row, origin, fetchImpl, deadline) {
      if (row.apiKey || !row.tokenId || remaining(deadline) <= 0) return;
      // Name-derived ids are untrusted candidates. When the token list could
      // not be loaded they were never verified (tokenIdSource stays "name"),
      // so fetching a key by that id could silently export another token's
      // key. Fail closed; the DOM/clipboard fallback still applies.
      if (row.tokenIdSource === "name") return;
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        Math.min(1000, remaining(deadline))
      );
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

    async function collectMappedApiRows(rows, origin, fetchImpl, deadline) {
      if (!rows.length || remaining(deadline) <= 0) return;
      await resolveTokenIds(rows, origin, fetchImpl, deadline);
      await Promise.all(
        rows.map((row) => collectApiRow(row, origin, fetchImpl, deadline))
      );
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
      const apiFirst = options.apiFirst !== false;
      const budgetMs = options.budgetMs || defaultBudgetMs(rows.length);
      const deadline = Date.now() + budgetMs;

      if (apiFirst) {
        await collectMappedApiRows(
          rows,
          locationValue.origin,
          options.fetch,
          deadline
        );
        const unresolved = rows.filter(
          (row) => !CORE.normalizeNewApiKey(row.apiKey)
        );
        if (unresolved.length && remaining(deadline) > 0) {
          await collectDomRows(
            unresolved,
            adapter,
            doc,
            win,
            sourceUrl,
            deadline
          );
        }
      } else {
        await Promise.all([
          collectDomRows(rows, adapter, doc, win, sourceUrl, deadline),
          collectMappedApiRows(
            rows,
            locationValue.origin,
            options.fetch,
            deadline
          ),
        ]);
      }

      const name = pageUrl(locationValue);
      return rows.map((row) => ({
        id: row.id,
        name: name || row.endpoint || locationValue.origin,
        endpoint: row.endpoint || locationValue.origin,
        apiKey: CORE.normalizeNewApiKey(row.apiKey),
        model: "",
        source: sourceUrl,
        tokenId: row.tokenId || 0,
        adapter,
        needsManualKey: !CORE.normalizeNewApiKey(row.apiKey),
      }));
    }

    return {
      captureClipboard,
      collect,
      defaultBudgetMs,
      detectAdapter,
      isDestructiveControl,
    };
  }
);
