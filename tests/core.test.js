const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const core = require("../src/core.js");
const newapi = require("../src/newapi.js");

function makeMessageWindow() {
  const listeners = new Set();
  let token = "";
  const dispatch = data => {
    for (const listener of listeners) listener({ type: "message", data });
  };
  return {
    addEventListener(type, listener) {
      if (type === "message") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "message") listeners.delete(listener);
    },
    postMessage(data) {
      if (data.type === "arm") {
        token = data.token;
        queueMicrotask(() => dispatch({ ...data, type: "armed" }));
      }
      if (data.type === "disarm" && data.token === token) token = "";
    },
    copy(value) {
      dispatch({
        channel: "openkey-clipboard-v1",
        type: "clipboard",
        token,
        text: value
      });
    },
    get token() { return token; },
    dispatch
  };
}

function makeControl(label, attributes = {}, onClick = () => {}) {
  return {
    textContent: label,
    hidden: false,
    getAttribute(name) {
      if (name === "aria-hidden") return null;
      return attributes[name] || null;
    },
    getClientRects() { return [{}]; },
    click: onClick
  };
}

function bareRow(overrides = {}) {
  return {
    id: overrides.id || "row-1",
    tokenId: overrides.tokenId || 0,
    tokenIdSource: overrides.tokenIdSource || "",
    rawName: overrides.rawName || "",
    endpoint: overrides.endpoint || "https://example.test",
    apiKey: overrides.apiKey || "",
    maskedKey: overrides.maskedKey || "",
    keyCell: overrides.keyCell || {
      querySelector() { return null; },
      querySelectorAll() { return []; }
    },
    rowEl: overrides.rowEl || {
      querySelector() { return null; }
    },
    ...overrides
  };
}

function emptyDoc(extra = {}) {
  return {
    querySelector() { return null; },
    querySelectorAll() { return []; },
    ...extra
  };
}

async function withExtractedRows(rows, run) {
  const original = core.extractNewApiRows;
  core.extractNewApiRows = () => rows;
  try {
    return await run();
  } finally {
    core.extractNewApiRows = original;
  }
}

function selectorHas(selector, part) {
  return String(selector || "")
    .split(",")
    .map(item => item.trim())
    .some(item => item === part || item.includes(part));
}


test("extracts bare keys without sk- prefix next to an endpoint", () => {
  const key = "stepfunBareToken0123456789ab";
  const result = core.parseLooseConfigText([
    key,
    "https://api.stepfun.com/step_plan/v1"
  ].join("\n"), "https://linux.do/t/topic/2662243");
  assert.equal(result.endpoint, "https://api.stepfun.com/step_plan/v1");
  assert.deepEqual(result.apiKeys, [key]);
});

test("does not treat base64-encoded secrets as the raw API key", () => {
  const key = "sk-encoded_secret_1234567890";
  const encoded = Buffer.from(key, "utf8").toString("base64");
  assert.equal(core.isLikelyApiKey(encoded.replace(/=+$/, "")), false);
  assert.deepEqual(core.extractBase64Tokens(encoded), [key]);
});

test("extracts endpoint, labeled key and model", () => {
  const result = core.parseLooseConfigText([
    "endpoint=https://api.example.com/v1",
    "OPENAI_API_KEY=sk-test_1234567890",
    "model=gpt-4o"
  ].join("\n"), "https://linux.do/t/topic/1");
  assert.equal(result.endpoint, "https://api.example.com/v1");
  assert.deepEqual(result.apiKeys, ["sk-test_1234567890"]);
  assert.equal(result.models[0], "gpt-4o");
});

test("does not treat a Grok endpoint hostname as a model", () => {
  assert.deepEqual(core.extractModels("url: https://grok.example.com/v1"), []);
});

test("normalizes the Grok 4.5 title marker to its model name", () => {
  assert.deepEqual(core.extractModels("grok4.5 5000刀"), ["grok-4.5"]);
});

test("decodes base64 configuration text", () => {
  const encoded = Buffer.from("url=https://relay.example.com/v1\nkey=sk-demo_1234567890\nmodel=claude-3-7-sonnet", "utf8").toString("base64");
  const decoded = core.decodeBase64(encoded);
  const result = core.parseLooseConfigText(decoded, "https://linux.do/t/topic/1");
  assert.equal(result.endpoint, "https://relay.example.com/v1");
  assert.deepEqual(result.apiKeys, ["sk-demo_1234567890"]);
  assert.equal(result.models[0], "claude-3-7-sonnet");
});

test("decodes a standalone base64 endpoint address", () => {
  const encodedAddress = Buffer.from("https://relay.example.com/v1", "utf8").toString("base64");
  assert.deepEqual(core.extractBase64Tokens(`地址：${encodedAddress}`), ["https://relay.example.com/v1"]);
});

test("decodes a standalone base64 API key", () => {
  const key = "sk-base64_1234567890";
  const encodedKey = Buffer.from(key, "utf8").toString("base64");
  assert.deepEqual(core.extractBase64Tokens(`key：${encodedKey}`), [key]);
});

test("resolves a manually entered base64 API key", () => {
  const key = "sk-manual_1234567890";
  const encodedKey = Buffer.from(key, "utf8").toString("base64");
  assert.equal(core.resolveManualApiKey(encodedKey, true), key);
});

test("joins line-wrapped base64 before decoding the key", () => {
  const key = "sk-wrap_demo_1234567890abcdef";
  const encodedKey = Buffer.from(key, "utf8").toString("base64");
  const wrapped = `${encodedKey.slice(0, -2)}\n${encodedKey.slice(-2)}`;
  assert.deepEqual(core.extractBase64Tokens(`64解密\n${wrapped}`), [key]);
});


test("collects line-wrapped base64 bare key with endpoint on linux.do text", () => {
  const key = "stepfunBareToken0123456789ab";
  const encodedKey = Buffer.from(key, "utf8").toString("base64");
  const wrapped = `${encodedKey.slice(0, -2)}\n${encodedKey.slice(-2)}`;
  const ownerText = `阶悦星辰 token Plan。64解密\n${wrapped}\nhttps://api.stepfun.com/step_plan/v1`;
  const ownerArticle = {
    innerText: ownerText,
    textContent: ownerText,
    querySelectorAll() { return []; }
  };
  const doc = {
    querySelector(sel) {
      if (sel === "main article" || sel === "article") return ownerArticle;
      if (sel === "main h1" || sel === "h1") return { textContent: "64解密" };
      return null;
    }
  };
  const configs = core.collectLinuxDoConfigs(doc, "https://linux.do/t/topic/2662243");
  assert.equal(configs.length, 1);
  assert.equal(configs[0].endpoint, "https://api.stepfun.com/step_plan/v1");
  assert.equal(configs[0].apiKey, key);
});

test("collects linux.do configs when base64 key wraps above the endpoint", () => {
  const key = "sk-step_plan_key_1234567890ab";
  const encodedKey = Buffer.from(key, "utf8").toString("base64");
  const wrapped = `${encodedKey.slice(0, -2)}\n${encodedKey.slice(-2)}`;
  const text = `阶悦星辰 token Plan。64解密\n${wrapped}\nhttps://api.stepfun.com/step_plan/v1`;
  // Lightweight stand-in for collectLinuxDoConfigs ownerText parsing path.
  const tokens = core.extractBase64Tokens(text);
  const parsed = core.parseLooseConfigText(text, "https://linux.do/t/topic/2662243");
  assert.deepEqual(tokens, [key]);
  assert.equal(parsed.endpoint, "https://api.stepfun.com/step_plan/v1");
  assert.equal(parsed.apiKeys.length, 0);
  const fromDecoded = core.parseLooseConfigText(tokens[0], "https://linux.do/t/topic/2662243");
  assert.deepEqual(fromDecoded.apiKeys, [key]);
});

