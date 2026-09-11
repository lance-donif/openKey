(function openKeyContentScript() {
  "use strict";

  const CORE = globalThis.OpenKeyCore;
  const NEW_API = globalThis.OpenKeyNewApi;
  const createWidget = globalThis.OpenKeyWidget?.create;
  let pageObserver = null;
  let linuxDoTopicKey = "";

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function visible(element) {
    if (!element) return false;
    const style = getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      element.getClientRects().length > 0
    );
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function pageButtons(root = document) {
    return [...root.querySelectorAll("button")].filter(visible);
  }

  function findButton(root, matcher) {
    return pageButtons(root).find((button) =>
      matcher(
        normalizeText(button.innerText || button.textContent || ""),
        button
      )
    );
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

  function contextInvalid(error) {
    return (
      !chrome.runtime?.id ||
      /Extension context invalidated/i.test(
        String(error?.message || error || "")
      )
    );
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
    const manualKey = config.apiKey
      ? ""
      : `<div class="field"><label>API Key（未自动识别，可手工补充）</label><input type="password" data-manual-key="${index}" placeholder="粘贴 API Key 或 Base64"><label class="check"><input type="checkbox" data-manual-key-base64="${index}">输入内容是 Base64 编码</label></div>`;
    const modelLine = options.hideModel
      ? ""
      : `<br>模型：${escapeHtml(config.model || "未识别")}`;
    return `<div class="item"><div class="item-top"><input type="checkbox" data-config-check="${index}" ${options.checked === false ? "" : "checked"}><div><div class="item-title">${escapeHtml(config.name || `配置 ${index + 1}`)}</div><div class="item-meta">地址：${escapeHtml(config.endpoint || "未识别")}<br>Key：${escapeHtml(config.apiKey || "未识别")}${modelLine}</div></div></div>${manualKey}</div>`;
  }

  function plainKeyRowsHtml(configs) {
    const keys = [
      ...new Set(
        (configs || []).map((config) => config.apiKey).filter(Boolean)
      ),
    ];
    if (!keys.length) return `<div class="muted">暂无可用 Key。</div>`;
    return keys
      .map(
        (key, index) => `
      <div class="key-row">
        <div class="key-text" data-plain-key="${index}">${escapeHtml(key)}</div>
        <button type="button" class="copy-key" data-copy-key="${index}">复制</button>
      </div>
    `
      )
      .join("");
  }

  function bindPlainKeyCopyButtons(root, configs) {
    const keys = [
      ...new Set(
        (configs || []).map((config) => config.apiKey).filter(Boolean)
      ),
    ];
    for (const button of root.querySelectorAll("[data-copy-key]")) {
      button.addEventListener("click", async () => {
        const index = Number(button.getAttribute("data-copy-key"));
        const key = keys[index] || "";
        if (!key) return;
        try {
          await navigator.clipboard.writeText(key);
          button.dataset.copied = "1";
          button.textContent = "已复制";
          setTimeout(() => {
            button.dataset.copied = "0";
            button.textContent = "复制";
          }, 1200);
        } catch (_error) {
          button.textContent = "复制失败";
        }
      });
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(
      /[&<>'"]/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        })[character]
    );
  }

  function selectionToolbarHtml(total) {
    return `<div class="select-bar" data-select-bar><span class="muted" data-select-count>已选 ${total}/${total}</span><span class="select-actions"><button type="button" class="link" data-select-all>全选</button><button type="button" class="link" data-select-none>全不选</button><button type="button" class="link" data-select-invert>反选</button></span></div>`;
  }

  function bindSelectionBar(root) {
    const bar = root.querySelector("[data-select-bar]");
    if (!bar) return;
    const boxes = () => [...root.querySelectorAll("[data-config-check]")];
    const count = bar.querySelector("[data-select-count]");
    const update = () => {
      const all = boxes();
      const checked = all.filter((box) => box.checked).length;
      if (count) count.textContent = `已选 ${checked}/${all.length}`;
    };
    const allBtn = bar.querySelector("[data-select-all]");
    const noneBtn = bar.querySelector("[data-select-none]");
    const invertBtn = bar.querySelector("[data-select-invert]");
    if (allBtn)
      allBtn.addEventListener("click", () => {
        boxes().forEach((b) => {
          b.checked = true;
        });
        update();
      });
    if (noneBtn)
      noneBtn.addEventListener("click", () => {
        boxes().forEach((b) => {
          b.checked = false;
        });
        update();
      });
    if (invertBtn)
      invertBtn.addEventListener("click", () => {
        boxes().forEach((b) => {
          b.checked = !b.checked;
        });
        update();
      });
    boxes().forEach((b) => b.addEventListener("change", update));
    update();
  }

  function showInlineWarning(widget, html) {
    widget.body
      .querySelectorAll("[data-inline-warning]")
      .forEach((n) => n.remove());
    widget.body.insertAdjacentHTML(
      "afterbegin",
      '<div class="warning" data-inline-warning>' + html + "</div>"
    );
    widget.body.scrollTop = 0;
  }

  function getSelectedConfigs(root, configs, options = {}) {
    return configs.flatMap((config, index) => {
      const checkbox = root.querySelector(`[data-config-check="${index}"]`);
      if (!checkbox?.checked) return [];
      const manual = root.querySelector(`[data-manual-key="${index}"]`);
      const isBase64 = root.querySelector(
        `[data-manual-key-base64="${index}"]`
      )?.checked;
      const apiKey =
        config.apiKey || CORE.resolveManualApiKey(manual?.value, isBase64);
      return [
        {
          ...config,
          apiKey,
          ...(options.withIndex ? { __openKeyIndex: index } : {}),
        },
      ];
    });
  }

  async function initNewApiPage() {
    if (!CORE.isNewApiKeysPath(location.pathname)) return;
    const hasApiKeyTable = [...document.querySelectorAll("table")].some(
      (table) => CORE.isNewApiTokenHeaders(CORE.getHeaderTexts(table))
    );
    if (!hasApiKeyTable) return;
    const anchor =
      findButton(document, (text) => text === "状态" || text === "Status") ||
      findButton(document, (text) =>
        /^(?:创建 API 密钥|Create API Key|添加令牌|添加密钥|新建令牌|Add Token)$/i.test(
          text
        )
      ) ||
      findButton(
        document,
        (text) =>
          /创建|添加|新建/.test(text) && /密钥|令牌|key|token/i.test(text)
      );
    const widget = createWidget(
      "openkey-newapi-widget",
      "导出到 Sub2API",
      anchor
    );
    widget?.mount?.(anchor);
    if (!widget || widget.__initialized) return;
    widget.__initialized = true;
    widget.onAction = async () => {
      widget.setBusy(true);
      try {
        const configs = await NEW_API.collect();
        if (!configs.length) {
          widget.open(
            "没有发现 API Key 列表",
            `<div class="warning">请确认当前页面是 NewAPI 的 API 密钥列表页，并等待列表加载完成。</div>`,
            [{ label: "关闭", onClick: () => widget.close(), primary: true }]
          );
          return;
        }
        const recognized = configs.filter((config) => config.apiKey).length;
        const notice =
          recognized === configs.length
            ? `<div class="notice">已自动识别 ${recognized}/${configs.length} 条 Key。选中后会直接创建 Sub2API 账号，再清除所有模型、同步上游全量模型，最后加入“白嫖”分组。</div>`
            : `<div class="notice">已自动识别 ${recognized}/${configs.length} 条 Key；失败行请在下方粘贴补全。选中后会直接创建 Sub2API 账号，再清除所有模型、同步上游全量模型，最后加入“白嫖”分组。</div>`;
        widget.open(
          "选择要导入的配置",
          `${notice}${selectionToolbarHtml(configs.length)}${configs.map((config, index) => configItemHtml(config, index, { hideModel: true })).join("")}`,
          [
            { label: "取消", onClick: () => widget.close() },
            {
              label: "直接导入 Sub2API",
              primary: true,
              onClick: async (button) => {
                const selected = getSelectedConfigs(widget.shadow, configs);
                if (!selected.length) {
                  showInlineWarning(widget, "请至少选择一条配置。");
                  return;
                }
                if (selected.some((config) => !config.apiKey)) {
                  showInlineWarning(
                    widget,
                    "有配置没有识别到完整 Key，请在本面板补充后再继续。"
                  );
                  return;
                }
                button.disabled = true;
                const result = await sendRuntimeMessage({
                  type: "SAVE_SUB2API_IMPORT",
                  configs: selected,
                });
                if (!result?.ok) {
                  showInlineWarning(
                    widget,
                    `开始直接导入失败：${escapeHtml(result?.error || "未知错误")}`
                  );
                  button.disabled = false;
                  return;
                }
                widget.close();
              },
            },
          ]
        );
        bindSelectionBar(widget.shadow);
      } catch (error) {
        widget.open(
          "导出失败",
          `<div class="warning">${escapeHtml(error.message || "页面结构暂不兼容")}</div>`,
          [{ label: "关闭", onClick: () => widget.close(), primary: true }]
        );
      } finally {
        widget.setBusy(false);
      }
    };
  }

  let activeImportTask = null;

  async function updatePendingConfigs(configs) {
    const result = await sendRuntimeMessage({
      type: "UPDATE_PENDING_IMPORT",
      configs,
      taskId: activeImportTask?.taskId,
      createdAt: activeImportTask?.createdAt,
    });
    if (!result?.ok) throw new Error(result?.error || "更新待导入配置失败");
    return result;
  }

  function getNativeSub2ApiDialog(titlePattern = /^(?:添加账号|Add Account)$/) {
    return [...document.querySelectorAll('[role="dialog"]')].find(
      (dialog) =>
        visible(dialog) &&
        titlePattern.test(
          normalizeText(dialog.querySelector("h1, h2, h3")?.textContent)
        )
    );
  }

  function findNativeInput(dialog, placeholderPattern) {
    return (
      [...dialog.querySelectorAll("input, textarea")].find(
        (input) =>
          visible(input) &&
          placeholderPattern.test(
            String(input.getAttribute("placeholder") || "")
          )
      ) || null
    );
  }

  function setNativeInputValue(input, value) {
    const prototype =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findNativeGroupCheckbox(dialog, label) {
    return (
      [...dialog.querySelectorAll('input[type="checkbox"]')].find((input) => {
        const text = normalizeText(
          input.closest("label")?.innerText || input.parentElement?.innerText
        );
        return text.startsWith(label);
      }) || null
    );
  }

  function findAccountRowsByName(name) {
    const target = normalizeText(name);
    if (!target) return null;
    const rows = [
      ...document.querySelectorAll("tr, [role='row'], li, .divide-y > *"),
    ].filter(visible);
    const matches = rows.filter((row) => {
      const text = normalizeText(row.innerText || row.textContent);
      if (!text || !text.includes(target)) return false;
      const exactName = [...row.querySelectorAll("*")].some(
        (node) => normalizeText(node.innerText || node.textContent) === target
      );
      if (!exactName && text !== target) return false;
      return Boolean(
        findButton(
          row,
          (value) =>
            value === "编辑" ||
            value === "Edit" ||
            value.startsWith("编辑") ||
            value.startsWith("Edit")
        )
      );
    });
    return matches.filter(
      (row) =>
        !matches.some((parent) => parent !== row && parent.contains?.(row))
    );
  }

  function findAccountRowByName(name) {
    const matches = findAccountRowsByName(name);
    if (matches?.length === 1) return matches[0];
    if (matches?.length > 1)
      throw new Error(`账号“${name}”存在多个精确匹配，已停止以避免误编辑`);
    return null;
  }

  async function openAccountEditDialog(name) {
    const row = await waitFor(() => findAccountRowByName(name), 10000);
    if (!row) throw new Error(`创建后未在列表中找到账号“${name}”`);
    const editButton = findButton(
      row,
      (value) =>
        value === "编辑" ||
        value === "Edit" ||
        value.startsWith("编辑") ||
        value.startsWith("Edit")
    );
    if (!editButton) throw new Error(`账号“${name}”没有编辑按钮`);
    editButton.click();
    const dialog = await waitFor(
      () => getNativeSub2ApiDialog(/^(?:编辑账号|Edit Account)$/),
      10000
    );
    if (!dialog) throw new Error("Sub2API 编辑账号表单没有打开");
    return dialog;
  }

  async function ensureModelWhitelistMode(dialog) {
    const whitelistButton = findButton(
      dialog,
      (text) =>
        text === "模型白名单" ||
        text === "Model Whitelist" ||
        /模型白名单|Model Whitelist/i.test(text)
    );
    if (!whitelistButton) throw new Error("模型白名单：没有找到模式按钮");
    if (
      !/true|active|selected/i.test(
        String(
          whitelistButton.getAttribute("aria-pressed") ||
            whitelistButton.className ||
            ""
        )
      )
    ) {
      whitelistButton.click();
    }
    const stateValue = () =>
      [
        whitelistButton.getAttribute?.("aria-pressed"),
        whitelistButton.getAttribute?.("aria-selected"),
        whitelistButton.getAttribute?.("data-state"),
        whitelistButton.className,
      ]
        .filter(Boolean)
        .join(" ");
    const hasObservableState = Boolean(
      whitelistButton.getAttribute?.("aria-pressed") ||
      whitelistButton.getAttribute?.("aria-selected") ||
      whitelistButton.getAttribute?.("data-state") ||
      /active|selected/i.test(String(whitelistButton.className || ""))
    );
    if (hasObservableState) {
      const selected = await waitFor(
        () => (/true|active|selected|on/i.test(stateValue()) ? true : null),
        1500
      );
      if (!selected) throw new Error("模式切换状态未确认");
    } else {
      await sleep(80);
    }
  }

  async function clearAllModelsInDialog(dialog) {
    const clearButton = await waitFor(
      () =>
        findButton(
          dialog,
          (text) => text === "清除所有模型" || text === "Clear all models"
        ),
      8000
    );
    if (!clearButton) throw new Error("清除所有模型：没有找到按钮");
    clearButton.click();
    const cleared = await waitFor(() => countDialogModels(dialog) === 0, 8000);
    if (!cleared) throw new Error("清除模型：操作未完成");
  }

  function countDialogModels(dialog) {
    if (!dialog) return 0;
    const checks = [
      ...dialog.querySelectorAll('input[type="checkbox"]'),
    ].filter(visible);
    // Group checkboxes are few; model whitelist rows dominate after sync.
    const modelish = checks.filter((input) => {
      const text = normalizeText(
        input.closest("label")?.innerText ||
          input.parentElement?.innerText ||
          ""
      );
      if (!text) return false;
      if (/^(?:白嫖|default|分组|Group|模型白名单|Model Whitelist)/i.test(text))
        return false;
      return true;
    });
    if (modelish.length) return modelish.length;
    const chips = [
      ...dialog.querySelectorAll(
        '[class*="model"], [class*="tag"], li, [role="option"], [role="listitem"]'
      ),
    ]
      .filter(visible)
      .map((node) => normalizeText(node.innerText || node.textContent))
      .filter(
        (text) =>
          text &&
          text.length < 80 &&
          !/同步上游|清除所有模型|模型白名单|保存|取消|分组/i.test(text)
      );
    return chips.length;
  }

  function isSyncUpstreamBusy(dialog) {
    const button = findButton(dialog, (text) =>
      /同步上游|Sync upstream/i.test(text)
    );
    if (!button) return false;
    const label = normalizeText(button.innerText || button.textContent);
    return (
      button.disabled ||
      /同步上游中|Syncing upstream|同步中|Loading|加载中/i.test(label)
    );
  }

  async function syncUpstreamModelsInDialog(dialog) {
    const syncButton = await waitFor(
      () =>
        findButton(
          dialog,
          (text) =>
            text === "同步上游支持的模型" ||
            text === "Sync upstream supported models" ||
            /^同步上游/.test(text) ||
            /^Sync upstream/i.test(text)
        ),
      8000
    );
    if (!syncButton)
      throw new Error("同步上游：没有找到“同步上游支持的模型”按钮");
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
      throw new Error(
        "同步上游：已结束但模型列表仍为空，请检查上游地址/密钥后重试"
      );
    }
  }

  async function selectGroupAndSaveDialog(dialog, groupLabel, accountName) {
    const groupCheckbox = await waitFor(
      () => findNativeGroupCheckbox(dialog, groupLabel),
      8000
    );
    if (!groupCheckbox)
      throw new Error(`选择分组：没有找到“${groupLabel}”分组`);
    if (!groupCheckbox.checked) groupCheckbox.click();

    const saveButton = findButton(
      dialog,
      (text) =>
        text === "保存" ||
        text === "更新" ||
        text === "Save" ||
        text === "Update"
    );
    if (!saveButton) throw new Error("保存账号：没有找到保存/更新按钮");
    saveButton.click();
    const closed = await waitFor(
      () => !document.contains(dialog) || !visible(dialog),
      15000
    );
    if (!closed) throw new Error("保存账号：Sub2API 没有确认保存结果");
    const row = await waitFor(() => findAccountRowByName(accountName), 5000);
    if (!row) throw new Error(`保存账号：未确认账号“${accountName}”仍在列表中`);
  }

  async function finishSub2ApiAccountModelsAndGroup(plan) {
    const dialog = await openAccountEditDialog(plan.name);
    try {
      try {
        await ensureModelWhitelistMode(dialog);
      } catch (error) {
        throw new Error(`模型白名单：${error.message}`);
      }
      try {
        await clearAllModelsInDialog(dialog);
      } catch (error) {
        throw new Error(`清除模型：${error.message}`);
      }
      try {
        await syncUpstreamModelsInDialog(dialog);
      } catch (error) {
        throw new Error(`同步模型：${error.message}`);
      }
      try {
        await selectGroupAndSaveDialog(dialog, plan.groupLabel, plan.name);
      } catch (error) {
        throw new Error(`分组/保存：${error.message}`);
      }
    } catch (error) {
      const closeButton = findButton(
        dialog,
        (text) =>
          text === "取消" ||
          text === "Cancel" ||
          text === "关闭" ||
          text === "Close"
      );
      closeButton?.click();
      throw error;
    }
  }

  async function cleanupSub2ApiDialog(dialog) {
    if (!dialog || !document.contains(dialog) || !visible(dialog)) return;
    try {
      const closeButton = findButton(
        dialog,
        (text) =>
          text === "取消" ||
          text === "Cancel" ||
          text === "关闭" ||
          text === "Close"
      );
      closeButton?.click();
      if (visible(dialog))
        dialog.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
        );
      await waitFor(() => !document.contains(dialog) || !visible(dialog), 1500);
    } catch (_error) {
      // Preserve the original import failure if the host UI rejects cleanup.
    }
  }

  async function createSub2ApiAccountWithNativeUi(config) {
    const plan = CORE.buildSub2ApiUiImportPlan(config);
    if (!plan.endpoint || !plan.apiKey)
      throw new Error("缺少完整地址或 API Key");

    if (findAccountRowByName(plan.name)) {
      if (config.sub2ApiAccountCreating) {
        return { ...plan, sub2ApiAccountCreated: true };
      }
      throw new Error(`账号“${plan.name}”已存在，未自动接管`);
    }

    let dialog = null;
    try {
      const addButton = findButton(
        document,
        (text) => text === "添加账号" || text === "Add Account"
      );
      if (!addButton) throw new Error("没有找到 Sub2API 的添加账号按钮");
      addButton.click();

      dialog = await waitFor(() =>
        getNativeSub2ApiDialog(/^(?:添加账号|Add Account)$/)
      );
      if (!dialog) throw new Error("Sub2API 添加账号表单没有打开");

      const platformButton = findButton(
        dialog,
        (text) => text === plan.platformLabel
      );
      platformButton?.click();
      const typeButton = await waitFor(() =>
        findButton(
          dialog,
          (text) =>
            text === plan.typeLabel || text.startsWith(`${plan.typeLabel} `)
        )
      );
      if (!typeButton)
        throw new Error("Sub2API 不支持 OpenAI API Key 账号类型");
      typeButton.click();

      const nameInput = await waitFor(() =>
        findNativeInput(dialog, /^(?:请输入账号名称|Account name)/i)
      );
      const endpointInput = await waitFor(() =>
        findNativeInput(dialog, /^https:\/\/api\.openai\.com/i)
      );
      const apiKeyInput = await waitFor(() => findNativeInput(dialog, /^sk-/i));
      if (!nameInput || !endpointInput || !apiKeyInput)
        throw new Error("Sub2API OpenAI API Key 表单不完整");
      setNativeInputValue(nameInput, plan.name);
      setNativeInputValue(endpointInput, plan.endpoint);
      setNativeInputValue(apiKeyInput, plan.apiKey);

      const createButton = findButton(
        dialog,
        (text) => text === "创建" || text === "Create"
      );
      if (!createButton) throw new Error("没有找到 Sub2API 创建按钮");
      createButton.click();
      const closed = await waitFor(
        () => !document.contains(dialog) || !visible(dialog),
        10000
      );
      if (!closed) throw new Error("Sub2API 没有确认账号创建结果");
      const created = await waitFor(
        () => findAccountRowByName(plan.name),
        5000
      );
      if (!created)
        throw new Error(`创建后未确认账号“${plan.name}”出现在列表中`);
      return { ...plan, sub2ApiAccountCreated: true };
    } catch (error) {
      if (!dialog) {
        dialog = await waitFor(
          () => getNativeSub2ApiDialog(/^(?:添加账号|Add Account)$/),
          1500
        );
      }
      await cleanupSub2ApiDialog(dialog);
      throw error;
    }
  }

  let handledDirectImportAt = 0;
  let directImportInFlight = null;

  async function runDirectSub2ApiImport(pending) {
    const widget = createWidget("openkey-sub2api-widget", "OpenKey", null);
    widget.action.hidden = true;
    widget.host.style.width = "0";
    widget.close();

    const remaining = [];
    const errors = [];
    let imported = 0;
    const plans = CORE.buildSub2ApiUiImportPlans(pending.configs);
    const configs = pending.configs.map((config, index) => ({
      ...config,
      name: plans[index]?.name || config.name,
    }));
    activeImportTask = {
      taskId: pending.taskId || "",
      createdAt: pending.createdAt,
    };
    try {
      for (let index = 0; index < configs.length; index += 1) {
        let config = configs[index];
        if (!config.apiKey || !config.endpoint) {
          remaining.push(config);
          errors.push(`${config.name || "配置"}：缺少完整地址或 API Key`);
          await updatePendingConfigs(
            CORE.buildPendingImportQueue(configs, remaining, index)
          );
          continue;
        }
        let plan = null;
        try {
          if (!config.sub2ApiAccountCreated && !config.sub2ApiAccountCreating) {
            if (findAccountRowByName(config.name)) {
              throw new Error(`账号“${config.name}”已存在，未自动接管`);
            }
            config = { ...config, sub2ApiAccountCreating: true };
            configs[index] = config;
            await updatePendingConfigs(
              CORE.buildPendingImportQueue(configs, remaining, index - 1)
            );
          }
          plan = config.sub2ApiAccountCreated
            ? CORE.buildSub2ApiUiImportPlan(config)
            : await createSub2ApiAccountWithNativeUi(config);
          await finishSub2ApiAccountModelsAndGroup(plan);
          imported += 1;
        } catch (error) {
          remaining.push(
            plan
              ? {
                  ...config,
                  sub2ApiAccountCreating: false,
                  sub2ApiAccountCreated: true,
                }
              : config
          );
          errors.push(
            `${config.name || "配置"}：${error?.message || "导入失败"}`
          );
        }
        await updatePendingConfigs(
          CORE.buildPendingImportQueue(configs, remaining, index)
        );
      }
      const failed = remaining.length
        ? `<div class="warning">${remaining.length} 条未完成（创建/清模型/同步上游/分组任一失败）。${errors.length ? `<br>${errors.map((item) => escapeHtml(item)).join("<br>")}` : ""}</div>`
        : "";
      widget.open(
        "Sub2API 直接导入完成",
        `<div class="notice">已完成 ${imported} 条：创建账号 → 清除所有模型 → 同步上游全量模型 → 加入“白嫖”分组。</div>${failed}`,
        [{ label: "关闭", onClick: () => widget.close(), primary: true }]
      );
      return true;
    } catch (error) {
      widget.open(
        "Sub2API 直接导入失败",
        `<div class="warning">${escapeHtml(error.message || "无法创建账号")}</div>`,
        [
          { label: "关闭", onClick: () => widget.close() },
          {
            label: "重试",
            primary: true,
            onClick: () => {
              handledDirectImportAt = 0;
              widget.close();
              initSub2ApiPage({ allowStale: true });
            },
          },
        ]
      );
      return false;
    } finally {
      activeImportTask = null;
    }
  }

  function initSub2ApiPage(options = {}) {
    if (
      !/^https?:$/.test(location.protocol) ||
      !location.pathname.startsWith("/admin/accounts")
    )
      return null;
    const hasAccountsUi = Boolean(
      findButton(
        document,
        (text) => text === "添加账号" || text === "Add Account"
      )
    );
    if (!hasAccountsUi) return null;
    // The in-flight marker is set synchronously before any await: PENDING_IMPORT_READY
    // and a MutationObserver-driven init() can interleave here, and both used to
    // pass the guard and run two import loops over the same native dialogs.
    if (directImportInFlight) return directImportInFlight;
    directImportInFlight = (async () => {
      try {
        const pending = await getPendingImport();
        if (
          !pending?.configs?.length ||
          pending.createdAt === handledDirectImportAt
        )
          return false;
        const stale =
          Number.isFinite(pending.createdAt) &&
          Date.now() - pending.createdAt > 30 * 60 * 1000;
        if (stale && !options.allowStale) {
          const widget = createWidget(
            "openkey-sub2api-widget",
            "OpenKey",
            null
          );
          widget.open(
            "发现较早的待导入任务",
            `<div class="warning">这批配置已等待超过 30 分钟，继续操作可能创建重复账号。</div>`,
            [
              {
                label: "清理任务",
                onClick: async () => {
                  await sendRuntimeMessage({ type: "CLEAR_PENDING_IMPORT" });
                  widget.close();
                },
              },
              {
                label: "继续导入",
                primary: true,
                onClick: () => {
                  handledDirectImportAt = 0;
                  widget.close();
                  initSub2ApiPage({ allowStale: true });
                },
              },
            ]
          );
          handledDirectImportAt = pending.createdAt;
          return false;
        }
        const completed = await runDirectSub2ApiImport(pending);
        // Mark handled on failure too: leaving it unset let the next DOM
        // mutation auto-restart the whole failed queue with no user action.
        // Retry is now an explicit button on the failure panel.
        handledDirectImportAt = pending.createdAt;
        return completed;
      } finally {
        directImportInFlight = null;
      }
    })();
    return directImportInFlight;
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (
      message?.type === "PENDING_IMPORT_READY" &&
      location.pathname.startsWith("/admin/accounts")
    ) {
      initSub2ApiPage().catch((error) =>
        console.warn("OpenKey: direct import failed", error)
      );
    }
  });

  async function runCcSwitchImport(configs, app) {
    const successes = [];
    const failures = [];
    for (const config of configs) {
      try {
        const result = await sendRuntimeMessage({
          type: "OPEN_CCSWITCH_LINK",
          url: CORE.buildCcSwitchLink(config, app),
        });
        if (!result?.ok) throw new Error(result?.error || "未知错误");
        successes.push(config);
      } catch (error) {
        failures.push({ config, error: error?.message || "打开失败" });
      }
      await sleep(250);
    }
    return { successes, failures };
  }

  async function importConfigsToCcSwitch(
    widget,
    configs,
    button,
    retryConfigs = null,
    appOverride = ""
  ) {
    const selected = retryConfigs || getSelectedConfigs(widget.shadow, configs);
    const app =
      appOverride ||
      widget.shadow.querySelector("[data-cc-app]")?.value ||
      "claude";
    const invalid = selected.filter(
      (config) => !config.apiKey || !config.endpoint
    );
    if (!selected.length || invalid.length) {
      showInlineWarning(
        widget,
        invalid.length
          ? `${invalid.length} 条配置缺少完整网址或 API Key。`
          : "请至少选择一条配置。"
      );
      return;
    }
    // 上游 CC Switch 的 provider 深链接解析白名单暂无 "pi"
    //（cc-switch src-tauri/src/deeplink/parser.rs parse_provider_deeplink，
    // prompt 解析有 pi，唯独 provider 漏了），打开必报 Invalid provider app type。
    // 先拦下并说明，上游补上后删掉这段即可。
    if (app === "pi") {
      showInlineWarning(
        widget,
        "当前 CC Switch 尚不支持通过深链接导入 pi（会报 Invalid provider app type），这是上游限制。请先选其他应用，或等 CC Switch 更新后再试。"
      );
      return;
    }
    if (button) button.disabled = true;
    try {
      const { successes, failures } = await runCcSwitchImport(selected, app);
      await chrome.storage.local.set({ ccApp: app });
      const failureLines = failures
        .map(
          ({ config, error }) =>
            `<li>${escapeHtml(config.name || config.endpoint)}：${escapeHtml(error)}</li>`
        )
        .join("");
      const summary =
        `<div class="notice">已打开 ${successes.length}/${selected.length} 条 CC Switch 导入链接，请在 CC Switch 中逐条确认。</div>` +
        (failures.length
          ? `<div class="warning">${failures.length} 条打开失败：<ul>${failureLines}</ul></div>`
          : "");
      const actions = [
        {
          label: "关闭",
          onClick: () => widget.close(),
          primary: !failures.length,
        },
      ];
      if (failures.length) {
        actions.push({
          label: "重试失败项",
          primary: true,
          onClick: (retryButton) =>
            importConfigsToCcSwitch(
              widget,
              configs,
              retryButton,
              failures.map((item) => item.config),
              app
            ),
        });
      }
      widget.open("CC Switch 导入结果", summary, actions);
    } catch (error) {
      widget.open(
        "CC Switch 导入失败",
        `<div class="warning">${escapeHtml(error.message || "无法打开导入链接")}</div>`,
        [{ label: "关闭", onClick: () => widget.close(), primary: true }]
      );
    } finally {
      if (button) button.disabled = false;
    }
  }

  function linuxDoAppSelectHtml(selectedApp = "claude") {
    const normalizedApp = CORE.normalizeCcSwitchApp(selectedApp);
    const options = [
      ["claude", "Claude Code"],
      ["codex", "Codex"],
      ["grokbuild", "Grok Build"],
      ["pi", "Pi"],
    ]
      .map(
        ([value, label]) =>
          `<option value="${value}"${value === normalizedApp ? " selected" : ""}>${label}</option>`
      )
      .join("");
    return `<div class="field"><label>目标应用</label><select data-cc-app>${options}</select></div>`;
  }

  function linuxDoTopicKeyFromPath(pathname) {
    const parts = String(pathname || "")
      .split("/")
      .filter(Boolean);
    if (parts[0] !== "t" || !parts[1]) return "";
    // Discourse accepts /t/<id>[/<post>] and /t/<slug>/<id>[/<post>].
    // Omit a trailing post number so scrolling within one topic does not
    // reset the panel.
    if (/^\d+$/.test(parts[1])) return `/t/${parts[1]}`;
    return parts[2] ? `/t/${parts[1]}/${parts[2]}` : "";
  }

  async function initLinuxDoPage() {
    if (
      location.hostname !== "linux.do" ||
      !location.pathname.startsWith("/t/")
    )
      return;
    const topicKey = linuxDoTopicKeyFromPath(location.pathname);
    if (linuxDoTopicKey && topicKey && topicKey !== linuxDoTopicKey) {
      document
        .getElementById("openkey-linuxdo-widget")
        ?.__openKeyWidget?.close();
      document
        .getElementById("openkey-linuxdo-b64-widget")
        ?.__openKeyWidget?.close();
    }
    linuxDoTopicKey = topicKey;
    const ownerArticle =
      document.querySelector("main article") ||
      document.querySelector("article");
    const avatar =
      ownerArticle?.querySelector("img.avatar") ||
      ownerArticle?.querySelector("img");
    const contentAnchor = ownerArticle?.querySelector(".cooked");
    const anchor =
      contentAnchor ||
      avatar?.closest?.(".topic-avatar") ||
      avatar ||
      document.querySelector("main h1") ||
      findButton(document, (text) => text.includes("回复"));
    const widgetPlacement = contentAnchor ? "inline-after" : "below-anchor";

    const widget = createWidget(
      "openkey-linuxdo-widget",
      "导入到 CC Switch",
      anchor,
      { placement: widgetPlacement }
    );
    widget?.mount?.(anchor, { placement: widgetPlacement });
    if (widget && !widget.__initialized) {
      widget.__initialized = true;
      widget.onAction = async () => {
        widget.setBusy(true);
        try {
          const configs = CORE.collectLinuxDoConfigs(document, location.href);
          if (!configs.length) {
            widget.open(
              "没有发现可导入配置",
              `<div class="warning">当前页面没有识别到网址或 API Key。若配置在图片中，请把图片里的配置复制为文本后再试。也可使用下方“Base64 解码”。</div>`,
              [{ label: "关闭", onClick: () => widget.close(), primary: true }]
            );
            return;
          }
          const settings = await chrome.storage.local.get({ ccApp: "claude" });
          widget.open(
            "选择 CC Switch 导入方式",
            `<div class="notice">CC Switch 使用 ccswitch:// 深链接导入。链接包含 API Key，只会在你点击“导入”时交给本机 CC Switch。</div>${linuxDoAppSelectHtml(settings.ccApp)}${selectionToolbarHtml(configs.length)}${configs.map((config, index) => configItemHtml(config, index)).join("")}`,
            [
              { label: "关闭", onClick: () => widget.close() },
              {
                label: "导入选中配置",
                primary: true,
                onClick: (button) =>
                  importConfigsToCcSwitch(widget, configs, button),
              },
            ]
          );
          bindSelectionBar(widget.shadow);
        } catch (error) {
          widget.open(
            "识别失败",
            `<div class="warning">${escapeHtml(error.message || "页面结构暂不兼容")}</div>`,
            [{ label: "关闭", onClick: () => widget.close(), primary: true }]
          );
        } finally {
          widget.setBusy(false);
        }
      };
    }

    const b64Widget = createWidget(
      "openkey-linuxdo-b64-widget",
      "Base64 解码",
      anchor,
      { placement: widgetPlacement }
    );
    b64Widget?.mount?.(anchor, { placement: widgetPlacement });
    if (!b64Widget || b64Widget.__initialized) return;
    b64Widget.__initialized = true;
    b64Widget.onAction = async () => {
      b64Widget.setBusy(true);
      try {
        const recognized = CORE.collectLinuxDoConfigs(document, location.href);
        let decodedConfigs = [];
        let draftInput = "";
        const sourceConfigs = () =>
          decodedConfigs.length ? decodedConfigs : recognized;
        const openPanel = () => {
          const keys = sourceConfigs();
          const keyBlock = keys.some((config) => config.apiKey)
            ? `<div class="notice">以下为解码/识别到的 Key（明文）。</div>${plainKeyRowsHtml(keys)}`
            : draftInput
              ? `<div class="warning">解码失败，或结果中没有 API Key。</div>`
              : recognized.length
                ? `<div class="warning">已识别到配置，但没有可用 Key。</div>`
                : `<div class="muted">解码后的 Key 会显示在这里。</div>`;
          b64Widget.open(
            "Base64 解码",
            `<div class="field"><label>Base64 输入</label><textarea data-b64-input rows="5" placeholder="粘贴 Base64（支持换行）"></textarea></div><div data-b64-result>${keyBlock}</div>`,
            [
              { label: "关闭", onClick: () => b64Widget.close() },
              {
                label: "解码",
                onClick: () => {
                  draftInput =
                    b64Widget.shadow.querySelector("[data-b64-input]")?.value ||
                    "";
                  decodedConfigs = CORE.collectLinuxDoConfigsFromBase64(
                    draftInput,
                    location.href
                  );
                  openPanel();
                },
              },
            ]
          );
          const area = b64Widget.shadow.querySelector("[data-b64-input]");
          if (area) {
            area.value = draftInput;
            area.focus();
          }
          bindPlainKeyCopyButtons(b64Widget.shadow, keys);
        };
        openPanel();
      } catch (error) {
        b64Widget.open(
          "解码面板失败",
          `<div class="warning">${escapeHtml(error.message || "未知错误")}</div>`,
          [{ label: "关闭", onClick: () => b64Widget.close(), primary: true }]
        );
      } finally {
        b64Widget.setBusy(false);
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
    if (
      !CORE.isNewApiKeysPath(location.pathname) &&
      location.hostname !== "linux.do" &&
      !location.pathname.startsWith("/admin/accounts")
    )
      return;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      init();
    });
  });
  pageObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  init();
})();
