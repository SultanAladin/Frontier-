# SolidArc panel integration contract

The HTML panel is a prototype client, not a second authoritative geometry kernel. It runs its JavaScript simulator when opened in a normal browser and switches command execution to the native host when a supported transport is present.

## Boundary

`solidarc-bridge.js` is the only transport layer. `window.SolidArcPanel` is the only API the embedded host should call. Native code must not reach into DOM nodes or private functions in `index.html`.

Protocol version: **1**.

### Panel → host request

```json
{
  "protocol": 1,
  "id": "panel-mfj8-4",
  "method": "command.execute",
  "params": { "command": "box 40 30 20" }
}
```

### Host → panel reply

```json
{
  "protocol": 1,
  "replyTo": "panel-mfj8-4",
  "ok": true,
  "result": {
    "message": "created Box01",
    "document": { "app": "SolidArc", "v": 1, "figures": [] }
  }
}
```

On failure, reply with `"ok": false` and an `"error"` string.

### Host → panel event

```json
{
  "protocol": 1,
  "event": "document.snapshot",
  "payload": { "document": { "app": "SolidArc", "v": 1, "figures": [] } }
}
```

The panel emits `panel.ready` after connecting and debounced `document.changed` events while prototype-side controls modify a document.

## Supported transports

The bridge detects these in order:

1. Microsoft WebView2: `window.chrome.webview`
2. WKWebView: `window.webkit.messageHandlers.solidarc`
3. CEF/QWebEngine/custom injected object: `window.solidarcHost.postMessage()` and optional `setMessageHandler()`
4. Development WebSocket: `?bridge=ws://127.0.0.1:PORT` (use `wss://` from an HTTPS page)

A browser without any transport stays in **prototype** mode. The viewport header displays the current state.

For WKWebView or any one-way injected transport, deliver native messages with:

```js
window.SolidArcPanel.receiveHostMessage(message)
```

Useful host calls:

```js
window.SolidArcPanel.exportDocument()
window.SolidArcPanel.importDocument(snapshot)
window.SolidArcPanel.connection()
```

## Ownership rules for the C++ phase

- C++ owns geometry, topology, constraints, IDs, undo/redo, and final validation.
- HTML owns layout, focus, panels, transient hover/drag state, and presentation.
- Commands cross the bridge as intent; the host returns the resulting document snapshot.
- Do not translate the JavaScript modelling functions line-by-line into host calls. Replace them behind the bridge one operation family at a time.
- Keep IDs stable across snapshots so selection and inspector state can survive host updates.
- Reject protocol mismatches and malformed documents rather than partially applying them.

## Verification

```bash
node Verification/smoke.js
node Verification/bridge.test.js
```

Publish the canonical panel and bridge to GitHub Pages with:

```bash
Scripts/publish-pages.sh
```

Do not edit `docs/solidarc/` directly; it is generated from `Panel/`.