test("builds a CC Switch v1 provider deep link", () => {
  const link = core.buildCcSwitchLink({
    name: "Demo Provider",
    endpoint: "https://api.example.com/v1",
    apiKey: "sk-demo_1234567890",
    model: "gpt-4o",
    source: "https://linux.do/t/topic/1"
  }, "codex");
  const parsed = new URL(link);
  assert.equal(parsed.protocol, "ccswitch:");
  assert.equal(parsed.hostname, "v1");
  assert.equal(parsed.pathname, "/import");
  assert.equal(parsed.searchParams.get("resource"), "provider");
  assert.equal(parsed.searchParams.get("app"), "codex");
  assert.equal(parsed.searchParams.get("apiKey"), "sk-demo_1234567890");
});

test("uses topic keywords only when no explicit model exists", () => {
  assert.equal(core.inferFallbackModel("小试牛刀一下，Grok4.5 测试"), "grok-4.5");
  assert.equal(core.inferFallbackModel("GPT API 公益地址"), "gpt-5.6-sol");
  assert.equal(core.inferFallbackModel("普通 API 分享"), "");
});

test("rejects masked key values", () => {
  assert.equal(core.isLikelyApiKey("sk-Abcd**********ErJ2"), false);
  assert.equal(core.maskSecret("sk-demo_1234567890"), "sk-d••••7890");
});

test("does not remount a widget when its parent and placement are unchanged", () => {
  const avatar = {};
  const toolbar = {};
  assert.equal(core.needsWidgetRemount(avatar, avatar, "below-anchor", "below-anchor"), false);
  assert.equal(core.needsWidgetRemount(avatar, toolbar, "below-anchor", "inline-after"), true);
});

test("uses copied NewAPI link information instead of a masked table key", () => {
  const result = core.mergeNewApiCopiedInfo({
    endpoint: "https://welfare.0xpsyche.me",
    apiKey: "",
    model: ""
  }, [
    "Base URL: https://gateway.example.com/v1",
    "API Key: sk-copied_1234567890",
    "Model: gpt-4o"
  ].join("\n"), "https://welfare.0xpsyche.me/keys");
  assert.equal(result.endpoint, "https://gateway.example.com/v1");
  assert.equal(result.apiKey, "sk-copied_1234567890");
  assert.equal(result.model, "gpt-4o");
});

test("builds a direct Sub2API OpenAI account request", () => {
  assert.deepEqual(core.buildSub2ApiAccount({
    name: "https://gateway.example.com/v1",
    endpoint: "https://gateway.example.com/v1",
    apiKey: "sk-direct_1234567890"
  }, 2), {
    name: "https://gateway.example.com/v1",
    notes: "",
    platform: "openai",
    type: "apikey",
    credentials: {
      base_url: "https://gateway.example.com/v1",
      api_key: "sk-direct_1234567890"
    },
    proxy_id: null,
    concurrency: 10,
    priority: 1,
    rate_multiplier: 1,
    group_ids: [2],
    expires_at: null,
    upstream_billing_probe_enabled: true,
    auto_pause_on_expired: true
  });
});

test("builds a native Sub2API UI import plan without touching login credentials", () => {
  assert.deepEqual(core.buildSub2ApiUiImportPlan({
    name: "Welfare Key",
    endpoint: "https://welfare.0xpsyche.me/",
    apiKey: "sk-direct_1234567890"
  }), {
    name: "https://welfare.0xpsyche.me",
    endpoint: "https://welfare.0xpsyche.me",
    apiKey: "sk-direct_1234567890",
    platformLabel: "OpenAI",
    typeLabel: "API Key",
    groupLabel: "白嫖"
  });
});

test("recognizes NewAPI console token paths and 密钥 headers", () => {
  assert.equal(core.isNewApiKeysPath("/console/token"), true);
  assert.equal(core.isNewApiKeysPath("/keys"), true);
  assert.equal(core.isNewApiKeysPath("/token"), true);
  assert.equal(core.isNewApiKeysPath("/console/log"), false);
  assert.equal(core.isNewApiTokenHeaders(["名称", "状态", "密钥", "额度"]), true);
  assert.equal(core.isNewApiTokenHeaders(["ID", "额度"]), false);
});

test("normalizes NewAPI raw keys and rejects masked table values", () => {
  assert.equal(core.normalizeNewApiKey("0L6P**********Syd9"), "");
  assert.equal(core.normalizeNewApiKey("sk-0L6P**********Syd9"), "");
  assert.equal(core.normalizeNewApiKey("sk-xxx...xxxx"), "");
  assert.equal(core.normalizeNewApiKey("abcdef0123456789abcd"), "sk-abcdef0123456789abcd");
  assert.equal(core.normalizeNewApiKey("sk-abcdef0123456789abcd"), "sk-abcdef0123456789abcd");
});

test("extracts token id from NewAPI token table rows", () => {
  const { JSDOM } = (() => { try { return require("jsdom"); } catch (_error) { return {}; } })();
  if (!JSDOM) {
    // DOM-less fallback: ensure helper export exists
    assert.equal(typeof core.extractNewApiRows, "function");
    return;
  }
  const dom = new JSDOM(`<!doctype html><table><thead><tr>
    <th>名称</th><th>状态</th><th>剩余额度/总额度</th><th>分组</th><th>密钥</th><th>可用模型</th>
  </tr></thead><tbody><tr>
    <td>23</td><td>启用</td><td>无限</td><td>default</td><td>sk-0L6P**********Syd9</td><td>无限制</td>
  </tr></tbody></table>`);
  // Note: first column labeled 名称 but contains id in this UI snapshot
  const rows = core.extractNewApiRows(dom.window.document, "https://newapi.imagic.eu.org/console/token");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tokenId, 23);
  assert.equal(rows[0].apiKey, "");
});

test("fetchNewApiTokenKey normalizes API response keys", async () => {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls += 1;
    assert.equal(url, "https://newapi.imagic.eu.org/api/token/23/key");
    assert.equal(options.method, "POST");
    return {
    ok: true,
    async json() { return { success: true, data: { key: "rawkey_1234567890abcd" } }; }
    };
  };
  const key = await core.fetchNewApiTokenKey("https://newapi.imagic.eu.org", 23, fetchImpl);
  assert.equal(key, "sk-rawkey_1234567890abcd");
  assert.equal(calls, 1);
});

test("fetchNewApiTokenKey accepts alternate payload shapes", async () => {
  const key = await core.fetchNewApiTokenKey("https://v-api.de5.net", 9, async () => ({
    ok: true,
    async json() { return { success: true, data: "altpayload_1234567890ab" }; }
  }));
  assert.equal(key, "sk-altpayload_1234567890ab");
  assert.equal(core.extractNewApiKeyPayload({ data: { apiKey: "nested_api_key_123456" } }), "sk-nested_api_key_123456");
});

test("fetchNewApiTokenList returns the stable item list", async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://www.achai.cc/api/token/?p=1&size=20");
    assert.equal(options.method, "GET");
    return {
      ok: true,
      async json() {
        return {
          success: true,
          data: { items: [{ id: 326, name: "12", key: "demo********key" }] }
        };
      }
    };
  };
  const items = await core.fetchNewApiTokenList("https://www.achai.cc", fetchImpl, { size: 20 });
  assert.deepEqual(items.map(item => ({ id: item.id, name: item.name })), [{ id: 326, name: "12" }]);
});

test("fetchNewApiTokenList accepts nested list payload shapes", async () => {
  const items = await core.fetchNewApiTokenList("https://v-api.de5.net", async () => ({
    ok: true,
    async json() {
      return { data: { list: [{ id: 7, name: "默认令牌" }] } };
    }
  }), { size: 50 });
  assert.deepEqual(items.map(item => item.id), [7]);
  assert.deepEqual(
    core.extractNewApiTokenListPayload({ items: [{ id: 1 }] }).map(item => item.id),
    [1]
  );
});

