(function attachOpenKeyCore(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.OpenKeyCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createOpenKeyCore() {
  const URL_PATTERN = /https?:\/\/[^\s<>"'`，。；,;)}\]]+/gi;
  const MODEL_PATTERN = /(?:gpt|o[1-4](?:-[a-z0-9]+)?|claude|gemini|deepseek|qwen|kimi|moonshot|glm|grok|mistral|llama)[\w./:-]*/gi;
  const KEY_PREFIX_PATTERN = /(?:sk-[A-Za-z0-9][A-Za-z0-9._-]{7,}|sk_[A-Za-z0-9][A-Za-z0-9._-]{7,}|AIza[0-9A-Za-z_-]{20,}|gsk_[A-Za-z0-9_-]{12,}|xai-[A-Za-z0-9_-]{12,})/g;
  const KEY_PREFIX_TEST_PATTERN = /^(?:sk-[A-Za-z0-9][A-Za-z0-9._-]{7,}|sk_[A-Za-z0-9][A-Za-z0-9._-]{7,}|AIza[0-9A-Za-z_-]{20,}|gsk_[A-Za-z0-9_-]{12,}|xai-[A-Za-z0-9_-]{12,})$/;

  function clean(value) {
    return String(value || "").replace(/[\u200b\u200c\u200d\ufeff]/g, "").trim();
  }

  function trimPunctuation(value) {
    return clean(value).replace(/[\s\]\[)}`>'"，。；：:、,;]+$/g, "");
  }

  function unique(values) {
    return [...new Set(values.map(clean).filter(Boolean))];
  }

  function isMasked(value) {
    return /[*•…]/.test(clean(value));
  }

  function isLikelyApiKey(value) {
    const candidate = trimPunctuation(value);
    if (!candidate || candidate.length < 8 || isMasked(candidate) || /\s/.test(candidate)) {
      return false;
    }
    if (/^https?:\/\//i.test(candidate)) {
      return false;
    }
    return KEY_PREFIX_TEST_PATTERN.test(candidate) || /^[A-Za-z0-9._-]{20,}$/.test(candidate);
  }

  function extractUrls(text) {
    return unique([...String(text || "").matchAll(URL_PATTERN)].map(match => trimPunctuation(match[0])));
  }

  function extractModels(text) {
    const value = String(text || "");
    const labeled = [];
    const labelPattern = /(?:model|模型(?:名称|名)?|默认模型)\s*[:=：]\s*["'`]?([^\s,;，；"'`<>]+)/gi;
    for (const match of value.matchAll(labelPattern)) {
      const model = trimPunctuation(match[1]);
      if (model) labeled.push(model);
    }
    const urlRanges = [...value.matchAll(URL_PATTERN)].map(match => [match.index, match.index + match[0].length]);
    const known = [...value.matchAll(MODEL_PATTERN)]
      .filter(match => !urlRanges.some(([start, end]) => match.index >= start && match.index < end))
      .map(match => /^grok4\.5$/i.test(match[0]) ? "grok-4.5" : match[0]);
    return unique([...labeled, ...known]).slice(0, 20);
  }

  function extractKeys(text) {
    const value = String(text || "");
    const keys = [];
    const labeledPattern = /(?:api[_ -]?key|apikey|access[_ -]?token|secret|密钥|令牌|token|key)\s*[:=：]\s*["'`]?([^\s,;，；"'`<>]+)/gi;
    for (const match of value.matchAll(labeledPattern)) {
      const candidate = trimPunctuation(match[1]);
      if (isLikelyApiKey(candidate)) keys.push(candidate);
    }
    for (const match of value.matchAll(KEY_PREFIX_PATTERN)) {
      if (isLikelyApiKey(match[0])) keys.push(trimPunctuation(match[0]));
    }
    return unique(keys);
  }

  function decodeBase64(value) {
    const input = clean(value).replace(/\s+/g, "");
    if (input.length < 24 || input.length % 4 === 1 || !/^[A-Za-z0-9+/=_-]+$/.test(input)) {
      return "";
    }
    try {
      const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
      if (typeof atob === "function") {
        const binary = atob(padded);
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        return new TextDecoder().decode(bytes);
      }
      if (typeof Buffer !== "undefined") {
        return Buffer.from(padded, "base64").toString("utf8");
      }
    } catch (_error) {
      return "";
    }
    return "";
  }

  function extractBase64Tokens(text) {
    const tokens = [];
    const value = String(text || "");
    const tokenPattern = /(?:^|[^A-Za-z0-9+/_-])([A-Za-z0-9+/_-]{24,}={0,2})(?=$|[^A-Za-z0-9+/_-])/g;
    for (const match of value.matchAll(tokenPattern)) {
      const decoded = decodeBase64(match[1]);
      if (decoded && (/https?:\/\//i.test(decoded) || isLikelyApiKey(decoded))) tokens.push(decoded);
    }
    return tokens;
  }

  function resolveManualApiKey(value, isBase64Encoded) {
    const candidate = isBase64Encoded ? decodeBase64(value) : clean(value);
    return extractKeys(candidate)[0] || (isLikelyApiKey(candidate) ? trimPunctuation(candidate) : "");
  }

  function normalizeEndpoint(value) {
    const candidate = trimPunctuation(value);
    if (!/^https?:\/\//i.test(candidate)) return "";
    try {
      const url = new URL(candidate);
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    } catch (_error) {
      return "";
    }
  }

  function parseLooseConfigText(text, sourceUrl) {
    const value = String(text || "");
    const urls = extractUrls(value).map(normalizeEndpoint).filter(Boolean);
    const sourceHost = (() => {
      try { return new URL(sourceUrl || "").hostname; } catch (_error) { return ""; }
    })();
    const endpoint = urls.find(url => {
      try {
        const host = new URL(url).hostname;
        return host !== sourceHost && host !== "linux.do" && host !== "welfare.0xpsyche.me";
      } catch (_error) {
        return false;
      }
    }) || urls[0] || "";
    const models = extractModels(value);
    const keys = extractKeys(value);
    return { endpoint, apiKeys: keys, models };
  }

  function mergeNewApiCopiedInfo(config, copiedText, sourceUrl) {
    const parsed = parseLooseConfigText(copiedText, sourceUrl);
    return {
      ...config,
      endpoint: parsed.endpoint || config?.endpoint || "",
      apiKey: parsed.apiKeys[0] || config?.apiKey || "",
      model: parsed.models[0] || config?.model || ""
    };
  }

  function inferFallbackModel(text) {
    const value = String(text || "").toLowerCase();
    if (/grok/.test(value)) return "grok-4.5";
    if (/(?:gpt|openai|chatgpt)/.test(value)) return "gpt-5.6-sol";
    return "";
  }

  function getElementCandidates(element) {
    if (!element) return [];
    const candidates = [];
    const nodes = [element, ...element.querySelectorAll("input, button, [data-key], [data-token], [data-value], [title], [aria-label]")];
    for (const node of nodes) {
      for (const attribute of ["value", "data-key", "data-token", "data-value", "title", "aria-label"]) {
        const value = node.getAttribute?.(attribute);
        if (value) candidates.push(value);
      }
      const text = node.textContent || "";
      if (text.trim()) candidates.push(text);
    }
    return unique(candidates.filter(isLikelyApiKey));
  }

  function getHeaderTexts(table) {
    const headerRow = table.querySelector("thead tr") || table.querySelector("tr");
    return headerRow ? [...headerRow.children].map(cell => clean(cell.textContent)) : [];
  }

  function getRowCellByHeader(row, headers, matcher, fallbackIndex) {
    const index = headers.findIndex(header => matcher.test(header));
    const cells = [...row.children];
    return cells[index >= 0 ? index : fallbackIndex] || null;
  }

  function extractNewApiRows(doc, sourceUrl) {
    const origin = (() => {
      try { return new URL(sourceUrl || doc.location?.href || "").origin; } catch (_error) { return ""; }
    })();
    const result = [];
    for (const table of doc.querySelectorAll("table")) {
      const headers = getHeaderTexts(table);
      if (!headers.some(header => /api\s*密钥|api\s*key/i.test(header))) continue;
      const rows = table.querySelectorAll("tbody tr").length
        ? [...table.querySelectorAll("tbody tr")]
        : [...table.querySelectorAll("tr")].slice(1);
      rows.forEach((row, index) => {
        const nameCell = getRowCellByHeader(row, headers, /名称|name/i, 1);
        const keyCell = getRowCellByHeader(row, headers, /api\s*密钥|api\s*key/i, 3);
        const modelCell = getRowCellByHeader(row, headers, /模型|model/i, 6);
        const statusCell = getRowCellByHeader(row, headers, /状态|status/i, 2);
        const apiKey = getElementCandidates(keyCell)[0] || "";
        const name = clean(nameCell?.textContent) || `NewAPI ${index + 1}`;
        const modelText = clean(modelCell?.textContent);
        result.push({
          id: `${index}-${name}`,
          name,
          endpoint: origin,
          apiKey,
          model: extractModels(modelText)[0] || "",
          status: clean(statusCell?.textContent),
          keyCell,
          needsClipboard: !apiKey
        });
      });
    }
    return result;
  }

  function collectLinuxDoConfigs(doc, sourceUrl) {
    const ownerArticle = doc.querySelector("main article") || doc.querySelector("article");
    if (!ownerArticle) return [];
    const segments = [];
    const topicTitle = doc.querySelector("main h1")?.textContent || doc.querySelector("h1")?.textContent || "";
    const ownerText = ownerArticle.innerText || ownerArticle.textContent || "";
    if (ownerText) segments.push(ownerText);
    for (const node of ownerArticle.querySelectorAll("pre, code, blockquote, a[href]")) {
      const text = node.matches("a[href]") ? `${node.textContent || ""} ${node.getAttribute("href") || ""}` : node.textContent || "";
      if (text.trim()) segments.push(text);
    }

    const parsedSegments = [];
    for (const segment of unique(segments)) {
      const parsed = parseLooseConfigText(segment, sourceUrl);
      parsedSegments.push(parsed);
      const decoded = decodeBase64(segment);
      if (decoded) parsedSegments.push(parseLooseConfigText(decoded, sourceUrl));
      for (const decodedToken of extractBase64Tokens(segment)) {
        parsedSegments.push(parseLooseConfigText(decodedToken, sourceUrl));
      }
    }

    const endpointCandidates = unique(parsedSegments.map(item => item.endpoint).filter(Boolean));
    const keyCandidates = unique(parsedSegments.flatMap(item => item.apiKeys || []));
    const modelCandidates = unique(parsedSegments.flatMap(item => item.models || []))
      .filter(model => !/^(?:gpt|grok|openai|chatgpt|claude|gemini|deepseek|qwen|kimi|moonshot|glm|mistral|llama)$/i.test(model));
    const fallbackModel = modelCandidates[0] || inferFallbackModel(`${topicTitle}\n${ownerText}`);
    const configs = [];
    for (const key of keyCandidates) {
      const scoped = parsedSegments.find(item => item.apiKeys?.includes(key) && item.endpoint);
      const endpoint = scoped?.endpoint || endpointCandidates[0] || "";
      const scopedModel = scoped?.models?.find(model => !/^(?:gpt|grok|openai|chatgpt|claude|gemini|deepseek|qwen|kimi|moonshot|glm|mistral|llama)$/i.test(model));
      const model = scopedModel || fallbackModel;
      configs.push({
        id: `${endpoint}|${key}|${model}`,
        name: makeConfigName(endpoint, model, configs.length + 1),
        endpoint,
        apiKey: key,
        model,
        source: sourceUrl
      });
    }
    if (!configs.length && endpointCandidates.length) {
      configs.push({
        id: `${endpointCandidates[0]}|missing`,
        name: makeConfigName(endpointCandidates[0], modelCandidates[0], 1),
        endpoint: endpointCandidates[0],
        apiKey: "",
        model: fallbackModel,
        source: sourceUrl,
        needsManualKey: true
      });
    }
    return configs;
  }

  function makeConfigName(endpoint, model, index) {
    try {
      const host = new URL(endpoint).hostname;
      return `${host}${model ? ` · ${model}` : ""}`;
    } catch (_error) {
      return `OpenKey 配置 ${index}`;
    }
  }

  function buildSub2ApiAccount(config, groupId) {
    return {
      name: clean(config?.name) || "OpenKey Provider",
      notes: "",
      platform: "openai",
      type: "apikey",
      credentials: {
        base_url: normalizeEndpoint(config?.endpoint) || clean(config?.endpoint),
        api_key: clean(config?.apiKey)
      },
      proxy_id: null,
      concurrency: 10,
      priority: 1,
      rate_multiplier: 1,
      group_ids: groupId == null ? [] : [groupId],
      expires_at: null,
      upstream_billing_probe_enabled: true,
      auto_pause_on_expired: true
    };
  }

  function buildSub2ApiUiImportPlan(config) {
    return {
      name: clean(config?.name) || "OpenKey Provider",
      endpoint: normalizeEndpoint(config?.endpoint) || clean(config?.endpoint),
      apiKey: clean(config?.apiKey),
      platformLabel: "OpenAI",
      typeLabel: "API Key",
      groupLabel: "白嫖"
    };
  }

  function needsWidgetRemount(currentParent, targetParent, currentPlacement, targetPlacement) {
    return currentParent !== targetParent || currentPlacement !== targetPlacement;
  }

  function buildCcSwitchLink(config, app) {
    const query = new URLSearchParams({
      resource: "provider",
      app: app || "claude",
      name: config.name || "OpenKey Provider"
    });
    if (config.endpoint) query.set("endpoint", config.endpoint);
    if (config.apiKey) query.set("apiKey", config.apiKey);
    if (config.model) query.set("model", config.model);
    if (config.source) query.set("homepage", config.source);
    return `ccswitch://v1/import?${query.toString()}`;
  }

  function maskSecret(value) {
    const text = clean(value);
    if (!text) return "未识别";
    if (text.length <= 8) return `${text.slice(0, 2)}••••`;
    return `${text.slice(0, 4)}••••${text.slice(-4)}`;
  }

  return {
    buildCcSwitchLink,
    buildSub2ApiAccount,
    buildSub2ApiUiImportPlan,
    collectLinuxDoConfigs,
    decodeBase64,
    extractBase64Tokens,
    extractKeys,
    extractModels,
    extractNewApiRows,
    extractUrls,
    getElementCandidates,
    inferFallbackModel,
    isLikelyApiKey,
    makeConfigName,
    maskSecret,
    mergeNewApiCopiedInfo,
    needsWidgetRemount,
    normalizeEndpoint,
    parseLooseConfigText,
    resolveManualApiKey
  };
});
