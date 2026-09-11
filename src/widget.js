(function attachOpenKeyWidget(root) {
  "use strict";

  const CORE = root.OpenKeyCore;
  const TOKENS = root.OpenKeyTokens;
  if (!TOKENS)
    throw new Error("OpenKey: src/tokens.js must load before src/widget.js");
  const widgets = new Map();
  const WIDGET_STYLE = `
    :host { all: initial; ${TOKENS.declarations} font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    :host(.anchored) { position: relative; display: block; width: auto; margin: var(--ok-space-sm) 0 0; z-index: 2147483645; }
    * { box-sizing: border-box; }
    button, input, select, textarea { font: inherit; }
    .action { border: 0; border-radius: var(--ok-radius-md); padding: var(--ok-space-sm) var(--ok-space-md); color: #fff; background: #2563eb; cursor: pointer; font-size: 13px; line-height: 1.2; box-shadow: 0 1px 2px rgba(15,23,42,.14); }
    .action:hover { background: #1d4ed8; }
    .action:disabled { opacity: .6; cursor: wait; }
    .panel-backdrop { position: fixed; inset: 0; z-index: 2147483646; background: rgba(15,23,42,.36); display: grid; place-items: center; padding: var(--ok-space-xl); }
    .panel-backdrop[hidden] { display: none; }
    :host(.anchored) .panel-backdrop { position: absolute; inset: auto; top: calc(100% + var(--ok-space-sm)); left: 0; width: min(460px, calc(100vw - 32px)); display: block; padding: 0; background: transparent; }
    :host(.anchored) .panel-backdrop[hidden] { display: none; }
    :host(.anchored) .panel { width: 100%; max-height: min(680px, calc(100vh - 180px)); border-radius: var(--ok-radius-xl); }
    .panel { width: min(720px, calc(100vw - 40px)); max-height: min(760px, calc(100vh - 40px)); display: flex; flex-direction: column; overflow: hidden; background: #fff; color: #0f172a; border: 1px solid #dbe3ef; border-radius: var(--ok-radius-xl); box-shadow: 0 24px 80px rgba(15,23,42,.28); }
    .panel-head { display: flex; align-items: center; justify-content: space-between; gap: var(--ok-space-md); flex: 0 0 auto; padding: var(--ok-space-lg) var(--ok-space-xl); border-bottom: 1px solid #e5e7eb; background: #fff; }
    .panel-head h2 { margin: 0; font-size: 17px; }
    .close { border: 0; background: transparent; color: #64748b; cursor: pointer; font-size: 20px; padding: 0 var(--ok-space-xs); }
    .panel-body { flex: 1 1 auto; overflow: auto; padding: var(--ok-space-lg) var(--ok-space-xl); font-size: 14px; line-height: 1.6; }
    .panel-foot { display: flex; justify-content: flex-end; gap: var(--ok-space-sm); flex: 0 0 auto; padding: var(--ok-space-lg) var(--ok-space-xl); border-top: 1px solid #e5e7eb; background: #fff; }
    .select-bar { display: flex; align-items: center; justify-content: space-between; gap: var(--ok-space-md); margin-bottom: var(--ok-space-md); font-size: 12px; }
    .select-actions { display: flex; gap: var(--ok-space-xs); }
    .link { border: 0; background: transparent; color: #2563eb; cursor: pointer; padding: var(--ok-space-xs) var(--ok-space-sm); border-radius: var(--ok-radius-sm); font-size: 12px; }
    .link:hover { background: #eff6ff; }
    .secondary { border: 1px solid #cbd5e1; border-radius: var(--ok-radius-md); padding: var(--ok-space-sm) var(--ok-space-md); color: #334155; background: #fff; cursor: pointer; }
    .primary { border: 0; border-radius: var(--ok-radius-md); padding: var(--ok-space-sm) var(--ok-space-md); color: #fff; background: #2563eb; cursor: pointer; }
    .danger { color: #b91c1c; }
    .muted { color: #64748b; }
    .notice { border-radius: var(--ok-radius-lg); background: #eff6ff; color: #1e40af; padding: var(--ok-space-sm) var(--ok-space-md); margin-bottom: var(--ok-space-md); line-height: 1.5; }
    .warning { border-radius: var(--ok-radius-lg); background: #fff7ed; color: #9a3412; padding: var(--ok-space-sm) var(--ok-space-md); margin-bottom: var(--ok-space-md); line-height: 1.5; }
    .item { border: 1px solid #e2e8f0; border-radius: var(--ok-radius-lg); padding: var(--ok-space-md); margin: var(--ok-space-md) 0; }
    .item:first-child { margin-top: 0; }
    .item:last-child { margin-bottom: 0; }
    .item-top { display: flex; gap: var(--ok-space-sm); align-items: flex-start; }
    .item-top input[type=checkbox] { margin-top: var(--ok-space-xs); }
    .item-title { font-weight: 600; }
    .item-meta { color: #64748b; font-size: 12px; margin-top: var(--ok-space-xs); word-break: break-word; }
    .field { display: grid; gap: var(--ok-space-xs); margin-top: var(--ok-space-md); }
    .check { display: flex; align-items: center; gap: var(--ok-space-sm); margin-top: var(--ok-space-sm); color: #475569; font-size: 12px; }
    .field label { font-size: 12px; color: #475569; }
    .field input, .field select, .field textarea { width: 100%; border: 1px solid #cbd5e1; border-radius: var(--ok-radius-md); padding: var(--ok-space-sm) var(--ok-space-md); color: #0f172a; background: #fff; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--ok-space-md); }
    .key-row { display: flex; align-items: flex-start; gap: var(--ok-space-sm); margin: var(--ok-space-md) 0; padding: var(--ok-space-md); border: 1px solid #e2e8f0; border-radius: var(--ok-radius-lg); background: #f8fafc; }
    .key-text { flex: 1; min-width: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5; color: #0f172a; word-break: break-all; white-space: pre-wrap; }
    .copy-key { flex: 0 0 auto; border: 1px solid #cbd5e1; border-radius: var(--ok-radius-md); padding: var(--ok-space-sm) var(--ok-space-md); color: #334155; background: #fff; cursor: pointer; font-size: 12px; }
    .copy-key:hover { background: #f1f5f9; }
    .copy-key[data-copied="1"] { color: #166534; border-color: #86efac; background: #f0fdf4; }
    @media (max-width: 560px) { .grid { grid-template-columns: 1fr; } }
  `;

  function create(id, label, anchor, options = {}) {
    const existing = widgets.get(id);
    if (existing) return existing;
    document.getElementById(id)?.remove();
    const host = document.createElement("span");
    host.id = id;
    host.style.display = "inline-block";
    host.style.verticalAlign = "middle";
    host.style.marginLeft = TOKENS.px(TOKENS.space.sm);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${WIDGET_STYLE}</style><button class="action" type="button">${label}</button><div class="panel-backdrop" hidden><section class="panel" role="dialog" aria-modal="true"><header class="panel-head"><h2></h2><button class="close" type="button" aria-label="关闭">×</button></header><div class="panel-body"></div><footer class="panel-foot"></footer></section></div>`;
    const widget = {
      host,
      shadow,
      action: shadow.querySelector(".action"),
      backdrop: shadow.querySelector(".panel-backdrop"),
      title: shadow.querySelector(".panel-head h2"),
      body: shadow.querySelector(".panel-body"),
      foot: shadow.querySelector(".panel-foot"),
      open(title, html, actions = []) {
        widget.title.textContent = title;
        widget.body.innerHTML = html;
        widget.foot.innerHTML = "";
        for (const action of actions) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = action.primary ? "primary" : "secondary";
          button.textContent = action.label;
          button.addEventListener("click", () => action.onClick?.(button));
          widget.foot.appendChild(button);
        }
        widget.backdrop.hidden = false;
      },
      close() {
        widget.backdrop.hidden = true;
      },
      setBusy(value) {
        widget.action.disabled = Boolean(value);
      },
      mount(anchor, mountOptions = {}) {
        const isAnchored = mountOptions.placement === "below-anchor";
        const mountParent = isAnchored
          ? anchor?.matches?.(".topic-avatar")
            ? anchor
            : anchor?.closest?.(".topic-avatar") || anchor?.parentElement
          : anchor?.parentElement;
        const placement = mountParent
          ? isAnchored
            ? "below-anchor"
            : "inline-after"
          : "fallback";
        const targetParent = mountParent || document.documentElement;
        if (
          !CORE.needsWidgetRemount(
            host.parentElement,
            targetParent,
            host.dataset.openkeyPlacement,
            placement
          )
        )
          return true;
        host.classList.toggle("anchored", placement === "below-anchor");
        host.style.position =
          host.style.right =
          host.style.bottom =
          host.style.zIndex =
          host.style.width =
          host.style.margin =
            "";
        if (placement === "below-anchor") {
          targetParent.appendChild(host);
          host.style.display = "block";
          host.style.margin = `${TOKENS.px(TOKENS.space.sm)} 0 0`;
        } else if (placement === "inline-after") {
          targetParent.insertBefore(host, anchor.nextSibling);
          host.style.display = "inline-block";
          host.style.verticalAlign = "middle";
          host.style.marginLeft = TOKENS.px(TOKENS.space.sm);
        } else {
          host.classList.remove("anchored");
          host.style.position = "fixed";
          host.style.right = TOKENS.px(TOKENS.space.xl);
          host.style.bottom = TOKENS.px(TOKENS.space.xl);
          host.style.zIndex = "2147483645";
          host.style.display = "inline-block";
          targetParent.appendChild(host);
        }
        host.dataset.openkeyPlacement = placement;
        return placement !== "fallback";
      },
    };
    shadow
      .querySelector(".close")
      .addEventListener("click", () => widget.close());
    widget.action.addEventListener("click", () => widget.onAction?.());
    widget.mount(anchor, options);
    host.__openKeyWidget = widget;
    widgets.set(id, widget);
    return widget;
  }

  root.OpenKeyWidget = { create };
})(typeof globalThis !== "undefined" ? globalThis : this);