test("parses NewAPI 复制链接信息 clipboard payloads", () => {
  const next = core.mergeNewApiCopiedInfo(
    { endpoint: "https://newapi.imagic.eu.org", apiKey: "", model: "" },
    'https://app.nextchat.dev/#/?settings={"key":"sk-demo_link_1234567890","url":"https://newapi.imagic.eu.org"}',
    "https://newapi.imagic.eu.org/console/token"
  );
  assert.equal(next.apiKey, "sk-demo_link_1234567890");
  assert.equal(next.endpoint, "https://newapi.imagic.eu.org");

  const labeled = core.mergeNewApiCopiedInfo(
    { endpoint: "", apiKey: "", model: "" },
    "地址：https://gateway.example.com/v1\n密钥：sk-label_1234567890abcd\n模型：gpt-4o",
    "https://newapi.imagic.eu.org/console/token"
  );
  assert.equal(labeled.endpoint, "https://gateway.example.com/v1");
  assert.equal(labeled.apiKey, "sk-label_1234567890abcd");
  assert.equal(labeled.model, "gpt-4o");
});

test("does not treat API key bodies as models from connection info", () => {
  const key = "sk-0L6Po3pNAUzdPGmugh1OQxC60JJwOYuZbt3PFTaYSyd9";
  const merged = core.mergeNewApiCopiedInfo(
    { endpoint: "", apiKey: "", model: "" },
    `地址：https://newapi.imagic.eu.org\n密钥：${key}`,
    "https://newapi.imagic.eu.org/console/token"
  );
  assert.equal(merged.apiKey, key);
  assert.equal(merged.model, "");
  assert.deepEqual(core.extractModels(key), []);
  assert.deepEqual(core.extractModels("o3pNAUzdPGmugh1OQxC60JJwOYuZbt3PFTaYSyd9"), []);
  assert.deepEqual(core.extractModels("model: gpt-4o"), ["gpt-4o"]);
  assert.deepEqual(core.extractModels("o3-mini"), ["o3-mini"]);
});

test("builds Sub2API account names from URL only", () => {
  assert.equal(
    core.makeEndpointAccountName("https://newapi.imagic.eu.org/v1"),
    "https://newapi.imagic.eu.org/v1"
  );
  assert.equal(
    core.makeEndpointAccountName(
      "https://newapi.imagic.eu.org",
      "https://newapi.imagic.eu.org/console/token"
    ),
    "https://newapi.imagic.eu.org/console/token"
  );
  assert.equal(
    core.buildSub2ApiUiImportPlan({
      name: "https://www.achai.cc/keys",
      endpoint: "https://www.achai.cc",
      apiKey: "sk-demo_1234567890"
    }).name,
    "https://www.achai.cc/keys"
  );
  assert.equal(
    core.buildSub2ApiUiImportPlan({
      name: "令牌 23",
      endpoint: "https://newapi.imagic.eu.org",
      apiKey: "sk-demo_1234567890"
    }).name,
    "https://newapi.imagic.eu.org"
  );
});

test("readNewApiAuthHeaders prefers uid cookie user and avoids fake bearer", () => {
  const originalStorage = global.localStorage;
  const storage = {
    uid: "42",
    junk: JSON.stringify({ hello: "world", token: "should-not-use" }),
    getItem(key) { return this[key] ?? null; },
    get length() { return 2; },
    key(i) { return ["uid", "junk"][i]; }
  };
  try {
    global.localStorage = storage;
    assert.deepEqual(core.readNewApiAuthHeaders(), {
      "Content-Type": "application/json",
      "New-Api-User": "42"
    });
  } finally {
    if (originalStorage === undefined) delete global.localStorage;
    else global.localStorage = originalStorage;
  }
});

test("readNewApiAuthHeaders accepts userInfo id without inventing bearer from junk", () => {
  const originalStorage = global.localStorage;
  const storage = {
    userInfo: JSON.stringify({ id: 88, name: "demo" }),
    junk: JSON.stringify({ token: "should-not-use" }),
    getItem(key) { return this[key] ?? null; }
  };
  try {
    global.localStorage = storage;
    assert.deepEqual(core.readNewApiAuthHeaders(), {
      "Content-Type": "application/json",
      "New-Api-User": "88"
    });
  } finally {
    if (originalStorage === undefined) delete global.localStorage;
    else global.localStorage = originalStorage;
  }
});

test("recognizes API 密钥 header used by achai-style keys pages", () => {
  assert.equal(core.isNewApiTokenHeaders(["名称", "状态", "API 密钥", "额度"]), true);
  assert.equal(core.isNewApiKeyHeader("API 密钥"), true);
});

test("keeps checkbox cells aligned when the table has a blank checkbox header", () => {
  const checkboxCell = {
    textContent: "",
    querySelector(selector) {
      return selector === 'input[type="checkbox"]' ? {} : null;
    }
  };
  const cells = [checkboxCell, { textContent: "12" }, { textContent: "已启用" }];
  const row = { children: cells };
  assert.equal(core.getRowCells(row, ["", "名称", "状态"])[1].textContent, "12");
  assert.equal(core.getRowCells(row)[0].textContent, "12");
});

test("extracts achai-style /keys rows with API 密钥 column", () => {
  const { JSDOM } = (() => { try { return require("jsdom"); } catch (_error) { return {}; } })();
  if (!JSDOM) {
    assert.equal(core.isNewApiKeyHeader("API 密钥"), true);
    return;
  }
  const dom = new JSDOM(`<!doctype html><table><thead><tr>
    <th></th><th>名称</th><th>状态</th><th>API 密钥</th><th>额度</th><th>分组</th><th>模型</th><th>操作</th>
  </tr></thead><tbody><tr>
    <td><input type="checkbox"></td>
    <td>12</td><td>已启用</td><td>sk-XU9e*********v0cs</td><td>无限制</td><td>所有模型</td><td>无限制</td>
    <td><button aria-label="Open menu">⋯</button></td>
  </tr></tbody></table>`);
  const rows = core.extractNewApiRows(dom.window.document, "https://www.achai.cc/keys");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tokenId, 12);
  assert.equal(rows[0].tokenIdSource, "name");
  assert.equal(rows[0].rawName, "12");
  assert.equal(rows[0].apiKey, "");
  assert.match(String(rows[0].maskedKey || ""), /v0cs/i);
});

test("classifies the three supported NewAPI DOM structures", () => {
  const fakeRow = needle => ({
    rowEl: {
      querySelector(value) {
        return String(value || "").includes(needle) ? {} : null;
      }
    }
  });
  const doc = { querySelector() { return null; } };
  assert.equal(
    newapi.detectAdapter(doc, [fakeRow('aria-label="打开菜单"')]),
    "menu"
  );
  assert.equal(
    newapi.detectAdapter(doc, [fakeRow('aria-label="toggle token visibility"')]),
    "reveal"
  );
  assert.equal(
    newapi.detectAdapter(doc, [fakeRow('title="复制到剪贴板"')]),
    "direct-copy"
  );
});

