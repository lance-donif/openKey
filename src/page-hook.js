(() => {
  if (window.__openKeyClipboardHookInstalled) return;
  window.__openKeyClipboardHookInstalled = true;
  const CHANNEL = "openkey-clipboard-v1";
  let token = "";
  const restores = [];

  const mark = (name, value) => {
    try {
      document.documentElement?.setAttribute(`data-openkey-${name}`, value);
    } catch (_error) {}
  };
  mark("hook", "ready");
  document.addEventListener("DOMContentLoaded", () => mark("hook", "ready"), {
    once: true,
  });

  const emit = (value) => {
    if (!token) return;
    mark("hook-last", "captured");
    try {
      window.postMessage(
        {
          channel: CHANNEL,
          type: "clipboard",
          token,
          text: String(value || ""),
        },
        "*"
      );
    } catch (_error) {}
  };
  const selectedText = () => {
    const active = document.activeElement;
    if (
      active &&
      typeof active.value === "string" &&
      Number.isInteger(active.selectionStart) &&
      Number.isInteger(active.selectionEnd)
    ) {
      return active.value.slice(active.selectionStart, active.selectionEnd);
    }
    return String(window.getSelection?.() || "");
  };
  const onCopy = (event) => {
    const copied =
      event.clipboardData?.getData?.("text/plain") || selectedText();
    if (copied) emit(copied);
    queueMicrotask(() => {
      const deferred = event.clipboardData?.getData?.("text/plain");
      if (deferred) emit(deferred);
    });
  };
  const patch = (target, name, wrap) => {
    const original = target?.[name];
    if (typeof original !== "function") return null;
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    try {
      const replacement = wrap(original);
      Object.defineProperty(target, name, {
        configurable: true,
        writable: true,
        value: replacement,
      });
      if (target[name] === replacement) {
        return () => {
          if (target[name] !== replacement) return;
          try {
            if (descriptor) Object.defineProperty(target, name, descriptor);
            else delete target[name];
          } catch (_error) {}
        };
      }
    } catch (_error) {}
    return null;
  };
  const emitClipboardItems = (items) => {
    for (const item of items || []) {
      if (!item?.types?.includes?.("text/plain")) continue;
      Promise.resolve(item.getType("text/plain"))
        .then((blob) => blob.text())
        .then(emit)
        .catch(() => {});
    }
  };
  const install = () => {
    const clipboard = navigator.clipboard;
    const clipboardPrototype = clipboard && Object.getPrototypeOf(clipboard);
    const add = (restore) => {
      if (restore) restores.push(restore);
      return Number(Boolean(restore));
    };
    const patchWriteText = (target) =>
      patch(
        target,
        "writeText",
        (original) =>
          function openKeyWriteText(value) {
            emit(value);
            return original.call(clipboard, value);
          }
      );
    const patchWrite = (target) =>
      patch(
        target,
        "write",
        (original) =>
          function openKeyWrite(items) {
            emitClipboardItems(items);
            return original.call(clipboard, items);
          }
      );
    const writeTextPatched = add(
      patchWriteText(clipboard) || patchWriteText(clipboardPrototype)
    );
    const writePatched = add(
      patchWrite(clipboard) || patchWrite(clipboardPrototype)
    );
    const setDataPatched = add(
      patch(
        globalThis.DataTransfer?.prototype,
        "setData",
        (original) =>
          function openKeySetData(type, value) {
            if (/^text(?:\/plain)?$/i.test(String(type))) emit(value);
            return original.call(this, type, value);
          }
      )
    );
    const execPatched = add(
      patch(
        globalThis.Document?.prototype,
        "execCommand",
        (original) =>
          function openKeyExecCommand(command, ...args) {
            const result = original.call(this, command, ...args);
            if (String(command).toLowerCase() === "copy") {
              const copied = selectedText();
              if (copied) emit(copied);
            }
            return result;
          }
      )
    );
    mark(
      "hook-patches",
      `writeText:${writeTextPatched},write:${writePatched},setData:${setDataPatched},exec:${execPatched}`
    );
  };

  const disarm = (expected) => {
    if (expected && expected !== token) return;
    token = "";
    document.removeEventListener("copy", onCopy, true);
    while (restores.length) restores.pop()();
    mark("hook-patches", "inactive");
  };

  window.addEventListener("message", (event) => {
    if (event.data?.channel !== CHANNEL) return;
    if (event.data.type === "disarm") {
      disarm(String(event.data.token || ""));
      return;
    }
    if (event.data.type !== "arm") return;
    disarm();
    token = String(event.data.token || "");
    mark("hook-last", "armed");
    install();
    document.addEventListener("copy", onCopy, true);
    window.postMessage({ channel: CHANNEL, type: "armed", token }, "*");
  });
})();
