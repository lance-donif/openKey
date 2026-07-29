(function openKeyContentScript() {
  "use strict";

  const CORE = globalThis.OpenKeyCore;
  const NEW_API = globalThis.OpenKeyNewApi;
  const widgets = new Map();
  let pageObserver = null;
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

  function contextInvalid(error) {
    return !chrome.runtime?.id || /Extension context invalidated/i.test(String(error?.message || error || ""));
  }

  async function sendRuntimeMessage(message) {
    if (!chrome.runtime?.id) {
      pageObserver?.disconnect();
      return null;
    }
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      if (!contextInvalid(error)) throw error;
      pageObserver?.disconnect();
      return null;
    }
  }

  async function getPendingImport() {
    const result = await sendRuntimeMessage({ type: "GET_PENDING_IMPORT" });
    return result?.pending || null;
  }

  function configItemHtml(config, index, options = {}) {
    const manualKey = config.apiKey ? "" : `<div class="field"><label>API Key（未自动识别，可手工补充）</label><input type="password" data-manual-key="${index}" placeholder="粘贴 API Key 或 Base64"><label class="check"><input type="checkbox" data-manual-key-base64="${index}">输入内容是 Base64 编码</label></div>`;
    const modelLine = options.hideModel ? "" : `<br>模型：${escapeHtml(config.model || "未识别")}`;
    return `<div class="item"><div class="item-top"><input type="checkbox" data-config-check="${index}" ${options.checked === false ? "" : "checked"}><div><div class="item-title">${escapeHtml(config.name || `配置 ${index + 1}`)}</div><div class="item-meta">地址：${escapeHtml(config.endpoint || "未识别")}<br>Key：${escapeHtml(CORE.maskSecret(config.apiKey))}${modelLine}</div></div></div>${manualKey}</div>`;
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

  async function initNewApiPage() {
    const hasApiKeyTable = [...document.querySelectorAll("table")].some(table => CORE.isNewApiTokenHeaders(CORE.getHeaderTexts(table)));
    if (!CORE.isNewApiKeysPath(location.pathname) || !hasApiKeyTable) return;
    const anchor = findButton(document, text => text === "状态" || text === "Status")
      || findButton(document, text => /^(?:创建 API 密钥|Create API Key|添加令牌|添加密钥|新建令牌|Add Token)$/i.test(text))
      || findButton(document, text => /创建|添加|新建/.test(text) && /密钥|令牌|key|token/i.test(text));
    const widget = createWidget("openkey-newapi-widget", "导出到 Sub2API", anchor);
    widget?.mount?.(anchor);
    if (!widget || widget.__initialized) return;
    widget.__initialized = true;
    widget.onAction = async () => {
      widget.setBusy(true);
      try {
        const configs = await NEW_API.collect();
        if (!configs.length) {
          widget.open("没有发现 API Key 列表", `<div class="warning">请确认当前页面是 NewAPI 的 API 密钥列表页，并等待列表加载完成。</div>`, [{ label: "关闭", onClick: () => widget.close(), primary: true }]);
          return;
        }
        const recognized = configs.filter(config => config.apiKey).length;
        const notice = recognized === configs.length
          ? `<div class="notice">已自动识别 ${recognized}/${configs.length} 条 Key。选中后会直接创建 Sub2API 账号，再清除所有模型、同步上游全量模型，最后加入“白嫖”分组。</div>`
          : `<div class="notice">已自动识别 ${recognized}/${configs.length} 条 Key；失败行请在下方粘贴补全。选中后会直接创建 Sub2API 账号，再清除所有模型、同步上游全量模型，最后加入“白嫖”分组。</div>`;
        widget.open("选择要导入的配置", `${notice}${configs.map((config, index) => configItemHtml(config, index, { hideModel: true })).join("")}`, [
          { label: "取消", onClick: () => widget.close() },
          { label: "直接导入 Sub2API", primary: true, onClick: async button => {
            const selected = getSelectedConfigs(widget.shadow, configs);
            if (!selected.length) return;
            if (selected.some(config => !config.apiKey)) {
              widget.body.insertAdjacentHTML("afterbegin", `<div class="warning">有配置没有识别到完整 Key，请在本面板补充后再继续。</div>`);
              return;
            }
            button.disabled = true;
            const result = await sendRuntimeMessage({ type: "SAVE_SUB2API_IMPORT", configs: selected });
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
    const result = await sendRuntimeMessage({ type: "UPDATE_PENDING_IMPORT", configs });
    if (!result?.ok) throw new Error(result?.error || "更新待导入配置失败");
  }

  function getNativeSub2ApiDialog(titlePattern = /^(?:添加账号|Add Account)$/) {
    return [...document.querySelectorAll('[role="dialog"]')]
      .find(dialog => visible(dialog) && titlePattern.test(normalizeText(dialog.querySelector("h1, h2, h3")?.textContent)));
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

  function findAccountRowByName(name) {
    const target = normalizeText(name);
    if (!target) return null;
    const rows = [...document.querySelectorAll("tr, [role='row'], li, .divide-y > *")].filter(visible);
    return rows.find(row => {
      const text = normalizeText(row.innerText || row.textContent);
      if (!text.includes(target)) return false;
      return Boolean(findButton(row, value => value === "编辑" || value === "Edit" || value.startsWith("编辑") || value.startsWith("Edit")));
    }) || null;
  }

  async function openAccountEditDialog(name) {
    const row = await waitFor(() => findAccountRowByName(name), 10000);
    if (!row) throw new Error(`创建后未在列表中找到账号“${name}”`);
    const editButton = findButton(row, value => value === "编辑" || value === "Edit" || value.startsWith("编辑") || value.startsWith("Edit"));
    if (!editButton) throw new Error(`账号“${name}”没有编辑按钮`);
    editButton.click();
    const dialog = await waitFor(() => getNativeSub2ApiDialog(/^(?:编辑账号|Edit Account)$/), 10000);
    if (!dialog) throw new Error("Sub2API 编辑账号表单没有打开");
    return dialog;
  }

  async function ensureModelWhitelistMode(dialog) {
    const whitelistButton = findButton(dialog, text => text === "模型白名单" || text === "Model Whitelist" || /模型白名单|Model Whitelist/i.test(text));
    whitelistButton?.click();
  }

  async function clearAllModelsInDialog(dialog) {
    const clearButton = await waitFor(
      () => findButton(dialog, text => text === "清除所有模型" || text === "Clear all models"),
      8000
    );
    if (!clearButton) throw new Error("清除所有模型：没有找到按钮");
    clearButton.click();
  }

  function countDialogModels(dialog) {
    if (!dialog) return 0;
    const checks = [...dialog.querySelectorAll('input[type="checkbox"]')].filter(visible);
    // Group checkboxes are few; model whitelist rows dominate after sync.
    const modelish = checks.filter(input => {
      const text = normalizeText(input.closest("label")?.innerText || input.parentElement?.innerText || "");
      if (!text) return false;
      if (/^(?:白嫖|default|分组|Group|模型白名单|Model Whitelist)/i.test(text)) return false;
      return true;
    });
    if (modelish.length) return modelish.length;
    const chips = [...dialog.querySelectorAll('[class*="model"], [class*="tag"], li, [role="option"], [role="listitem"]')]
      .filter(visible)
      .map(node => normalizeText(node.innerText || node.textContent))
      .filter(text => text && text.length < 80 && !/同步上游|清除所有模型|模型白名单|保存|取消|分组/i.test(text));
    return chips.length;
  }

  function isSyncUpstreamBusy(dialog) {
    const button = findButton(dialog, text => /同步上游|Sync upstream/i.test(text));
    if (!button) return false;
    const label = normalizeText(button.innerText || button.textContent);
    return button.disabled || /同步上游中|Syncing upstream|同步中|Loading|加载中/i.test(label);
  }

  async function syncUpstreamModelsInDialog(dialog) {
    const syncButton = await waitFor(
      () => findButton(dialog, text => text === "同步上游支持的模型" || text === "Sync upstream supported models" || /^同步上游/.test(text) || /^Sync upstream/i.test(text)),
      8000
    );
    if (!syncButton) throw new Error("同步上游：没有找到“同步上游支持的模型”按钮");
    syncButton.click();

    // Upstream sync is slow: wait until not busy AND the model list actually has entries.
    let stableHits = 0;
    const ready = await waitFor(() => {
      if (isSyncUpstreamBusy(dialog)) {
        stableHits = 0;
        return null;
      }
      const count = countDialogModels(dialog);
      if (count <= 0) {
        stableHits = 0;
        return null;
      }
      stableHits += 1;
      // Keep the list stable for a couple polls so late-arriving rows are kept.
      return stableHits >= 3 ? count : null;
    }, 120000);

    if (!ready) {
      throw new Error("同步上游：已结束但模型列表仍为空，请检查上游地址/密钥后重试");
    }
  }

  async function selectGroupAndSaveDialog(dialog, groupLabel) {
    const groupCheckbox = await waitFor(() => findNativeGroupCheckbox(dialog, groupLabel), 8000);
    if (!groupCheckbox) throw new Error(`选择分组：没有找到“${groupLabel}”分组`);
    if (!groupCheckbox.checked) groupCheckbox.click();

    const saveButton = findButton(dialog, text => text === "保存" || text === "更新" || text === "Save" || text === "Update");
    if (!saveButton) throw new Error("保存账号：没有找到保存/更新按钮");
    saveButton.click();
    const closed = await waitFor(() => !document.contains(dialog) || !visible(dialog), 15000);
    if (!closed) throw new Error("保存账号：Sub2API 没有确认保存结果");
  }

  async function finishSub2ApiAccountModelsAndGroup(plan) {
    const dialog = await openAccountEditDialog(plan.name);
    try {
      await ensureModelWhitelistMode(dialog);
      await clearAllModelsInDialog(dialog);
      await syncUpstreamModelsInDialog(dialog);
      await selectGroupAndSaveDialog(dialog, plan.groupLabel);
    } catch (error) {
      const closeButton = findButton(dialog, text => text === "取消" || text === "Cancel" || text === "关闭" || text === "Close");
      closeButton?.click();
      throw error;
    }
  }

  async function createSub2ApiAccountWithNativeUi(config) {
    const plan = CORE.buildSub2ApiUiImportPlan(config);
    if (!plan.endpoint || !plan.apiKey) throw new Error("缺少完整地址或 API Key");

    const addButton = findButton(document, text => text === "添加账号" || text === "Add Account");
    if (!addButton) throw new Error("没有找到 Sub2API 的添加账号按钮");
    addButton.click();

    const dialog = await waitFor(() => getNativeSub2ApiDialog(/^(?:添加账号|Add Account)$/));
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

    const createButton = findButton(dialog, text => text === "创建" || text === "Create");
    if (!createButton) throw new Error("没有找到 Sub2API 创建按钮");
    createButton.click();
    const closed = await waitFor(() => !document.contains(dialog) || !visible(dialog), 10000);
    if (!closed) throw new Error("Sub2API 没有确认账号创建结果");

    await finishSub2ApiAccountModelsAndGroup(plan);
  }

  let handledDirectImportAt = 0;

  async function runDirectSub2ApiImport(pending) {
    const widget = createWidget("openkey-sub2api-widget", "OpenKey", null);
    widget.action.hidden = true;
    widget.host.style.width = "0";
    widget.close();

    const remaining = [];
    const errors = [];
    let imported = 0;
    for (const config of pending.configs) {
      if (!config.apiKey || !config.endpoint) {
        remaining.push(config);
        errors.push(`${config.name || "配置"}：缺少完整地址或 API Key`);
        continue;
      }
      try {
        await createSub2ApiAccountWithNativeUi(config);
        imported += 1;
      } catch (error) {
        remaining.push(config);
        errors.push(`${config.name || "配置"}：${error?.message || "导入失败"}`);
      }
    }
    try {
      await updatePendingConfigs(remaining);
      const failed = remaining.length
        ? `<div class="warning">${remaining.length} 条未完成（创建/清模型/同步上游/分组任一失败）。${errors.length ? `<br>${errors.map(item => escapeHtml(item)).join("<br>")}` : ""}</div>`
        : "";
      widget.open(
        "Sub2API 直接导入完成",
        `<div class="notice">已完成 ${imported} 条：创建账号 → 清除所有模型 → 同步上游全量模型 → 加入“白嫖”分组。</div>${failed}`,
        [{ label: "关闭", onClick: () => widget.close(), primary: true }]
      );
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
              const result = await sendRuntimeMessage({ type: "OPEN_CCSWITCH_LINK", url: CORE.buildCcSwitchLink(config, app) });
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
    if (!chrome.runtime?.id) {
      pageObserver?.disconnect();
      return;
    }
    initNewApiPage();
    if (location.hostname === "linux.do") initLinuxDoPage();
    initSub2ApiPage();
  }

  let queued = false;
  pageObserver = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; init(); });
  });
  pageObserver.observe(document.documentElement, { childList: true, subtree: true });
  init();
})();
