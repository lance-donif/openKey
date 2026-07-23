(function initPopup() {
  const DEFAULTS = {
    sub2apiUrl: "http://localhost:8080/admin/accounts",
    ccApp: "claude"
  };
  const urlInput = document.querySelector("#sub2api-url");
  const appSelect = document.querySelector("#cc-app");
  const saveButton = document.querySelector("#save");
  const status = document.querySelector("#status");

  chrome.storage.local.get(DEFAULTS).then(settings => {
    urlInput.value = settings.sub2apiUrl;
    appSelect.value = settings.ccApp;
  });

  saveButton.addEventListener("click", async () => {
    const sub2apiUrl = urlInput.value.trim() || DEFAULTS.sub2apiUrl;
    if (!/^https?:\/\//i.test(sub2apiUrl)) {
      status.textContent = "目标地址必须以 http:// 或 https:// 开头";
      status.className = "status error";
      return;
    }
    await chrome.storage.local.set({ sub2apiUrl, ccApp: appSelect.value });
    status.textContent = "设置已保存";
    status.className = "status success";
  });
})();
