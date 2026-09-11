(function attachOpenKeyTokens(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.OpenKeyTokens = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function createOpenKeyTokens() {
    "use strict";

    // 单源间距/圆角体系：4px 阶梯。新增取值必须先落到这两套阶梯里，
    // 再经由 CSS 变量 (--ok-*) 或 TOKENS.px() 使用，禁止在样式里写字面量。
    // 同心圆规则：小间距嵌套时 内层圆角 = 外层圆角 − 间距；
    // 本体系嵌套间距统一 >= 12px（容器级差 4），曲线互不干扰，
    // 因此容器取 16/12、控件取 8、微元素取 4 即可自然满足同心圆效果。
    const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20 };
    const radius = { sm: 4, md: 8, lg: 12, xl: 16 };

    const variables = {
      "--ok-space-xs": "4px",
      "--ok-space-sm": "8px",
      "--ok-space-md": "12px",
      "--ok-space-lg": "16px",
      "--ok-space-xl": "20px",
      "--ok-radius-sm": "4px",
      "--ok-radius-md": "8px",
      "--ok-radius-lg": "12px",
      "--ok-radius-xl": "16px",
    };

    const declarations = Object.entries(variables)
      .map(([name, value]) => `${name}: ${value};`)
      .join(" ");

    function px(value) {
      return `${value}px`;
    }

    function applyTo(target) {
      if (
        !target ||
        !target.style ||
        typeof target.style.setProperty !== "function"
      )
        return false;
      for (const [name, value] of Object.entries(variables))
        target.style.setProperty(name, value);
      return true;
    }

    return { space, radius, variables, declarations, px, applyTo };
  }
);