test("uses API-first flow for all three NewAPI adapters without unsafe clicks", async () => {
  const originalExtractRows = core.extractNewApiRows;
  const makeWindow = () => {
    const listeners = new Set();
    let token = "";
    const dispatch = data => {
      for (const listener of listeners) listener({ type: "message", data });
    };
    return {
      addEventListener(type, listener) {
        if (type === "message") listeners.add(listener);
      },
      removeEventListener(type, listener) {
        if (type === "message") listeners.delete(listener);
      },
      postMessage(data) {
        if (data.type === "arm") {
          token = data.token;
          queueMicrotask(() => dispatch({ ...data, type: "armed" }));
        }
        if (data.type === "disarm" && data.token === token) token = "";
      },
      copy(value) {
        dispatch({
          channel: "openkey-clipboard-v1",
          type: "clipboard",
          token,
          text: value
        });
      }
    };
  };
  const control = (label, attributes, onClick) => ({
    textContent: label,
    hidden: false,
    getAttribute(name) {
      if (name === "aria-hidden") return null;
      return attributes[name] || null;
    },
    getClientRects() { return [{}]; },
    click: onClick
  });
  const matches = (selector, part) => String(selector || "")
    .split(",")
    .map(item => item.trim())
    .some(item => item === part || item.includes(part));
  const run = async kind => {
    const win = makeWindow();
    const clicks = { toggle: 0, trigger: 0, item: 0, destructive: 0 };
    const fetchCalls = [];
    let menuOpen = false;
    const origin = kind === "menu" ? "https://www.achai.cc"
      : kind === "reveal" ? "https://newapi.imagic.eu.org"
      : "https://supercodes.vip";
    const expectedKey = `sk-${kind}_adapter_1234567890`;
    const fetchImpl = async url => {
      fetchCalls.push(url);
      if (url.includes("/api/token/?")) {
        return {
          ok: true,
          async json() {
            return {
              success: true,
              data: {
                items: [{ id: 326, name: "12", key: "menu********key" }]
              }
            };
          }
        };
      }
      assert.match(url, /\/api\/token\/326\/key$/);
      return {
        ok: true,
        async json() {
          return { success: true, data: { key: expectedKey } };
        }
      };
    };
    const toggle = control("", { "aria-label": "toggle token visibility" }, () => { clicks.toggle += 1; });
    const trigger = control("", kind === "menu"
      ? { "aria-label": "打开菜单", "data-slot": "dropdown-menu-trigger" }
      : { "aria-label": "copy token key" }, () => {
      clicks.trigger += 1;
      menuOpen = true;
    });
    const direct = control("", { title: "复制到剪贴板" }, () => {
      clicks.trigger += 1;
      win.copy(expectedKey);
    });
    const item = control(
      kind === "reveal" ? "复制密钥" : "复制连接信息",
      {},
      () => {
        clicks.item += 1;
        win.copy(kind === "menu" ? `地址：${origin}\n密钥：${expectedKey}` : expectedKey);
      }
    );
    const destructive = control("删除", {}, () => { clicks.destructive += 1; });
    const input = { value: "sk-xxx...xxxx" };
    const keyCell = {
      textContent: "sk-xxx...xxxx",
      getAttribute() { return null; },
      querySelector(selector) {
        if (kind === "reveal" && matches(selector, '[aria-label="toggle token visibility"]')) return toggle;
        if (kind === "reveal" && matches(selector, '[aria-label="copy token key"]')) return trigger;
        if (kind === "direct-copy" && matches(selector, '[title="复制到剪贴板"]')) return direct;
        return null;
      },
      querySelectorAll(selector) {
        return kind === "reveal" && selector === "input" ? [input] : [];
      }
    };
    const rowEl = {
      querySelector(selector) {
        if (kind === "menu" && matches(selector, "dropdown-menu-trigger")) return trigger;
        if (kind === "reveal" && matches(selector, '[aria-label="toggle token visibility"]')) return toggle;
        if (kind === "direct-copy" && matches(selector, '[title="复制到剪贴板"]')) return direct;
        return null;
      }
    };
    if (kind === "menu") {
      rowEl.__reactFiber$test = {
        memoizedProps: { row: { original: { id: 326 } } }
      };
    }
    const row = {
      id: 1,
      tokenId: 0,
      rawName: "12",
      endpoint: origin,
      apiKey: "",
      maskedKey: "menu********key",
      keyCell,
      rowEl
    };
    const doc = {
      querySelector() { return null; },
      querySelectorAll() {
        return menuOpen ? [destructive, item] : [];
      }
    };
    core.extractNewApiRows = () => [row];
    const [result] = await newapi.collect({
      document: doc,
      window: win,
      location: {
        href: `${origin}/${kind === "reveal" ? "console/token" : "keys"}`,
        origin
      },
      fetch: fetchImpl,
      budgetMs: 1500
    });
    return { result, clicks, expectedKey, fetchCalls };
  };

  try {
    for (const kind of ["menu", "reveal", "direct-copy"]) {
      const { result, clicks, expectedKey, fetchCalls } = await run(kind);
      assert.equal(result.apiKey, expectedKey);
      assert.equal(clicks.destructive, 0);
      assert.equal(clicks.trigger, 0);
      assert.equal(clicks.item, 0);
      assert.equal(clicks.toggle, 0);
      assert.ok(fetchCalls.some(url => /\/api\/token\/326\/key$/.test(url)));
      if (kind === "menu") {
        assert.deepEqual(fetchCalls, [`${result.endpoint}/api/token/326/key`]);
      } else {
        assert.ok(fetchCalls.some(url => url.includes("/api/token/?")));
      }
    }
  } finally {
    core.extractNewApiRows = originalExtractRows;
  }
});

test("falls back to menu clipboard copy when API key fetch fails", async () => {
  const originalExtractRows = core.extractNewApiRows;
  const listeners = new Set();
  let token = "";
  const dispatch = data => {
    for (const listener of listeners) listener({ type: "message", data });
  };
  const win = {
    addEventListener(type, listener) {
      if (type === "message") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "message") listeners.delete(listener);
    },
    postMessage(data) {
      if (data.type === "arm") {
        token = data.token;
        queueMicrotask(() => dispatch({ ...data, type: "armed" }));
      }
      if (data.type === "disarm" && data.token === token) token = "";
    }
  };
  const expectedKey = "sk-menu_fallback_1234567890";
  const origin = "https://www.achai.cc";
  let menuOpen = false;
  const clicks = { trigger: 0, item: 0, destructive: 0 };
  const control = (label, attributes, onClick) => ({
    textContent: label,
    hidden: false,
    getAttribute(name) {
      if (name === "aria-hidden") return null;
      return attributes[name] || null;
    },
    getClientRects() { return [{}]; },
    click: onClick
  });
  const trigger = control("", {
    "aria-label": "打开菜单",
    "data-slot": "dropdown-menu-trigger"
  }, () => {
    clicks.trigger += 1;
    menuOpen = true;
  });
  const item = control("复制连接信息", {}, () => {
    clicks.item += 1;
    dispatch({
      channel: "openkey-clipboard-v1",
      type: "clipboard",
      token,
      text: `地址：${origin}\n密钥：${expectedKey}`
    });
  });
  const destructive = control("删除", {}, () => { clicks.destructive += 1; });
  const row = {
    id: 1,
    tokenId: 326,
    rawName: "12",
    endpoint: origin,
    apiKey: "",
    maskedKey: "menu********key",
    keyCell: { querySelector() { return null; }, querySelectorAll() { return []; } },
    rowEl: {
      querySelector(selector) {
        return String(selector || "").includes("dropdown-menu-trigger") ? trigger : null;
      },
      __reactFiber$test: {
        memoizedProps: { row: { original: { id: 326 } } }
      }
    }
  };
  const doc = {
    querySelector(selector) {
      return String(selector || "").includes("dropdown-menu-trigger") ? trigger : null;
    },
    querySelectorAll() {
      return menuOpen ? [destructive, item] : [];
    }
  };
  const fetchImpl = async url => {
    if (url.includes("/api/token/?")) {
      return { ok: true, async json() { return { data: { items: [] } }; } };
    }
    return { ok: false, async json() { return {}; } };
  };
  core.extractNewApiRows = () => [row];
  try {
    const [result] = await newapi.collect({
      document: doc,
      window: win,
      location: { href: `${origin}/keys`, origin },
      fetch: fetchImpl,
      budgetMs: 1500
    });
    assert.equal(result.apiKey, expectedKey);
    assert.equal(clicks.trigger, 1);
    assert.equal(clicks.item, 1);
    assert.equal(clicks.destructive, 0);
  } finally {
    core.extractNewApiRows = originalExtractRows;
  }
});

