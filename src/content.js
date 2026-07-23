(function openKeyContentScript() {
  "use strict";

  const CORE = globalThis.OpenKeyCore;
  const widgets = new Map();
  const WIDGET_STYLE = `
    :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    :host(.anchored) { position: relative; display: block; width: auto; margin: 8px 0 0; z-index: 2147483645; }
    * { box-sizing: border-box; }
    button, input, select, textarea { font: inherit; }
    .action { border: 0; border-radius: 8px; padding: 8px 12px; color: #fff; background: #2563eb; cursor: pointer; font-size: 13px; line-height: 1.2; box-shadow: 0 1px 2px rgba(15,23,42,.14); }
    .action:hover { background: #1d4ed8; }
    .action:disabled { opacity: .6; cursor: wait; }
    .panel-backdrop { position: fixed; inset: 0; z-index: 2147483646; background: rgba(15,23,42,.36); display: grid; place-items: center; padding: 20px; }
    .panel-backdrop[hidden] { display: none; }
    :host(.anchored) .panel-backdrop { position: absolute; inset: auto; top: calc(100% + 8px); left: 0; width: min(460px, calc(100vw - 32px)); display: block; padding: 0; background: transparent; }
    :host(.anchored) .panel-backdrop[hidden] { display: none; }
    :host(.anchored) .panel { width: 100%; max-height: min(680px, calc(100vh - 180px)); border-radius: 8px; }
    .panel { width: min(720px, calc(100vw - 40px)); max-height: min(760px, calc(100vh - 40px)); overflow: auto; background: #fff; color: #0f172a; border: 1px solid #dbe3ef; border-radius: 16px; box-shadow: 0 24px 80px rgba(15,23,42,.28); }
    .panel-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px 14px; border-bottom: 1px solid #e5e7eb; }
    .panel-head h2 { margin: 0; font-size: 17px; }
    .close { border: 0; background: transparent; color: #64748b; cursor: pointer; font-size: 20px; padding: 0 4px; }
    .panel-body { padding: 18px 20px; font-size: 14px; }
    .panel-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px 18px; border-top: 1px solid #e5e7eb; }
    .secondary { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 12px; color: #334155; background: #fff; cursor: pointer; }
    .primary { border: 0; border-radius: 8px; padding: 8px 12px; color: #fff; background: #2563eb; cursor: pointer; }
    .danger { color: #b91c1c; }
    .muted { color: #64748b; }
    .notice { border-radius: 10px; background: #eff6ff; color: #1e40af; padding: 10px 12px; margin-bottom: 12px; line-height: 1.5; }
    .warning { border-radius: 10px; background: #fff7ed; color: #9a3412; padding: 10px 12px; margin-bottom: 12px; line-height: 1.5; }
    .item { border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; margin: 10px 0; }
    .item-top { display: flex; gap: 10px; align-items: flex-start; }
    .item-top input[type=checkbox] { margin-top: 3px; }
    .item-title { font-weight: 600; }
    .item-meta { color: #64748b; font-size: 12px; margin-top: 5px; word-break: break-word; }
    .field { display: grid; gap: 5px; margin-top: 12px; }
    .check { display: flex; align-items: center; gap: 6px; margin-top: 8px; color: #475569; font-size: 12px; }
    .field label { font-size: 12px; color: #475569; }
    .field input, .field select, .field textarea { width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; color: #0f172a; background: #fff; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 560px) { .grid { grid-template-columns: 1fr; } }
  `;

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function visible(element) {
    if (!element) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function normalizeText(value) { return String(value || "").replace(/\s+/g, " ").trim(); }

  function pageButtons(root = document) {
    return [...root.querySelectorAll("button")].filter(visible);
  }

  function findButton(root, matcher) {
    return pageButtons(root).find(button => matcher(normalizeText(button.innerText || button.textContent || ""), button));
  }

  async function waitFor(check, timeout = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const value = check();
      if (value) return value;
      await sleep(80);
    }
    return null;
  }

  function createWidget(id, label, anchor, options = {}) {
    const existing = widgets.get(id);
    if (existing) return existing;
    document.getElementById(id)?.remove();
    const host = document.createElement("span");
    host.id = id;
    host.style.display = "inline-block";
    host.style.verticalAlign = "middle";
    host.style.marginLeft = "8px";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>${WIDGET_STYLE}</style>
      <button class="action" type="button">${label}</button>
      <div class="panel-backdrop" hidden>
        <section class="panel" role="dialog" aria-modal="true">
          <header class="panel-head"><h2></h2><button class="close" type="button" aria-label="关闭">×</button></header>
          <div class="panel-body"></div>
          <footer class="panel-foot"></footer>
        </section>
      </div>`;
    const widget = {
      host,
      shadow,
      action: shadow.querySelector(".action"),
      backdrop: shadow.querySelector(".panel-backdrop"),
      title: shadow.querySelector(".panel-head h2"),
      body: shadow.querySelector(".panel-body"),
      foot: shadow.querySelector(".panel-foot"),
      open(title, html, actions = []) {
        widget.title.textContent = title;
        widget.body.innerHTML = html;
        widget.foot.innerHTML = "";
        for (const action of actions) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = action.primary ? "primary" : "secondary";
          button.textContent = action.label;
          button.addEventListener("click", () => action.onClick?.(button));
          widget.foot.appendChild(button);
        }
        widget.backdrop.hidden = false;
      },
      close() { widget.backdrop.hidden = true; },
      setBusy(value) { widget.action.disabled = Boolean(value); },
      mount(anchor, mountOptions = {}) {
        const isAnchored = mountOptions.placement === "below-anchor";
        const mountParent = isAnchored
          ? (anchor?.matches?.(".topic-avatar") ? anchor : anchor?.closest?.(".topic-avatar") || anchor?.parentElement)
          : anchor?.parentElement;
        const placement = mountParent ? (isAnchored ? "below-anchor" : "inline-after") : "fallback";
        const targetParent = mountParent || document.documentElement;
        if (!CORE.needsWidgetRemount(host.parentElement, targetParent, host.dataset.openkeyPlacement, placement)) return true;

        host.classList.toggle("anchored", placement === "below-anchor");
        host.style.position = "";
        host.style.right = "";
        host.style.bottom = "";
        host.style.zIndex = "";
        host.style.width = "";
        host.style.margin = "";

        if (placement === "below-anchor") {
          targetParent.appendChild(host);
          host.style.display = "block";
          host.style.margin = "8px 0 0";
          host.dataset.openkeyPlacement = placement;
          return true;
        }

        if (placement === "inline-after") {
          targetParent.insertBefore(host, anchor.nextSibling);
          host.style.display = "inline-block";
          host.style.verticalAlign = "middle";
          host.style.marginLeft = "8px";
          host.dataset.openkeyPlacement = placement;
          return true;
        }

        host.classList.remove("anchored");
        host.style.position = "fixed";
        host.style.right = "20px";
        host.style.bottom = "20px";
        host.style.zIndex = "2147483645";
        host.style.display = "inline-block";
        targetParent.appendChild(host);
        host.dataset.openkeyPlacement = placement;
        return false;
      }
    };
    shadow.querySelector(".close").addEventListener("click", () => widget.close());
    widget.action.addEventListener("click", () => widget.onAction?.());
    widget.mount(anchor, options);
    host.__openKeyWidget = widget;
    widgets.set(id, widget);
    return widget;
  }

  async function getPendingImport() {
    const result = await chrome.runtime.sendMessage({ type: "GET_PENDING_IMPORT" });
    return result?.pending || null;
  }

  function configItemHtml(config, index, options = {}) {
    const manualKey = config.apiKey ? "" : `<div class="field"><label>API Key（未自动识别，可手工补充）</label><input type="password" data-manual-key="${index}" placeholder="粘贴 API Key 或 Base64"><label class="check"><input type="checkbox" data-manual-key-base64="${index}">输入内容是 Base64 编码</label></div>`;
    return `<div class="item"><div class="item-top"><input type="checkbox" data-config-check="${index}" ${options.checked === false ? "" : "checked"}><div><div class="item-title">${escapeHtml(config.name || `配置 ${index + 1}`)}</div><div class="item-meta">地址：${escapeHtml(config.endpoint || "未识别")}<br>Key：${escapeHtml(CORE.maskSecret(config.apiKey))}<br>模型：${escapeHtml(config.model || "未识别")}</div></div></div>${manualKey}</div>`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  }

  function getSelectedConfigs(root, configs, options = {}) {
    return configs.flatMap((config, index) => {
      const checkbox = root.querySelector(`[data-config-check="${index}"]`);
      if (!checkbox?.checked) return [];
      const manual = root.querySelector(`[data-manual-key="${index}"]`);
      const isBase64 = root.querySelector(`[data-manual-key-base64="${index}"]`)?.checked;
      const apiKey = config.apiKey || CORE.resolveManualApiKey(manual?.value, isBase64);
      return [{ ...config, apiKey, ...(options.withIndex ? { __openKeyIndex: index } : {}) }];
    });
  }

  async function readClipboardText() {
    try {
      return (await navigator.clipboard?.readText?.())?.trim() || "";
    } catch (_error) {
      return "";
    }
  }

  function findMenuItem(labels) {
    const expected = Array.isArray(labels) ? labels : [labels];
    return [...document.querySelectorAll('[role="menuitem"]')]
      .find(item => visible(item) && expected.includes(normalizeText(item.innerText || item.textContent))) || null;
  }

  async function copyNewApiMenuText(row, labels) {
    const tableRow = row.keyCell?.closest("tr");
    const menuButton = tableRow?.querySelector('button[aria-label="打开菜单"], button[aria-label="Open menu"], button[aria-haspopup="menu"]');
    if (!menuButton) return "";

    menuButton.click();
    const menuItem = await waitFor(() => findMenuItem(labels));
    if (!menuItem) return "";
    menuItem.click();
    await sleep(120);
    return readClipboardText();
  }

  async function collectNewApiConfigs() {
    const rows = CORE.extractNewApiRows(document, location.href);
    for (const row of rows) {
      const connectionInfo = await copyNewApiMenuText(row, ["复制连接信息", "Copy Connection Info"]);
      Object.assign(row, CORE.mergeNewApiCopiedInfo(row, connectionInfo, location.href));
      if (!row.apiKey) {
        const copiedKey = await copyNewApiMenuText(row, ["复制密钥", "Copy API Key"]);
        Object.assign(row, CORE.mergeNewApiCopiedInfo(row, copiedKey, location.href));
      }
      row.keyCell = undefined;
    }
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      endpoint: row.endpoint,
      apiKey: row.apiKey,
      model: row.model,
      source: location.href,
      needsManualKey: !row.apiKey
    }));
  }

  async function initNewApiPage() {
    const hasApiKeyTable = [...document.querySelectorAll("table")].some(table => /api\s*(?:密钥|key)/i.test(table.querySelector("thead")?.textContent || ""));
    if (!location.pathname.startsWith("/keys") || !hasApiKeyTable) return;
    const anchor = findButton(document, text => text === "状态" || text === "Status") || findButton(document, text => /^(?:创建 API 密钥|Create API Key)$/i.test(text));
    const widget = createWidget("openkey-newapi-widget", "导出到 Sub2API", anchor);
    widget?.mount?.(anchor);
    if (!widget || widget.__initialized) return;
    widget.__initialized = true;
    widget.onAction = async () => {
      widget.setBusy(true);
      try {
        const configs = await collectNewApiConfigs();
        if (!configs.length) {
          widget.open("没有发现 API Key 列表", `<div class="warning">请确认当前页面是 NewAPI 的 API 密钥列表页，并等待列表加载完成。</div>`, [{ label: "关闭", onClick: () => widget.close(), primary: true }]);
          return;
        }
        widget.open("选择要导入的配置", `<div class="notice">选中后会直接创建 Sub2API 账号、同步上游模型并加入“白嫖”分组，不再要求在账号页确认。</div>${configs.map((config, index) => configItemHtml(config, index)).join("")}`, [
          { label: "取消", onClick: () => widget.close() },
          { label: "直接导入 Sub2API", primary: true, onClick: async button => {
            const selected = getSelectedConfigs(widget.shadow, configs);
            if (!selected.length) return;
            if (selected.some(config => !config.apiKey)) {
              widget.body.insertAdjacentHTML("afterbegin", `<div class="warning">有配置没有识别到完整 Key，请补充后再继续。</div>`);
              return;
            }
            button.disabled = true;
            const result = await chrome.runtime.sendMessage({ type: "SAVE_SUB2API_IMPORT", configs: selected });
            if (!result?.ok) {
              widget.body.insertAdjacentHTML("afterbegin", `<div class="warning">开始直接导入失败：${escapeHtml(result?.error || "未知错误")}</div>`);
              button.disabled = false;
              return;
            }
            widget.close();
          } }
        ]);
      } catch (error) {
        widget.open("导出失败", `<div class="warning">${escapeHtml(error.message || "页面结构暂不兼容")}</div>`, [{ label: "关闭", onClick: () => widget.close(), primary: true }]);
      } finally {
        widget.setBusy(false);
      }
    };
  }

  async function updatePendingConfigs(configs) {
    const result = await chrome.runtime.sendMessage({ type: "UPDATE_PENDING_IMPORT", configs });
    if (!result?.ok) throw new Error(result?.error || "更新待导入配置失败");
  }

  function getNativeSub2ApiDialog() {
    return [...document.querySelectorAll('[role="dialog"]')]
      .find(dialog => visible(dialog) && /^(?:添加账号|Add Account)$/.test(normalizeText(dialog.querySelector("h1, h2, h3")?.textContent)));
  }

  function findNativeInput(dialog, placeholderPattern) {
    return [...dialog.querySelectorAll("input, textarea")]
      .find(input => visible(input) && placeholderPattern.test(String(input.getAttribute("placeholder") || ""))) || null;
  }

  function setNativeInputValue(input, value) {
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findNativeGroupCheckbox(dialog, label) {
    return [...dialog.querySelectorAll('input[type="checkbox"]')].find(input => {
      const text = normalizeText(input.closest("label")?.innerText || input.parentElement?.innerText);
      return text.startsWith(label);
    }) || null;
  }

  async function createSub2ApiAccountWithNativeUi(config) {
    const plan = CORE.buildSub2ApiUiImportPlan(config);
    if (!plan.endpoint || !plan.apiKey) throw new Error("缺少完整地址或 API Key");

    const addButton = findButton(document, text => text === "添加账号" || text === "Add Account");
    if (!addButton) throw new Error("没有找到 Sub2API 的添加账号按钮");
    addButton.click();

    const dialog = await waitFor(getNativeSub2ApiDialog);
    if (!dialog) throw new Error("Sub2API 添加账号表单没有打开");

    const platformButton = findButton(dialog, text => text === plan.platformLabel);
    platformButton?.click();
    const typeButton = await waitFor(() => findButton(dialog, text => text === plan.typeLabel || text.startsWith(`${plan.typeLabel} `)));
    if (!typeButton) throw new Error("Sub2API 不支持 OpenAI API Key 账号类型");
    typeButton.click();

    const nameInput = await waitFor(() => findNativeInput(dialog, /^(?:请输入账号名称|Account name)/i));
    const endpointInput = await waitFor(() => findNativeInput(dialog, /^https:\/\/api\.openai\.com/i));
    const apiKeyInput = await waitFor(() => findNativeInput(dialog, /^sk-/i));
    if (!nameInput || !endpointInput || !apiKeyInput) throw new Error("Sub2API OpenAI API Key 表单不完整");
    setNativeInputValue(nameInput, plan.name);
    setNativeInputValue(endpointInput, plan.endpoint);
    setNativeInputValue(apiKeyInput, plan.apiKey);

    const groupCheckbox = await waitFor(() => findNativeGroupCheckbox(dialog, plan.groupLabel));
    if (!groupCheckbox) throw new Error(`没有找到“${plan.groupLabel}”分组`);
    if (!groupCheckbox.checked) groupCheckbox.click();

    const createButton = findButton(dialog, text => text === "创建" || text === "Create");
    if (!createButton) throw new Error("没有找到 Sub2API 创建按钮");
    createButton.click();
    const closed = await waitFor(() => !document.contains(dialog) || !visible(dialog), 10000);
    if (!closed) throw new Error("Sub2API 没有确认账号创建结果");
  }

  let handledDirectImportAt = 0;

  async function runDirectSub2ApiImport(pending) {
    const widget = createWidget("openkey-sub2api-widget", "OpenKey", null);
    widget.action.hidden = true;
    widget.host.style.width = "0";
    widget.close();

    const remaining = [];
    let imported = 0;
    for (const config of pending.configs) {
      if (!config.apiKey || !config.endpoint) {
        remaining.push(config);
        continue;
      }
      try {
        await createSub2ApiAccountWithNativeUi(config);
        imported += 1;
      } catch (_error) {
        remaining.push(config);
      }
    }
    try {
      await updatePendingConfigs(remaining);
      const failed = remaining.length ? `<div class="warning">${remaining.length} 条未导入，请回到 Key 页重新尝试。</div>` : "";
      widget.open("Sub2API 直接导入完成", `<div class="notice">已创建 ${imported} 条账号，并加入“白嫖”分组。</div>${failed}`, [{ label: "关闭", onClick: () => widget.close(), primary: true }]);
    } catch (error) {
      widget.open("Sub2API 直接导入失败", `<div class="warning">${escapeHtml(error.message || "无法创建账号")}</div>`, [{ label: "关闭", onClick: () => widget.close(), primary: true }]);
    }
  }

  async function initSub2ApiPage() {
    const hasAccountsUi = Boolean(findButton(document, text => text === "添加账号" || text === "Add Account"));
    if (!/^https?:$/.test(location.protocol) || !location.pathname.startsWith("/admin/accounts") || !hasAccountsUi) return;
    const pending = await getPendingImport();
    if (!pending?.configs?.length || pending.createdAt === handledDirectImportAt) return;
    handledDirectImportAt = pending.createdAt;
    await runDirectSub2ApiImport(pending);
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "PENDING_IMPORT_READY" && location.pathname.startsWith("/admin/accounts")) {
      initSub2ApiPage().catch(error => console.warn("OpenKey: direct import failed", error));
    }
  });

  async function initLinuxDoPage() {
    if (location.hostname !== "linux.do" || !location.pathname.startsWith("/t/")) return;
    const ownerArticle = document.querySelector("main article") || document.querySelector("article");
    const avatar = ownerArticle?.querySelector("img.avatar") || ownerArticle?.querySelector("img");
    const anchor = avatar?.closest?.(".topic-avatar") || avatar || document.querySelector("main h1") || findButton(document, text => text.includes("回复"));
    const widget = createWidget("openkey-linuxdo-widget", "导入到 CC Switch", anchor, { placement: "below-anchor" });
    widget?.mount?.(anchor, { placement: "below-anchor" });
    if (!widget || widget.__initialized) return;
    widget.__initialized = true;
    widget.onAction = async () => {
      widget.setBusy(true);
      try {
        const configs = CORE.collectLinuxDoConfigs(document, location.href);
        if (!configs.length) {
          widget.open("没有发现可导入配置", `<div class="warning">当前页面没有识别到网址或 API Key。若配置在图片中，请把图片里的配置复制为文本后再试。</div>`, [{ label: "关闭", onClick: () => widget.close(), primary: true }]);
          return;
        }
        const settings = await chrome.storage.local.get({ ccApp: "claude" });
        widget.open("选择 CC Switch 导入方式", `<div class="notice">CC Switch 使用 ccswitch:// 深链接导入。链接包含 API Key，只会在你点击“导入”时交给本机 CC Switch。</div><div class="field"><label>目标应用</label><select data-cc-app><option value="claude">Claude Code</option><option value="codex">Codex</option><option value="grok">Grok</option></select></div>${configs.map((config, index) => configItemHtml(config, index)).join("")}`, [
          { label: "关闭", onClick: () => widget.close() },
          { label: "导入选中配置", primary: true, onClick: async button => {
            const selected = getSelectedConfigs(widget.shadow, configs);
            const app = widget.shadow.querySelector("[data-cc-app]")?.value || "claude";
            if (!selected.length || selected.some(config => !config.apiKey || !config.endpoint)) {
              widget.body.insertAdjacentHTML("afterbegin", `<div class="warning">每条配置都需要完整网址和 API Key。</div>`);
              return;
            }
            button.disabled = true;
            for (const config of selected) {
              const result = await chrome.runtime.sendMessage({ type: "OPEN_CCSWITCH_LINK", url: CORE.buildCcSwitchLink(config, app) });
              if (!result?.ok) {
                widget.body.insertAdjacentHTML("afterbegin", `<div class="warning">打开 CC Switch 失败：${escapeHtml(result?.error || "未知错误")}</div>`);
                break;
              }
              await sleep(250);
            }
            button.disabled = false;
          } }
        ]);
        const appSelect = widget.shadow.querySelector("[data-cc-app]");
        if (appSelect && settings.ccApp) appSelect.value = settings.ccApp;
      } catch (error) {
        widget.open("识别失败", `<div class="warning">${escapeHtml(error.message || "页面结构暂不兼容")}</div>`, [{ label: "关闭", onClick: () => widget.close(), primary: true }]);
      } finally {
        widget.setBusy(false);
      }
    };
  }

  function init() {
    initNewApiPage();
    if (location.hostname === "linux.do") initLinuxDoPage();
    initSub2ApiPage();
  }

  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; init(); });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  init();
})();
