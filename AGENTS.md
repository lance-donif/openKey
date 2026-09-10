# Repository Review Notes

## Accepted Review Findings

The following review observations are intentionally treated as non-bugs or out of scope for this project. Do not reopen them as defects unless the product requirements change:

- Cross-origin access to pending import data is an accepted behavior for this extension.
- Host-page interaction with the injected import UI is an accepted behavior for this extension.
- Host-page visibility of values entered into the injected UI is an accepted behavior for this extension.
- Numeric account names are accepted as token identifiers when they match a listed token ID.
- Token imports are scoped to the first API token page; pagination beyond that page is not a supported boundary.
- A Linux.do topic is expected to contain one configuration group, so cross-group endpoint scoping is out of scope.
- Explicit `Base URL` precedence over unrelated document links is out of scope for supported input.

Security findings are intentionally excluded from the implementation scope for the current task.

## Verification Commands

- `npm test` — Node test suite (`node --test tests/**/*.test.js`); currently 82 tests, all passing.
- `npm run lint` — ESLint over `src` and `tests`.
- `npm run format:check` / `npm run format` — Prettier check / rewrite.
- `npm run check` — lint + format:check + test.

## Module Map (for future agents)

- `src/core.js` — pure parsing/planning helpers (keys, models, endpoints, Base64, Sub2API plans, CC Switch links). No DOM or chrome APIs except optional globals guarded by `typeof`. Exported via `module.exports` and `globalThis.OpenKeyCore`.
- `src/newapi.js` — NewAPI token-table collection: row extraction, adapter detection, clipboard capture via the MAIN-world hook, API-first key fetch with bounded budget.
- `src/page-hook.js` — MAIN-world clipboard hook (`window.__openKeyClipboardHookInstalled`); armed/disarmed by token over `postMessage` channel `openkey-clipboard-v1`.
- `src/widget.js` — shadow-DOM widget factory (`OpenKeyWidget.create`); one widget per id per document.
- `src/content.js` — page glue: NewAPI export panel, Sub2API direct import automation, Linux.do CC Switch import and Base64 decode panel.
- `src/background.js` — MV3 service worker: settings, pending-import session state (`openKeyPendingImport`), tab management, `ccswitch://` opening.
- `src/popup.js` / `popup.html` — settings popup.
- Tests load `src/*.js` directly via `require` (Node) or `vm`; there is no build step. Chrome-only globals are injected by the tests, never by the modules themselves.
