(function initPopup() {
  const DEFAULTS = {
    sub2apiUrl: "http://localhost:8080/admin/accounts",
    ccApp: "claude",
  };
  const normalizeCcApp = (value) =>
    /^grok(?:[-_]?build)?$/i.test(String(value || ""))
      ? "grokbuild"
      : String(value || "claude");
  const urlInput = document.querySelector("#sub2api-url");
  const appSelect = document.querySelector("#cc-app");
  const saveButton = document.querySelector("#save");
  const status = document.querySelector("#status");

  function parseHttpUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      if (!/^https?:$/.test(url.protocol) || !url.hostname) return null;
      return url;
    } catch (_error) {
      return null;
    }
  }

  chrome.storage.local
    .get(DEFAULTS)
    .then((settings) => {
      urlInput.value = settings.sub2apiUrl;
      appSelect.value = normalizeCcApp(settings.ccApp);
    })
    .catch((error) => {
      status.textContent = `读取设置失败：${error.message || "未知错误"}`;
      status.className = "status error";
    });

  saveButton.addEventListener("click", async () => {
    const sub2apiUrl = urlInput.value.trim() || DEFAULTS.sub2apiUrl;
    if (!parseHttpUrl(sub2apiUrl)) {
      status.textContent = "目标地址必须是有效的 http:// 或 https:// 地址";
      status.className = "status error";
      return;
    }
    try {
      await chrome.storage.local.set({
        sub2apiUrl,
        ccApp: normalizeCcApp(appSelect.value),
      });
      status.textContent = "设置已保存";
      status.className = "status success";
    } catch (error) {
      status.textContent = `保存设置失败：${error.message || "未知错误"}`;
      status.className = "status error";
    }
  });

  if (typeof globalThis !== "undefined")
    globalThis.OpenKeyPopup = { parseHttpUrl };
})();
