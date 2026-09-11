const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const tokens = require("../src/tokens.js");

test("tokens expose the single-source 4px spacing/radius ladder", () => {
  assert.deepEqual(tokens.space, { xs: 4, sm: 8, md: 12, lg: 16, xl: 20 });
  assert.deepEqual(tokens.radius, { sm: 4, md: 8, lg: 12, xl: 16 });
  // 同心圆阶梯：相邻两档差 4，容器 16/12、控件 8/6 自然满足内 = 外 − 间距。
  for (const scale of [tokens.space, tokens.radius]) {
    const steps = Object.values(scale);
    for (let index = 1; index < steps.length; index += 1)
      assert.equal(steps[index] - steps[index - 1], 4);
  }
  assert.equal(tokens.px(tokens.space.sm), "8px");
  for (const [name, value] of Object.entries(tokens.variables))
    assert.match(tokens.declarations, new RegExp(`${name}: ${value};`));
});

test("tokens applyTo sets variables and rejects bad targets", () => {
  const applied = {};
  const target = {
    style: { setProperty: (name, value) => (applied[name] = value) },
  };
  assert.equal(tokens.applyTo(target), true);
  assert.deepEqual(applied, tokens.variables);
  assert.equal(tokens.applyTo(null), false);
  assert.equal(tokens.applyTo({}), false);
});

const CHECKED_PROPS =
  "(?:border-radius|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|gap)";

function spacingDeclarations(source) {
  // 只认 CSS 声明位的写法（; { } 或行首开头），不误伤 JS 对象。
  const pattern = new RegExp(
    `(?:^|[;{}])\\s*${CHECKED_PROPS}\\s*:\\s*([^;{}]+);`,
    "g"
  );
  const found = [];
  let match = pattern.exec(source);
  while (match) {
    found.push(match[1].trim());
    match = pattern.exec(source);
  }
  return found;
}

function referencedTokenNames(source) {
  return [...source.matchAll(/var\((--ok-[a-z-]+)\)/g)].map((item) => item[1]);
}

test("widget and popup styles use tokens, never hardcoded px spacing", () => {
  for (const file of ["../src/widget.js", "../src/popup.css"]) {
    const source = fs.readFileSync(require.resolve(file), "utf8");
    const violations = spacingDeclarations(source).filter((value) =>
      /\d+px/.test(value)
    );
    assert.deepEqual(violations, [], `${file} must not hardcode px spacing`);
    for (const name of referencedTokenNames(source))
      assert.ok(name in tokens.variables, `${file} uses unknown ${name}`);
  }
});

test("no JS inline style assigns hardcoded px spacing", () => {
  for (const file of [
    "../src/widget.js",
    "../src/content.js",
    "../src/popup.js",
  ]) {
    const source = fs.readFileSync(require.resolve(file), "utf8");
    assert.doesNotMatch(
      source,
      /\.style\.[A-Za-z]+\s*=\s*["'`][^"'`]*\d+px/,
      `${file} must set inline spacing via OpenKeyTokens`
    );
    assert.doesNotMatch(
      source,
      /style\s*=\s*["'][^"']*\d+px/,
      `${file} must not embed px spacing in style attributes`
    );
  }
});

test("tokens load before every UI consumer", () => {
  const manifest = JSON.parse(
    fs.readFileSync(require.resolve("../manifest.json"), "utf8")
  );
  const pageScripts = manifest.content_scripts.find((entry) =>
    (entry.js || []).includes("src/content.js")
  ).js;
  assert.equal(pageScripts[0], "src/tokens.js");
  const popupHtml = fs.readFileSync(
    require.resolve("../src/popup.html"),
    "utf8"
  );
  assert.ok(
    popupHtml.indexOf('src="tokens.js"') !== -1 &&
      popupHtml.indexOf('src="tokens.js"') <
        popupHtml.indexOf('src="popup.js"'),
    "popup.html must load tokens.js before popup.js"
  );
  const popupJs = fs.readFileSync(require.resolve("../src/popup.js"), "utf8");
  assert.match(popupJs, /OpenKeyTokens/);
});
