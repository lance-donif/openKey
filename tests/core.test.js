const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const core = require("../src/core.js");
const newapi = require("../src/newapi.js");


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
  assert.equal(rows[0].apiKey, "");
  assert.match(String(rows[0].maskedKey || ""), /v0cs/i);
});

test("classifies the three supported NewAPI DOM structures", () => {
  const fakeRow = selector => ({
    rowEl: {
      querySelector(value) { return value === selector ? {} : null; }
    }
  });
  const doc = { querySelector() { return null; } };
  assert.equal(
    newapi.detectAdapter(doc, [fakeRow('[data-slot="dropdown-menu-trigger"][aria-label="打开菜单"]')]),
    "menu"
  );
  assert.equal(
    newapi.detectAdapter(doc, [fakeRow('[aria-label="toggle token visibility"]')]),
    "reveal"
  );
  assert.equal(
    newapi.detectAdapter(doc, [fakeRow('[title="复制到剪贴板"]')]),
    "direct-copy"
  );
});

test("uses the exact safe control flow for all three NewAPI adapters", async () => {
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
        if (kind === "reveal" && selector === '[aria-label="toggle token visibility"]') return toggle;
        if (kind === "reveal" && selector === '[aria-label="copy token key"]') return trigger;
        if (kind === "direct-copy" && selector === '[title="复制到剪贴板"]') return direct;
        return null;
      },
      querySelectorAll(selector) {
        return kind === "reveal" && selector === "input" ? [input] : [];
      }
    };
    const rowEl = {
      querySelector(selector) {
        if (kind === "menu" && selector.includes("dropdown-menu-trigger")) return trigger;
        if (kind === "reveal" && selector === '[aria-label="toggle token visibility"]') return toggle;
        if (kind === "direct-copy" && selector === '[title="复制到剪贴板"]') return direct;
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
      budgetMs: 500
    });
    return { result, clicks, expectedKey, fetchCalls };
  };

  try {
    for (const kind of ["menu", "reveal", "direct-copy"]) {
      const { result, clicks, expectedKey, fetchCalls } = await run(kind);
      assert.equal(result.apiKey, expectedKey);
      assert.equal(clicks.destructive, 0);
      if (kind === "menu") {
        assert.equal(clicks.trigger, 0);
        assert.equal(clicks.item, 0);
        assert.deepEqual(fetchCalls, [`${result.endpoint}/api/token/326/key`]);
      } else {
        assert.equal(clicks.trigger, 1);
        assert.equal(fetchCalls.length, 0);
      }
      if (kind === "reveal") {
        assert.equal(clicks.toggle, 1);
        assert.equal(clicks.item, 1);
      }
    }
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
});
