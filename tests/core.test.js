const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");

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
    name: "Gateway GPT",
    endpoint: "https://gateway.example.com/v1",
    apiKey: "sk-direct_1234567890"
  }, 2), {
    name: "Gateway GPT",
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
    name: "Welfare Key",
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
  const fetchImpl = async () => ({
    ok: true,
    async json() { return { success: true, data: { key: "rawkey_1234567890abcd" } }; }
  });
  const key = await core.fetchNewApiTokenKey("https://newapi.imagic.eu.org", 23, fetchImpl);
  assert.equal(key, "sk-rawkey_1234567890abcd");
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
