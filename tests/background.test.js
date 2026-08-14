const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadBackground({ tabs = {}, storage = {} } = {}) {
  const listeners = [];
  const data = { ...storage };
  const storageArea = {
    async get(key) {
      if (key && typeof key === "object") return { ...key, ...data };
      return { [key]: data[key] };
    },
    async set(values) {
      Object.assign(data, values);
    },
    async remove(key) {
      delete data[key];
    },
  };
  const chrome = {
    storage: { local: storageArea, session: storageArea },
    tabs: {
      async query(...args) {
        return tabs.query ? tabs.query(...args) : [];
      },
      async update(...args) {
        return tabs.update?.(...args);
      },
      async create(...args) {
        return tabs.create ? tabs.create(...args) : { id: 7 };
      },
      async sendMessage(...args) {
        return tabs.sendMessage?.(...args);
      },
    },
    runtime: {
      onMessage: {
        addListener(listener) {
          listeners.push(listener);
        },
      },
    },
  };
  vm.runInNewContext(fs.readFileSync("src/background.js", "utf8"), {
    chrome,
    URL,
    Date,
    Math,
    String,
    Number,
    Boolean,
    Promise,
    console,
  });
  return {
    data,
    async send(message) {
      const listener = listeners[0];
      let response;
      const result = listener(message, {}, (value) => {
        response = value;
      });
      assert.equal(result, true);
      for (let index = 0; index < 20 && !response; index += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      return response;
    },
  };
}

test("removes a pending import when opening Sub2API fails", async () => {
  const app = loadBackground({
    tabs: {
      async create() {
        throw new Error("tab creation failed");
      },
    },
  });
  const result = await app.send({
    type: "SAVE_SUB2API_IMPORT",
    configs: [
      { endpoint: "https://api.example.com", apiKey: "sk-test_1234567890" },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "tab creation failed");
  assert.equal(app.data.openKeyPendingImport, undefined);
});

test("restores the previous pending import when opening a replacement fails", async () => {
  const previous = {
    taskId: "previous",
    createdAt: 10,
    configs: [{ id: "keep" }],
  };
  const app = loadBackground({
    tabs: {
      async create() {
        throw new Error("tab creation failed");
      },
    },
    storage: { openKeyPendingImport: previous },
  });
  const result = await app.send({
    type: "SAVE_SUB2API_IMPORT",
    configs: [{ id: "replacement" }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "tab creation failed");
  assert.equal(app.data.openKeyPendingImport.taskId, "previous");
  assert.deepEqual(app.data.openKeyPendingImport.configs, [{ id: "keep" }]);
});

test("rejects stale pending import updates from another task", async () => {
  const app = loadBackground({
    storage: {
      openKeyPendingImport: {
        taskId: "new-task",
        createdAt: 20,
        configs: [{ id: "new" }],
      },
    },
  });
  const result = await app.send({
    type: "UPDATE_PENDING_IMPORT",
    taskId: "old-task",
    createdAt: 10,
    configs: [{ id: "old" }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "待导入任务已被其他页面更新");
  assert.deepEqual(app.data.openKeyPendingImport.configs, [{ id: "new" }]);
});

test("preserves the task creation time across progress updates", async () => {
  const app = loadBackground({
    storage: {
      openKeyPendingImport: {
        taskId: "task-1",
        createdAt: 123,
        configs: [{ id: "one" }],
      },
    },
  });
  const result = await app.send({
    type: "UPDATE_PENDING_IMPORT",
    taskId: "task-1",
    createdAt: 123,
    configs: [{ id: "remaining" }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.taskId, "task-1");
  assert.equal(result.createdAt, 123);
  assert.equal(app.data.openKeyPendingImport.createdAt, 123);
});

test("strips query and hash from the Sub2API tab match pattern", async () => {
  let queryInfo;
  let created;
  const app = loadBackground({
    storage: {
      sub2apiUrl: "http://sub2api.local/admin/accounts?team=1#main",
    },
    tabs: {
      async query(info) {
        queryInfo = info;
        return [];
      },
      async create(info) {
        created = info;
        return { id: 7 };
      },
    },
  });
  const result = await app.send({ type: "SAVE_SUB2API_IMPORT", configs: [] });
  assert.equal(result.ok, true);
  assert.deepEqual(
    [...queryInfo.url],
    [
      "http://sub2api.local/admin/accounts",
      "http://sub2api.local/admin/accounts*",
    ]
  );
  assert.equal(created.url, "http://sub2api.local/admin/accounts?team=1#main");
});

test("focuses an existing Sub2API tab without reloading an active import", async () => {
  const updates = [];
  const messages = [];
  const app = loadBackground({
    tabs: {
      async query() {
        return [{ id: 42 }];
      },
      async update(...args) {
        updates.push(args);
      },
      async sendMessage(...args) {
        messages.push(args);
      },
    },
  });
  const result = await app.send({ type: "SAVE_SUB2API_IMPORT", configs: [] });
  assert.equal(result.ok, true);
  assert.equal(updates.length, 1);
  assert.equal(updates[0][0], 42);
  assert.equal(updates[0][1].active, true);
  assert.equal("url" in updates[0][1], false);
  assert.equal(messages.length, 1);
  assert.equal(messages[0][0], 42);
  assert.equal(messages[0][1].type, "PENDING_IMPORT_READY");
});