test("rebinds achai-style numeric name ids through the token list API", async () => {
  const originalExtractRows = core.extractNewApiRows;
  const origin = "https://www.achai.cc";
  const expectedKey = "sk-achai_name_rebind_123456";
  const fetchCalls = [];
  const row = {
    id: "token-12",
    tokenId: 12,
    tokenIdSource: "name",
    rawName: "12",
    endpoint: origin,
    apiKey: "",
    maskedKey: "sk-XU9e*********v0cs",
    keyCell: { querySelector() { return null; }, querySelectorAll() { return []; } },
    rowEl: { querySelector() { return null; } }
  };
  core.extractNewApiRows = () => [row];
  try {
    const [result] = await newapi.collect({
      document: {
        querySelector(selector) {
          return String(selector || "").includes("dropdown-menu-trigger") ? {} : null;
        },
        querySelectorAll() { return []; }
      },
      window: {
        addEventListener() {},
        removeEventListener() {},
        postMessage() {}
      },
      location: { href: `${origin}/keys`, origin },
      fetch: async url => {
        fetchCalls.push(url);
        if (url.includes("/api/token/?")) {
          return {
            ok: true,
            async json() {
              return {
                success: true,
                data: {
                  items: [{ id: 326, name: "12", key: "sk-XU9e*********v0cs" }]
                }
              };
            }
          };
        }
        assert.match(url, /\/api\/token\/326\/key$/);
        assert.doesNotMatch(url, /\/api\/token\/12\/key$/);
        return {
          ok: true,
          async json() { return { success: true, data: { key: expectedKey } }; }
        };
      },
      budgetMs: 1500
    });
    assert.equal(result.apiKey, expectedKey);
    assert.equal(result.tokenId, 326);
    assert.ok(fetchCalls.some(url => url.includes("/api/token/?")));
    assert.ok(fetchCalls.some(url => /\/api\/token\/326\/key$/.test(url)));
    assert.equal(fetchCalls.some(url => /\/api\/token\/12\/key$/.test(url)), false);
  } finally {
    core.extractNewApiRows = originalExtractRows;
  }
});

test("resolves mixed numeric and named rows without skipping the first key", async () => {
  const originalExtractRows = core.extractNewApiRows;
  const origin = "https://www.achai.cc";
  const rows = [
    {
      id: "token-12",
      tokenId: 12,
      tokenIdSource: "name",
      rawName: "12",
      endpoint: origin,
      apiKey: "",
      maskedKey: "first********aaa1",
      keyCell: { querySelector() { return null; }, querySelectorAll() { return []; } },
      rowEl: { querySelector() { return null; } }
    },
    {
      id: "named",
      tokenId: 0,
      tokenIdSource: "",
      rawName: "备用令牌",
      endpoint: origin,
      apiKey: "",
      maskedKey: "second********bbb2",
      keyCell: { querySelector() { return null; }, querySelectorAll() { return []; } },
      rowEl: { querySelector() { return null; } }
    }
  ];
  core.extractNewApiRows = () => rows;
  try {
    const results = await newapi.collect({
      document: {
        querySelector(selector) {
          return String(selector || "").includes("dropdown-menu-trigger") ? {} : null;
        },
        querySelectorAll() { return []; }
      },
      window: {
        addEventListener() {},
        removeEventListener() {},
        postMessage() {}
      },
      location: { href: `${origin}/keys`, origin },
      fetch: async url => {
        if (url.includes("/api/token/?")) {
          return {
            ok: true,
            async json() {
              return {
                success: true,
                data: {
                  items: [
                    { id: 501, name: "12", key: "first********aaa1" },
                    { id: 502, name: "备用令牌", key: "second********bbb2" }
                  ]
                }
              };
            }
          };
        }
        const match = url.match(/\/api\/token\/(\d+)\/key$/);
        assert.ok(match);
        assert.notEqual(match[1], "12");
        return {
          ok: true,
          async json() {
            return {
              success: true,
              data: { key: `rowkey_${match[1]}_1234567890ab` }
            };
          }
        };
      },
      budgetMs: 2000
    });
    assert.equal(results[0].apiKey, "sk-rowkey_501_1234567890ab");
    assert.equal(results[0].tokenId, 501);
    assert.equal(results[1].apiKey, "sk-rowkey_502_1234567890ab");
    assert.equal(results[1].tokenId, 502);
  } finally {
    core.extractNewApiRows = originalExtractRows;
  }
});

test("resolves non-numeric token names through the token list API", async () => {
  const originalExtractRows = core.extractNewApiRows;
  const origin = "https://v-api.de5.net";
  const expectedKey = "sk-named_token_1234567890ab";
  const fetchCalls = [];
  const row = {
    id: "named",
    tokenId: 0,
    rawName: "默认令牌",
    endpoint: origin,
    apiKey: "",
    maskedKey: "named********7890",
    keyCell: { querySelector() { return null; }, querySelectorAll() { return []; } },
    rowEl: { querySelector() { return null; } }
  };
  core.extractNewApiRows = () => [row];
  try {
    const [result] = await newapi.collect({
      document: { querySelector() { return null; }, querySelectorAll() { return []; } },
      window: {
        addEventListener() {},
        removeEventListener() {},
        postMessage() {}
      },
      location: { href: `${origin}/keys`, origin },
      fetch: async url => {
        fetchCalls.push(url);
        if (url.includes("/api/token/?")) {
          return {
            ok: true,
            async json() {
              return {
                success: true,
                data: {
                  items: [{ id: 77, name: "默认令牌", key: "named********7890" }]
                }
              };
            }
          };
        }
        assert.match(url, /\/api\/token\/77\/key$/);
        return {
          ok: true,
          async json() { return { success: true, data: { key: expectedKey } }; }
        };
      },
      budgetMs: 1500
    });
    assert.equal(result.apiKey, expectedKey);
    assert.equal(result.tokenId, 77);
    assert.ok(fetchCalls.some(url => url.includes("/api/token/?")));
  } finally {
    core.extractNewApiRows = originalExtractRows;
  }
});

test("does not bind ambiguous duplicate token names from the list API", async () => {
  const originalExtractRows = core.extractNewApiRows;
  const origin = "https://www.achai.cc";
  const row = {
    id: "dup",
    tokenId: 0,
    rawName: "shared",
    endpoint: origin,
    apiKey: "",
    maskedKey: "dup*********key",
    keyCell: { querySelector() { return null; }, querySelectorAll() { return []; } },
    rowEl: { querySelector() { return null; } }
  };
  core.extractNewApiRows = () => [row];
  try {
    const [result] = await newapi.collect({
      document: { querySelector() { return null; }, querySelectorAll() { return []; } },
      window: {
        addEventListener() {},
        removeEventListener() {},
        postMessage() {}
      },
      location: { href: `${origin}/keys`, origin },
      fetch: async url => {
        if (url.includes("/api/token/?")) {
          return {
            ok: true,
            async json() {
              return {
                data: {
                  items: [
                    { id: 1, name: "shared", key: "dup*********key" },
                    { id: 2, name: "shared", key: "dup*********key" }
                  ]
                }
              };
            }
          };
        }
        throw new Error(`unexpected key fetch ${url}`);
      },
      budgetMs: 1200
    });
    assert.equal(result.apiKey, "");
    assert.equal(result.tokenId, 0);
    assert.equal(result.needsManualKey, true);
  } finally {
    core.extractNewApiRows = originalExtractRows;
  }
});

