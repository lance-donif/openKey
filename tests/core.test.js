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
