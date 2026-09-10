(function attachOpenKeyWidget(root) {
  "use strict";

  const CORE = root.OpenKeyCore;
  const widgets = new Map();
  const WIDGET_STYLE = `
    :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    :host(.anchored) { position: relative; display: block; width: auto; margin: 8px 0 0; z-index: 2147483645; }
    * { box-sizing: border-box; }
    button, input, select, textarea { font: inherit; }
    .action { border: 0; border-radius: 8px; padding: 8px 12px; color: #fff; background: #2563eb; cursor: pointer; font-size: 13px; line-height: 1.2; box-shadow: 0 1px 2px rgba(15,23,42,.14); }
    .action:hover { background: #1d4ed8; }
    .action:disabled { opacity: .6; cursor: wait; }
    .panel-backdrop { position: fixed; inset: 0; z-index: 2147483646; background: rgba(15,23,42,.36); display: grid; place-items: center; padding: 20px; }
    .panel-backdrop[hidden] { display: none; }
    :host(.anchored) .panel-backdrop { position: absolute; inset: auto; top: calc(100% + 8px); left: 0; width: min(460px, calc(100vw - 32px)); display: block; padding: 0; background: transparent; }
    :host(.anchored) .panel-backdrop[hidden] { display: none; }
    :host(.anchored) .panel { width: 100%; max-height: min(680px, calc(100vh - 180px)); border-radius: 8px; }
    .panel { width: min(720px, calc(100vw - 40px)); max-height: min(760px, calc(100vh - 40px)); overflow: auto; background: #fff; color: #0f172a; border: 1px solid #dbe3ef; border-radius: 16px; box-shadow: 0 24px 80px rgba(15,23,42,.28); }
    .panel-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px 14px; border-bottom: 1px solid #e5e7eb; }
    .panel-head h2 { margin: 0; font-size: 17px; }
    .close { border: 0; background: transparent; color: #64748b; cursor: pointer; font-size: 20px; padding: 0 4px; }
    .panel-body { padding: 18px 20px; font-size: 14px; }
    .panel-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px 18px; border-top: 1px solid #e5e7eb; }
    .secondary { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 12px; color: #334155; background: #fff; cursor: pointer; }
    .primary { border: 0; border-radius: 8px; padding: 8px 12px; color: #fff; background: #2563eb; cursor: pointer; }
    .danger { color: #b91c1c; }
    .muted { color: #64748b; }
    .notice { border-radius: 10px; background: #eff6ff; color: #1e40af; padding: 10px 12px; margin-bottom: 12px; line-height: 1.5; }
    .warning { border-radius: 10px; background: #fff7ed; color: #9a3412; padding: 10px 12px; margin-bottom: 12px; line-height: 1.5; }
    .item { border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; margin: 10px 0; }
    .item-top { display: flex; gap: 10px; align-items: flex-start; }
    .item-top input[type=checkbox] { margin-top: 3px; }
    .item-title { font-weight: 600; }
    .item-meta { color: #64748b; font-size: 12px; margin-top: 5px; word-break: break-word; }
    .field { display: grid; gap: 5px; margin-top: 12px; }
    .check { display: flex; align-items: center; gap: 6px; margin-top: 8px; color: #475569; font-size: 12px; }
    .field label { font-size: 12px; color: #475569; }
    .field input, .field select, .field textarea { width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; color: #0f172a; background: #fff; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .key-row { display: flex; align-items: flex-start; gap: 8px; margin: 10px 0; padding: 12px; border: 1px solid #e2e8f0; border-radius: 12px; background: #f8fafc; }
    .key-text { flex: 1; min-width: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5; color: #0f172a; word-break: break-all; white-space: pre-wrap; }
    .copy-key { flex: 0 0 auto; border: 1px solid #cbd5e1; border-radius: 8px; padding: 6px 10px; color: #334155; background: #fff; cursor: pointer; font-size: 12px; }
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
    host.style.marginLeft = "8px";
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
          host.style.margin = "8px 0 0";
        } else if (placement === "inline-after") {
          targetParent.insertBefore(host, anchor.nextSibling);
          host.style.display = "inline-block";
          host.style.verticalAlign = "middle";
          host.style.marginLeft = "8px";
        } else {
          host.classList.remove("anchored");
          host.style.position = "fixed";
          host.style.right = "20px";
          host.style.bottom = "20px";
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