test("collects multiple rows through parallel API key fetches", async () => {
  const originalExtractRows = core.extractNewApiRows;
  const origin = "https://supercodes.vip";
  const rows = [11, 12, 13].map(id => ({
    id: `token-${id}`,
    tokenId: id,
    rawName: String(id),
    endpoint: origin,
    apiKey: "",
    maskedKey: `row${id}********key`,
    keyCell: { querySelector() { return null; }, querySelectorAll() { return []; } },
    rowEl: { querySelector() { return null; } }
  }));
  core.extractNewApiRows = () => rows;
  try {
    const results = await newapi.collect({
      document: { querySelector() { return null; }, querySelectorAll() { return []; } },
      window: {
        addEventListener() {},
        removeEventListener() {},
        postMessage() {}
      },
      location: { href: `${origin}/keys`, origin },
      fetch: async url => {
        const match = url.match(/\/api\/token\/(\d+)\/key$/);
        assert.ok(match);
        return {
          ok: true,
          async json() {
            return { success: true, data: { key: `multirow_${match[1]}_1234567890` } };
          }
        };
      },
      budgetMs: 2000
    });
    assert.deepEqual(results.map(item => item.apiKey), [
      "sk-multirow_11_1234567890",
      "sk-multirow_12_1234567890",
      "sk-multirow_13_1234567890"
    ]);
  } finally {
    core.extractNewApiRows = originalExtractRows;
  }
});

test("accepts repeated clipboard payloads", async () => {
  const listeners = new Map();
  const win = {
    token: "",
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener(event);
    },
    postMessage(data) {
      if (data.type === "arm") this.token = data.token;
      this.dispatchEvent({ type: "message", source: this, data });
      if (data.type === "arm") {
        this.dispatchEvent({
          type: "message",
          source: {},
          data: { ...data, type: "armed" }
        });
      }
    }
  };
  const copy = () => newapi.captureClipboard(() => {
    win.postMessage({
      channel: "openkey-clipboard-v1",
      type: "clipboard",
      token: win.token,
      text: "same copied value"
    });
  }, 50, win);
  assert.equal(await copy(), "same copied value");
  assert.equal(await copy(), "same copied value");
});

test("ignores stale system clipboard and waits for the page-world payload", async () => {
  const listeners = new Map();
  let reads = 0;
  const win = {
    navigator: {
      clipboard: {
        async readText() {
          reads += 1;
          return "same copied value";
        }
      }
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    postMessage(data) {
      if (data.type !== "arm") return;
      const token = data.token;
      for (const listener of listeners.get("message") || []) {
        listener({
          source: {},
          data: { ...data, type: "armed" }
        });
      }
      setTimeout(() => {
        for (const listener of listeners.get("message") || []) {
          listener({
            source: {},
            data: {
              channel: "openkey-clipboard-v1",
              type: "clipboard",
              token,
              text: "fresh copied value"
            }
          });
        }
      }, 5);
    }
  };
  assert.equal(await newapi.captureClipboard(() => true, 100, win), "fresh copied value");
  assert.equal(reads, 0);
});

test("captures alternate page-world clipboard writes and disarms emissions", async () => {
  const listeners = new Map();
  const addEventListener = (type, listener) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(listener);
  };
  const removeEventListener = (type, listener) => listeners.get(type)?.delete(listener);
  const dispatchEvent = event => {
    for (const listener of listeners.get(event.type) || []) listener(event);
  };
  class Clipboard {
    write() { return Promise.resolve(); }
    writeText() { return Promise.resolve(); }
  }
  class DataTransfer {
    setData() { return true; }
  }
  class Document {
    constructor() {
      this.activeElement = { value: "exec copied value", selectionStart: 0, selectionEnd: 17 };
    }
    addEventListener() {}
    removeEventListener() {}
    execCommand() { return true; }
  }
  const clipboard = new Clipboard();
  const document = new Document();
  const window = {
    addEventListener,
    removeEventListener,
    dispatchEvent,
    postMessage(data) {
      dispatchEvent({ type: "message", source: {}, data });
    },
    getSelection() { return ""; }
  };
  const copied = [];
  window.addEventListener("message", event => {
    if (event.data?.type === "clipboard") copied.push(event.data.text);
  });
  const context = vm.createContext({
    window,
    document,
    navigator: { clipboard },
    Clipboard,
    DataTransfer,
    Document,
    queueMicrotask
  });
  const originalSetData = DataTransfer.prototype.setData;
  vm.runInContext(fs.readFileSync(require.resolve("../src/page-hook.js"), "utf8"), context);
  assert.equal(DataTransfer.prototype.setData, originalSetData);

  window.postMessage({ channel: "openkey-clipboard-v1", type: "arm", token: "test" });
  assert.notEqual(DataTransfer.prototype.setData, originalSetData);
  new DataTransfer().setData("text/plain", "same copied value");
  await clipboard.write([{
    types: ["text/plain"],
    getType: async () => ({ text: async () => "same copied value" })
  }]);
  document.execCommand("copy");
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(copied, ["same copied value", "exec copied value", "same copied value"]);

  window.postMessage({ channel: "openkey-clipboard-v1", type: "disarm", token: "test" });
  assert.equal(DataTransfer.prototype.setData, originalSetData);
  new DataTransfer().setData("text/plain", "after disarm");
  assert.deepEqual(copied, ["same copied value", "exec copied value", "same copied value"]);
});

test("never treats destructive controls as copy candidates", () => {
  const node = {
    textContent: "删除",
    getAttribute() { return ""; }
  };
  assert.equal(newapi.isDestructiveControl(node), true);
  assert.equal(newapi.isDestructiveControl({
    textContent: "复制密钥",
    getAttribute() { return ""; }
  }), false);
  assert.equal(newapi.isDestructiveControl({
    textContent: "",
    getAttribute(name) { return name === "aria-label" ? "Edit token" : ""; }
  }), true);
});

test("recognizes NewAPI key page path variants and rejects near-misses", () => {
  for (const path of [
    "/keys",
    "/keys/",
    "/console/token",
    "/console/token/",
    "/token",
    "/token/123",
    "/app/console/token",
    "/KEYS",
    "/KEYS/"
  ]) {
    assert.equal(core.isNewApiKeysPath(path), true, path);
  }
  for (const path of [
    "/",
    "/console",
    "/console/log",
    "/console/tokens",
    "/api/token",
    "/api/token/",
    "/keyboard",
    "/my-keys-backup",
    ""
  ]) {
    assert.equal(core.isNewApiKeysPath(path), false, path);
  }
});

test("scales the collect budget with row count", () => {
  assert.ok(newapi.defaultBudgetMs(1) >= 3500);
  assert.ok(newapi.defaultBudgetMs(10) > newapi.defaultBudgetMs(1));
  assert.equal(newapi.defaultBudgetMs(1000), 8000);
});

test("extracts rows when a real id column exists and marks source as id", () => {
  const { JSDOM } = (() => { try { return require("jsdom"); } catch (_error) { return {}; } })();
  if (!JSDOM) {
    assert.equal(core.isNewApiKeyHeader("密钥"), true);
    return;
  }
  const dom = new JSDOM(`<!doctype html><table><thead><tr>
    <th>ID</th><th>名称</th><th>状态</th><th>密钥</th>
  </tr></thead><tbody><tr>
    <td>88</td><td>工作密钥</td><td>启用</td><td>sk-abcd**********efgh</td>
  </tr></tbody></table>`);
  const rows = core.extractNewApiRows(dom.window.document, "https://supercodes.vip/keys");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tokenId, 88);
  assert.equal(rows[0].tokenIdSource, "id");
  assert.equal(rows[0].rawName, "工作密钥");
  assert.equal(rows[0].apiKey, "");
});

test("detects English Open menu triggers as the menu adapter", () => {
  const row = {
    rowEl: {
      querySelector(selector) {
        return selectorHas(selector, 'aria-label="Open menu"') ? {} : null;
      }
    }
  };
  assert.equal(newapi.detectAdapter(emptyDoc(), [row]), "menu");
});

