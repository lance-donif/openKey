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
    return /[*•…]|\.\.\./.test(clean(value));
  }

  function isLikelyApiKey(value) {
    const candidate = trimPunctuation(value);
    if (!candidate || candidate.length < 8 || isMasked(candidate) || /\s/.test(candidate)) {
      return false;
    }
    if (/^https?:\/\//i.test(candidate)) {
      return false;
    }
    if (KEY_PREFIX_TEST_PATTERN.test(candidate)) return true;
    if (!/^[A-Za-z0-9._-]{20,}$/.test(candidate)) return false;
    // URL-safe base64 blobs can look like bare keys; leave those to extractBase64Tokens.
    if (candidate.length >= 24) {
      const decoded = decodeBase64(candidate);
      if (decoded) {
        const plain = trimPunctuation(decoded);
        if (/https?:\/\//i.test(decoded)) return false;
        if (KEY_PREFIX_TEST_PATTERN.test(plain)) return false;
        if (/^[A-Za-z0-9._-]{16,}$/.test(plain) && plain !== candidate) return false;
        if (/(?:api[_ -]?key|密钥|令牌|token|key|base\s*url|endpoint|model)\s*[:=：]/i.test(decoded)) return false;
      }
    }
    return true;
  }

  function extractUrls(text) {
    return unique([...String(text || "").matchAll(URL_PATTERN)].map(match => trimPunctuation(match[0])));
  }

  function isLikelyModelName(value) {
    const model = trimPunctuation(value);
    if (!model || model.length > 64 || /\s/.test(model)) return false;
    if (isMasked(model) || isLikelyApiKey(model)) return false;
    // Connection-info keys without sk- can still look like random base62 blobs.
    if (/^[A-Za-z0-9_-]{24,}$/.test(model) && !/^(?:gpt|o[1-4]|claude|gemini|deepseek|qwen|kimi|moonshot|glm|grok|mistral|llama)/i.test(model)) {
      return false;
    }
    // "o3pNAUzd..." is a key body that starts like model family o3.
    if (/^o[1-4][A-Za-z0-9_-]{12,}$/.test(model) && !/^o[1-4](?:-|$)/i.test(model)) return false;
    return true;
  }

  function extractModels(text) {
    const value = String(text || "");
    const labeled = [];
    const labelPattern = /(?:model|模型(?:名称|名)?|默认模型)\s*[:=：]\s*["'`]?([^\s,;，；"'`<>]+)/gi;
    for (const match of value.matchAll(labelPattern)) {
      const model = trimPunctuation(match[1]);
      if (isLikelyModelName(model)) labeled.push(model);
    }
    const urlRanges = [...value.matchAll(URL_PATTERN)].map(match => [match.index, match.index + match[0].length]);
    const keyRanges = [...value.matchAll(/sk-[A-Za-z0-9._-]{8,}/g)].map(match => [match.index, match.index + match[0].length]);
    const known = [...value.matchAll(MODEL_PATTERN)]
      .filter(match => !urlRanges.some(([start, end]) => match.index >= start && match.index < end))
      .filter(match => !keyRanges.some(([start, end]) => match.index >= start && match.index < end))
      .map(match => /^grok4\.5$/i.test(match[0]) ? "grok-4.5" : match[0])
      .filter(isLikelyModelName);
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
    const urlRanges = [...value.matchAll(URL_PATTERN)].map(match => [match.index, match.index + match[0].length]);
    // Many shared keys are bare tokens without sk- / gsk_ prefixes.
    const barePattern = /(?:^|[^A-Za-z0-9._-])([A-Za-z0-9._-]{20,})(?=$|[^A-Za-z0-9._-])/g;
    for (const match of value.matchAll(barePattern)) {
      const start = match.index + match[0].length - match[1].length;
      if (urlRanges.some(([from, to]) => start >= from && start < to)) continue;
      const candidate = trimPunctuation(match[1]);
      if (isLikelyApiKey(candidate)) keys.push(candidate);
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
    // Discourse wraps long base64 across lines (often leaving "= / A=" on the next line).
    const value = String(text || "").replace(/([A-Za-z0-9+/=_-])[ \t]*[\r\n]+[ \t]*(?=[A-Za-z0-9+/=_-])/g, "$1");
    const tokenPattern = /(?:^|[^A-Za-z0-9+/_-])([A-Za-z0-9+/_-]{24,}={0,2})(?=$|[^A-Za-z0-9+/_-])/g;
    for (const match of value.matchAll(tokenPattern)) {
      const decoded = decodeBase64(match[1]);
      if (decoded && (/https?:\/\//i.test(decoded) || isLikelyApiKey(decoded))) tokens.push(decoded);
    }
    return unique(tokens);
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

  function parseNewApiConnectionInfo(text, sourceUrl) {
    const value = String(text || "");
    const toKey = candidate => {
      const textValue = trimPunctuation(candidate);
      if (!textValue || isMasked(textValue) || /^https?:\/\//i.test(textValue)) return "";
      if (/^sk[-_]/i.test(textValue)) return isLikelyApiKey(textValue) ? textValue : "";
      if (/^[A-Za-z0-9._-]{16,}$/.test(textValue)) return `sk-${textValue}`;
      return isLikelyApiKey(textValue) ? textValue : "";
    };

    let endpoint = "";
    let apiKey = "";
    let model = "";

    const settingsMatch = value.match(/settings=(\{[\s\S]*?\})(?:$|[&\s"'`])/i)
      || value.match(/(\{\s*"(?:key|url)"\s*:\s*"[^"]+"\s*,\s*"(?:key|url)"\s*:\s*"[^"]+"\s*\})/i);
    if (settingsMatch) {
      try {
        const settings = JSON.parse(settingsMatch[1]);
        apiKey = toKey(settings.key || settings.apiKey || "");
        endpoint = normalizeEndpoint(settings.url || settings.baseURL || settings.baseUrl || "");
        model = clean(settings.model || "");
      } catch (_error) {}
    }

    const parsed = parseLooseConfigText(value, sourceUrl);
    apiKey = apiKey || parsed.apiKeys[0] || toKey((value.match(/sk-[A-Za-z0-9._-]{8,}/) || [])[0] || "");
    if (!apiKey) {
      const labeled = value.match(/(?:api\s*key|密钥|令牌|token|key)\s*[:=：]\s*["'`]?(sk-[A-Za-z0-9._-]+|[A-Za-z0-9._-]{16,})/i);
      if (labeled) apiKey = toKey(labeled[1]);
    }

    endpoint = endpoint || parsed.endpoint || "";
    if (!endpoint) {
      const labeledUrl = value.match(/(?:base\s*url|api\s*url|接口地址|地址|url|endpoint)\s*[:=：]\s*["'`]?(https?:\/\/[^\s"'`，,;]+)/i);
      if (labeledUrl) endpoint = normalizeEndpoint(labeledUrl[1]);
    }
    if (!endpoint) {
      endpoint = extractUrls(value).map(normalizeEndpoint).filter(Boolean)
        .find(url => !/nextchat|lobehub|lobechat|opencat|botgem/i.test(url)) || "";
    }
    if (endpoint && /nextchat|lobehub|lobechat|opencat|botgem/i.test(endpoint)) endpoint = "";

    if (!model) model = parsed.models[0] || "";
    if (!model) {
      const labeledModel = value.match(/(?:model|模型)\s*[:=：]\s*["'`]?([^\s,;，；"'`<>]+)/i);
      if (labeledModel) model = trimPunctuation(labeledModel[1]);
    }
    // Drop key-body false positives (e.g. o3pNAUzd... inside sk-...).
    if (model && (!isLikelyModelName(model) || (apiKey && apiKey.includes(model)))) model = "";

    return { endpoint, apiKey, model };
  }

  function mergeNewApiCopiedInfo(config, copiedText, sourceUrl) {
    const parsed = parseNewApiConnectionInfo(copiedText, sourceUrl);
    return {
      ...config,
      endpoint: parsed.endpoint || config?.endpoint || "",
      apiKey: parsed.apiKey || config?.apiKey || "",
      model: parsed.model || config?.model || ""
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

  function getRowCells(row, headers = []) {
    const cells = [...(row?.children || [])];
    // Many NewAPI tables prepend a checkbox/selection cell with no header.
    if (cells.length && cells[0].querySelector?.('input[type="checkbox"]') && !clean(cells[0].textContent)) {
      if (headers.length === cells.length && !clean(headers[0])) return cells;
      return cells.slice(1);
    }
    return cells;
  }

  function getRowCellByHeader(row, headers, matcher, fallbackIndex) {
    const index = headers.findIndex(header => matcher.test(header));
    const cells = getRowCells(row, headers);
    return cells[index >= 0 ? index : fallbackIndex] || null;
  }

  function isNewApiKeyHeader(header) {
    return /(?:api\s*)?(?:密钥|key)|令牌|token/i.test(String(header || ""));
  }

  function isNewApiTokenHeaders(headers) {
    return headers.some(isNewApiKeyHeader) && headers.some(header => /名称|name/i.test(header));
  }

  function isNewApiKeysPath(pathname) {
    // Page routes only. Ignore query/hash and never treat /api/token as a keys UI page.
    const path = String(pathname || "").split(/[?#]/)[0];
    if (/\/api(?:\/|$)/i.test(path)) return false;
    return /\/(?:keys|token|console\/token)(?:\/|$)/i.test(path);
  }

  function normalizeNewApiKey(value) {
    const candidate = trimPunctuation(value);
    if (!candidate || isMasked(candidate) || /^https?:\/\//i.test(candidate)) return "";
    if (/^sk[-_]/i.test(candidate)) return isLikelyApiKey(candidate) ? candidate : "";
    // NewAPI stores the secret without the sk- prefix and only prefixes it when copying/using.
    if (/^[A-Za-z0-9._-]{16,}$/.test(candidate)) return `sk-${candidate}`;
    return isLikelyApiKey(candidate) ? candidate : "";
  }

  function readNewApiAuthHeaders() {
    // NewAPI (incl. achai /keys) uses cookie session + New-Api-User from localStorage.uid.
    // Do NOT invent Bearer tokens from random localStorage JSON — that breaks cookie auth.
    const headers = { "Content-Type": "application/json" };
    const storage = typeof localStorage === "undefined" ? null : localStorage;
    if (!storage) return headers;
    const tryParse = raw => {
      try { return raw ? JSON.parse(raw) : null; } catch (_error) { return null; }
    };
    const pickUserId = obj => {
      if (obj == null || typeof obj !== "object") return null;
      return obj.user?.id
        ?? obj.auth?.user?.id
        ?? obj.data?.user?.id
        ?? obj.data?.id
        ?? obj.state?.user?.id
        ?? obj.profile?.id
        ?? (Number.isFinite(Number(obj.id)) || /^\d+$/.test(String(obj.id || "")) ? obj.id : null)
        ?? null;
    };
    const pickToken = obj => clean(
      obj?.token
      || obj?.access_token
      || obj?.accessToken
      || obj?.user?.token
      || obj?.user?.access_token
      || obj?.data?.token
      || ""
    );

    const uidKeys = ["uid", "userId", "user_id", "New-Api-User", "new-api-user"];
    for (const key of uidKeys) {
      const uid = clean(storage.getItem(key) || "");
      if (uid && !headers["New-Api-User"]) headers["New-Api-User"] = uid;
    }

    for (const key of ["user", "session", "auth", "userInfo", "user-info", "profile"]) {
      const parsed = tryParse(storage.getItem(key));
      if (!parsed) continue;
      const userId = pickUserId(parsed)
        ?? pickUserId(parsed.user || {})
        ?? pickUserId(parsed.state || {})
        ?? pickUserId(parsed.data || {});
      if (userId != null && !headers["New-Api-User"]) {
        headers["New-Api-User"] = String(userId);
      }
      // Only attach Bearer when the known auth object actually has a token field.
      const token = pickToken(parsed)
        || pickToken(parsed.user || {})
        || pickToken(parsed.state || {})
        || pickToken(parsed.data || {});
      if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  function extractNewApiKeyPayload(payload) {
    if (payload == null) return "";
    if (typeof payload === "string") return normalizeNewApiKey(payload);
    if (typeof payload !== "object") return "";
    const candidates = [
      payload?.data?.key,
      payload?.data?.token,
      payload?.data?.api_key,
      payload?.data?.apiKey,
      typeof payload?.data === "string" ? payload.data : "",
      payload?.key,
      payload?.token,
      payload?.api_key,
      payload?.apiKey
    ];
    for (const candidate of candidates) {
      const key = normalizeNewApiKey(candidate);
      if (key) return key;
    }
    return "";
  }

  function extractNewApiTokenListPayload(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    const candidates = [
      payload?.data?.items,
      payload?.data?.data,
      payload?.data?.list,
      payload?.data?.tokens,
      payload?.data,
      payload?.items,
      payload?.list,
      payload?.tokens
    ];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) return candidate;
    }
    return [];
  }

  async function fetchNewApiTokenKey(origin, tokenId, fetchImpl, options = {}) {
    const id = Number(tokenId);
    if (!origin || !id) return "";
    const fetchFn = fetchImpl || fetch;
    const headers = readNewApiAuthHeaders();
    try {
      const response = await fetchFn(`${origin}/api/token/${id}/key`, {
        method: "POST",
        headers,
        credentials: "include",
        signal: options.signal
      });
      if (!response.ok) return "";
      const payload = await response.json();
      return extractNewApiKeyPayload(payload);
    } catch (_error) {}
    return "";
  }

  async function fetchNewApiTokenList(origin, fetchImpl, options = {}) {
    if (!origin) return [];
    const fetchFn = fetchImpl || fetch;
    const size = Math.min(200, Math.max(1, Number(options.size) || 100));
    const url = new URL("/api/token/", origin);
    url.searchParams.set("p", String(options.page || 1));
    url.searchParams.set("size", String(size));
    try {
      const response = await fetchFn(url.toString(), {
        method: "GET",
        headers: readNewApiAuthHeaders(),
        credentials: "include",
        signal: options.signal
      });
      if (!response.ok) return [];
      const payload = await response.json();
      return extractNewApiTokenListPayload(payload);
    } catch (_error) {}
    return [];
  }


  function extractNewApiRows(doc, sourceUrl) {
    const origin = (() => {
      try { return new URL(sourceUrl || doc.location?.href || "").origin; } catch (_error) { return ""; }
    })();
    const result = [];
    for (const table of doc.querySelectorAll("table")) {
      const headers = getHeaderTexts(table);
      if (!isNewApiTokenHeaders(headers)) continue;
      const rows = table.querySelectorAll("tbody tr").length
        ? [...table.querySelectorAll("tbody tr")]
        : [...table.querySelectorAll("tr")].slice(1);
      rows.forEach((row, index) => {
        const idCell = getRowCellByHeader(row, headers, /^(?:id|#)$/i, 0);
        const nameCell = getRowCellByHeader(row, headers, /名称|name/i, 0);
        const keyCell = getRowCellByHeader(row, headers, /(?:api\s*)?(?:密钥|key)|令牌|token/i, 4);
        const modelCell = getRowCellByHeader(row, headers, /可用模型|模型|model/i, 5);
        const statusCell = getRowCellByHeader(row, headers, /状态|status/i, 1);
        const hasIdHeader = headers.some(header => /^(?:id|#)$/i.test(header));
        const rawIdText = clean(idCell?.textContent);
        const nameText = clean(nameCell?.textContent);
        const attrId = clean(
          row.getAttribute?.("data-row-key")
          || row.getAttribute?.("data-key")
          || row.getAttribute?.("data-id")
          || row.dataset?.rowKey
          || row.dataset?.id
          || ""
        );
        // Numeric "名称" is often only a label on modern NewAPI forks (achai).
        // Prefer a real id column/attr; keep name-derived ids as untrusted candidates.
        let tokenId = 0;
        let tokenIdSource = "";
        if (hasIdHeader && /^\d+$/.test(rawIdText)) {
          tokenId = Number(rawIdText);
          tokenIdSource = "id";
        } else if (/^\d+$/.test(attrId)) {
          tokenId = Number(attrId);
          tokenIdSource = "attr";
        } else if (/^\d+$/.test(nameText)) {
          tokenId = Number(nameText);
          tokenIdSource = "name";
        } else if (/^\d+$/.test(rawIdText)) {
          tokenId = Number(rawIdText);
          tokenIdSource = "id";
        }
        const keyText = clean(keyCell?.textContent);
        const apiKey = getElementCandidates(keyCell)[0] || "";
        if (!nameText && !keyText && !attrId) return;
        let name = clean(nameCell?.textContent);
        if (!name || /^\d+$/.test(name) || isMasked(name) || /^sk[-_]/i.test(name)) {
          name = tokenId ? `令牌 ${tokenId}` : `NewAPI ${index + 1}`;
        }
        const modelText = clean(modelCell?.textContent);
        const models = extractModels(modelText).filter(isLikelyModelName);
        result.push({
          id: tokenId ? `token-${tokenId}` : `${index}-${name}`,
          tokenId,
          tokenIdSource,
          rawName: nameText,
          name,
          endpoint: origin,
          apiKey,
          maskedKey: keyText,
          model: models[0] || "",
          status: clean(statusCell?.textContent),
          keyCell,
          rowEl: row,
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
    const pushDecoded = decoded => {
      if (!decoded) return;
      const parsed = parseLooseConfigText(decoded, sourceUrl);
      const whole = trimPunctuation(decoded);
      // Decoded payload is often a bare token without sk-/labels.
      if (isLikelyApiKey(whole) && !parsed.apiKeys.includes(whole)) {
        parsed.apiKeys = unique([...parsed.apiKeys, whole]);
      }
      parsedSegments.push(parsed);
    };
    for (const segment of unique(segments)) {
      parsedSegments.push(parseLooseConfigText(segment, sourceUrl));
      pushDecoded(decodeBase64(segment));
      for (const decodedToken of extractBase64Tokens(segment)) pushDecoded(decodedToken);
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

  function makeEndpointAccountName(endpoint, fallback = "") {
    // Prefer an already-built full page URL name; else the endpoint URL.
    const fb = clean(fallback);
    if (/^https?:\/\//i.test(fb)) return fb.replace(/\/$/, "");
    const url = normalizeEndpoint(endpoint) || clean(endpoint);
    if (url) return url.replace(/\/$/, "");
    return fb || "OpenKey Provider";
  }

  function buildSub2ApiAccount(config, groupId) {
    return {
      name: makeEndpointAccountName(config?.endpoint, config?.name),
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
    const endpoint = normalizeEndpoint(config?.endpoint) || clean(config?.endpoint);
    return {
      name: makeEndpointAccountName(endpoint, config?.name),
      endpoint,
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
    isNewApiKeyHeader,
    isNewApiTokenHeaders,
    isNewApiKeysPath,
    extractNewApiRows,
    readNewApiAuthHeaders,
    fetchNewApiTokenKey,
    fetchNewApiTokenList,
    extractNewApiKeyPayload,
    extractNewApiTokenListPayload,
    normalizeNewApiKey,
    getHeaderTexts,
    getRowCells,
    extractUrls,
    getElementCandidates,
    inferFallbackModel,
    isLikelyApiKey,
    isLikelyModelName,
    makeConfigName,
    makeEndpointAccountName,
    maskSecret,
    mergeNewApiCopiedInfo,
    parseNewApiConnectionInfo,
    needsWidgetRemount,
    normalizeEndpoint,
    parseLooseConfigText,
    resolveManualApiKey
  };
});