test("prefers React fiber token ids over untrusted numeric names", async () => {
  const origin = "https://www.achai.cc";
  const expectedKey = "sk-fiber_wins_1234567890ab";
  const row = bareRow({
    tokenId: 12,
    tokenIdSource: "name",
    rawName: "12",
    endpoint: origin,
    maskedKey: "fiber********key1",
    rowEl: {
      querySelector() { return null; },
      __reactFiber$test: {
        memoizedProps: { row: { original: { id: 9001 } } }
      }
    }
  });
  const fetchCalls = [];
  await withExtractedRows([row], async () => {
    const [result] = await newapi.collect({
      document: emptyDoc(),
      window: makeMessageWindow(),
      location: { href: `${origin}/keys`, origin },
      fetch: async url => {
        fetchCalls.push(url);
        assert.match(url, /\/api\/token\/9001\/key$/);
        return {
          ok: true,
          async json() { return { success: true, data: { key: expectedKey } }; }
        };
      },
      budgetMs: 1500
    });
    assert.equal(result.apiKey, expectedKey);
    assert.equal(result.tokenId, 9001);
    assert.equal(fetchCalls.some(url => url.includes("/api/token/?")), false);
    assert.equal(fetchCalls.some(url => /\/api\/token\/12\/key$/.test(url)), false);
  });
});

test("keeps name-derived ids that already exist in the token list", async () => {
  const origin = "https://newapi.imagic.eu.org";
  const row = bareRow({
    tokenId: 23,
    tokenIdSource: "name",
    rawName: "23",
    endpoint: origin,
    maskedKey: "sk-0L6P**********Syd9"
  });
  await withExtractedRows([row], async () => {
    const [result] = await newapi.collect({
      document: emptyDoc(),
      window: makeMessageWindow(),
      location: { href: `${origin}/console/token`, origin },
      fetch: async url => {
        if (url.includes("/api/token/?")) {
          return {
            ok: true,
            async json() {
              return {
                data: {
                  items: [{ id: 23, name: "23", key: "sk-0L6P**********Syd9" }]
                }
              };
            }
          };
        }
        assert.match(url, /\/api\/token\/23\/key$/);
        return {
          ok: true,
          async json() { return { data: { key: "kept_name_id_1234567890" } }; }
        };
      },
      budgetMs: 1500
    });
    assert.equal(result.tokenId, 23);
    assert.equal(result.apiKey, "sk-kept_name_id_1234567890");
  });
});

test("matches token list rows by masked key when names differ", async () => {
  const origin = "https://v-api.de5.net";
  const row = bareRow({
    rawName: "页面显示名",
    endpoint: origin,
    maskedKey: "maskAB********zz99"
  });
  await withExtractedRows([row], async () => {
    const [result] = await newapi.collect({
      document: emptyDoc(),
      window: makeMessageWindow(),
      location: { href: `${origin}/keys`, origin },
      fetch: async url => {
        if (url.includes("/api/token/?")) {
          return {
            ok: true,
            async json() {
              return {
                data: {
                  items: [
                    { id: 11, name: "api-name-a", key: "other********0000" },
                    { id: 22, name: "api-name-b", key: "maskAB********zz99" }
                  ]
                }
              };
            }
          };
        }
        assert.match(url, /\/api\/token\/22\/key$/);
        return {
          ok: true,
          async json() { return { data: { key: "mask_match_1234567890ab" } }; }
        };
      },
      budgetMs: 1500
    });
    assert.equal(result.tokenId, 22);
    assert.equal(result.apiKey, "sk-mask_match_1234567890ab");
  });
});

test("uses 1:1 list order only when every remaining row is unresolved", async () => {
  const origin = "https://supercodes.vip";
  const rows = [
    bareRow({
      id: "a",
      rawName: "alpha",
      endpoint: origin,
      maskedKey: "aaaa********1111"
    }),
    bareRow({
      id: "b",
      rawName: "beta",
      endpoint: origin,
      maskedKey: "bbbb********2222"
    })
  ];
  await withExtractedRows(rows, async () => {
    const results = await newapi.collect({
      document: emptyDoc(),
      window: makeMessageWindow(),
      location: { href: `${origin}/keys`, origin },
      fetch: async url => {
        if (url.includes("/api/token/?")) {
          return {
            ok: true,
            async json() {
              // Names/masks intentionally do not match page rows.
              return {
                data: {
                  items: [
                    { id: 301, name: "x", key: "xxxx********9999" },
                    { id: 302, name: "y", key: "yyyy********8888" }
                  ]
                }
              };
            }
          };
        }
        const match = url.match(/\/api\/token\/(\d+)\/key$/);
        assert.ok(match);
        return {
          ok: true,
          async json() { return { data: { key: `order_${match[1]}_1234567890` } }; }
        };
      },
      budgetMs: 2000
    });
    assert.equal(results[0].tokenId, 301);
    assert.equal(results[1].tokenId, 302);
    assert.equal(results[0].apiKey, "sk-order_301_1234567890");
    assert.equal(results[1].apiKey, "sk-order_302_1234567890");
  });
});

test("falls back to direct-copy clipboard when API key fetch fails", async () => {
  const origin = "https://supercodes.vip";
  const expectedKey = "sk-direct_fallback_1234567890";
  const win = makeMessageWindow();
  const clicks = { copy: 0 };
  const direct = makeControl("", { title: "复制到剪贴板" }, () => {
    clicks.copy += 1;
    win.copy(expectedKey);
  });
  const row = bareRow({
    tokenId: 55,
    tokenIdSource: "id",
    rawName: "55",
    endpoint: origin,
    maskedKey: "direct********key",
    keyCell: {
      querySelector(selector) {
        return selectorHas(selector, '[title="复制到剪贴板"]') ? direct : null;
      },
      querySelectorAll() { return []; }
    },
    rowEl: {
      querySelector(selector) {
        return selectorHas(selector, '[title="复制到剪贴板"]') ? direct : null;
      }
    }
  });
  await withExtractedRows([row], async () => {
    const [result] = await newapi.collect({
      document: {
        querySelector(selector) {
          return selectorHas(selector, '[title="复制到剪贴板"]') ? direct : null;
        },
        querySelectorAll() { return []; }
      },
      window: win,
      location: { href: `${origin}/keys`, origin },
      fetch: async url => {
        if (url.includes("/api/token/?")) {
          return { ok: true, async json() { return { data: { items: [] } }; } };
        }
        return { ok: false, async json() { return {}; } };
      },
      budgetMs: 1500
    });
    assert.equal(result.apiKey, expectedKey);
    assert.equal(result.adapter, "direct-copy");
    assert.equal(clicks.copy, 1);
    assert.equal(result.needsManualKey, false);
  });
});

test("falls back to reveal copy menu when API and toggle both miss", async () => {
  const origin = "https://newapi.imagic.eu.org";
  const expectedKey = "sk-reveal_fallback_1234567890";
  const win = makeMessageWindow();
  const clicks = { toggle: 0, trigger: 0, item: 0 };
  let menuOpen = false;
  const toggle = makeControl("", { "aria-label": "toggle token visibility" }, () => {
    clicks.toggle += 1;
  });
  const trigger = makeControl("", { "aria-label": "copy token key" }, () => {
    clicks.trigger += 1;
    menuOpen = true;
  });
  const item = makeControl("复制密钥", {}, () => {
    clicks.item += 1;
    win.copy(expectedKey);
  });
  const input = { value: "sk-xxx...xxxx" };
  const row = bareRow({
    tokenId: 23,
    tokenIdSource: "id",
    rawName: "23",
    endpoint: origin,
    maskedKey: "sk-xxx...xxxx",
    keyCell: {
      textContent: "sk-xxx...xxxx",
      querySelector(selector) {
        if (selectorHas(selector, '[aria-label="toggle token visibility"]')) return toggle;
        if (selectorHas(selector, '[aria-label="copy token key"]')) return trigger;
        return null;
      },
      querySelectorAll(selector) {
        return selector === "input" ? [input] : [];
      }
    },
    rowEl: {
      querySelector(selector) {
        if (selectorHas(selector, '[aria-label="toggle token visibility"]')) return toggle;
        if (selectorHas(selector, '[aria-label="copy token key"]')) return trigger;
        return null;
      }
    }
  });
  await withExtractedRows([row], async () => {
    const [result] = await newapi.collect({
      document: {
        querySelector(selector) {
          if (selectorHas(selector, '[aria-label="toggle token visibility"]')) return toggle;
          return null;
        },
        querySelectorAll() {
          return menuOpen ? [item] : [];
        }
      },
      window: win,
      location: { href: `${origin}/console/token`, origin },
      fetch: async () => ({ ok: false, async json() { return {}; } }),
      budgetMs: 1500
    });
    assert.equal(result.apiKey, expectedKey);
    assert.equal(result.adapter, "reveal");
    assert.equal(clicks.toggle, 1);
    assert.equal(clicks.trigger, 1);
    assert.equal(clicks.item, 1);
  });
});

test("returns stable collect metadata and needsManualKey on total failure", async () => {
  const origin = "https://www.achai.cc";
  const row = bareRow({
    tokenId: 0,
    rawName: "ghost",
    endpoint: origin,
    maskedKey: "ghost********key"
  });
  await withExtractedRows([row], async () => {
    const [result] = await newapi.collect({
      document: emptyDoc({
        querySelector(selector) {
          return selectorHas(selector, 'aria-label="打开菜单"') ? {} : null;
        }
      }),
      window: makeMessageWindow(),
      location: { href: `${origin}/keys#ignored`, origin },
      fetch: async () => {
        throw new Error("network down");
      },
      budgetMs: 800
    });
    assert.equal(result.apiKey, "");
    assert.equal(result.needsManualKey, true);
    assert.equal(result.endpoint, origin);
    assert.equal(result.name, `${origin}/keys`);
    assert.equal(result.source, `${origin}/keys#ignored`);
    assert.equal(result.adapter, "menu");
    assert.equal(result.tokenId, 0);
    assert.equal(result.model, "");
  });
});

test("skips key fetch for invalid token ids and still exports the row", async () => {
  const origin = "https://v-api.de5.net";
  const fetchCalls = [];
  const row = bareRow({
    tokenId: 0,
    rawName: "未匹配",
    endpoint: origin,
    maskedKey: "none********0000"
  });
  await withExtractedRows([row], async () => {
    const results = await newapi.collect({
      document: emptyDoc(),
      window: makeMessageWindow(),
      location: { href: `${origin}/keys`, origin },
      fetch: async url => {
        fetchCalls.push(url);
        if (url.includes("/api/token/?")) {
          return { ok: true, async json() { return { data: { items: [] } }; } };
        }
        throw new Error(`unexpected ${url}`);
      },
      budgetMs: 1000
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].apiKey, "");
    assert.equal(results[0].needsManualKey, true);
    assert.equal(fetchCalls.some(url => /\/api\/token\/\d+\/key$/.test(url)), false);
  });
});

test("sends cookie credentials and New-Api-User on token API calls", async () => {
  const originalStorage = global.localStorage;
  global.localStorage = {
    uid: "99",
    getItem(key) { return this[key] ?? null; }
  };
  try {
    let seen = null;
    await core.fetchNewApiTokenKey("https://www.achai.cc", 7, async (url, options) => {
      seen = { url, options };
      return {
        ok: true,
        async json() { return { data: { key: "auth_header_1234567890ab" } }; }
      };
    });
    assert.equal(seen.url, "https://www.achai.cc/api/token/7/key");
    assert.equal(seen.options.method, "POST");
    assert.equal(seen.options.credentials, "include");
    assert.equal(seen.options.headers["New-Api-User"], "99");
    assert.equal(seen.options.headers["Content-Type"], "application/json");
    assert.equal(seen.options.headers.Authorization, undefined);
  } finally {
    if (originalStorage === undefined) delete global.localStorage;
    else global.localStorage = originalStorage;
  }
});

test("attaches bearer only from known auth objects with token fields", () => {
  const originalStorage = global.localStorage;
  global.localStorage = {
    session: JSON.stringify({ user: { id: 5, token: "session-token-abc" } }),
    getItem(key) { return this[key] ?? null; }
  };
  try {
    assert.deepEqual(core.readNewApiAuthHeaders(), {
      "Content-Type": "application/json",
      "New-Api-User": "5",
      Authorization: "Bearer session-token-abc"
    });
  } finally {
    if (originalStorage === undefined) delete global.localStorage;
    else global.localStorage = originalStorage;
  }
});

test("does not click DOM copy controls when API already filled the key", async () => {
  const origin = "https://supercodes.vip";
  const win = makeMessageWindow();
  const clicks = { copy: 0 };
  const direct = makeControl("", { title: "复制到剪贴板" }, () => {
    clicks.copy += 1;
    win.copy("sk-should_not_use_1234567890");
  });
  const row = bareRow({
    tokenId: 44,
    tokenIdSource: "id",
    rawName: "44",
    endpoint: origin,
    keyCell: {
      querySelector(selector) {
        return selectorHas(selector, '[title="复制到剪贴板"]') ? direct : null;
      },
      querySelectorAll() { return []; }
    },
    rowEl: {
      querySelector(selector) {
        return selectorHas(selector, '[title="复制到剪贴板"]') ? direct : null;
      }
    }
  });
  await withExtractedRows([row], async () => {
    const [result] = await newapi.collect({
      document: {
        querySelector(selector) {
          return selectorHas(selector, '[title="复制到剪贴板"]') ? direct : null;
        },
        querySelectorAll() { return []; }
      },
      window: win,
      location: { href: `${origin}/keys`, origin },
      fetch: async url => {
        assert.match(url, /\/api\/token\/44\/key$/);
        return {
          ok: true,
          async json() { return { data: { key: "api_already_ok_1234567890" } }; }
        };
      },
      budgetMs: 1200
    });
    assert.equal(result.apiKey, "sk-api_already_ok_1234567890");
    assert.equal(clicks.copy, 0);
  });
});

test("collect returns an empty list when the page has no token rows", async () => {
  const results = await newapi.collect({
    document: emptyDoc(),
    window: makeMessageWindow(),
    location: {
      href: "https://www.achai.cc/keys",
      origin: "https://www.achai.cc"
    },
    fetch: async () => {
      throw new Error("should not fetch without rows");
    },
    budgetMs: 500
  });
  assert.deepEqual(results, []);
});

test("trusted id-column token ids are used without requiring list rebinding", async () => {
  const origin = "https://supercodes.vip";
  const row = bareRow({
    tokenId: 777,
    tokenIdSource: "id",
    rawName: "生产",
    endpoint: origin,
    maskedKey: "prod********key"
  });
  const fetchCalls = [];
  await withExtractedRows([row], async () => {
    const [result] = await newapi.collect({
      document: emptyDoc(),
      window: makeMessageWindow(),
      location: { href: `${origin}/keys`, origin },
      fetch: async url => {
        fetchCalls.push(url);
        assert.match(url, /\/api\/token\/777\/key$/);
        return {
          ok: true,
          async json() { return { data: { apiKey: "trusted_id_1234567890ab" } }; }
        };
      },
      budgetMs: 1000
    });
    assert.equal(result.apiKey, "sk-trusted_id_1234567890ab");
    assert.equal(result.tokenId, 777);
    assert.equal(fetchCalls.some(url => url.includes("/api/token/?")), false);
  });
});
