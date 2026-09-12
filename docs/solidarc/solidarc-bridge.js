/* SolidArc browser/native bridge.
 * Transport-neutral JSON-RPC style protocol for the HTML prototype and a future
 * embedded C++ web view. The panel remains fully usable when no host exists.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SolidArcBridge = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const PROTOCOL = 1;
  const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
  const listeners = new Map();
  const pending = new Map();
  let sequence = 0;
  let transport = null;
  let state = 'prototype';

  function emit(type, payload) {
    const calls = (listeners.get(type) || []).slice();
    calls.forEach(fn => {
      try { fn(payload); } catch (error) { setTimeout(() => { throw error; }, 0); }
    });
  }

  function on(type, fn) {
    if (typeof fn !== 'function') throw new TypeError('bridge listener must be a function');
    const calls = listeners.get(type) || [];
    calls.push(fn);
    listeners.set(type, calls);
    return () => {
      const next = (listeners.get(type) || []).filter(call => call !== fn);
      if (next.length) listeners.set(type, next); else listeners.delete(type);
    };
  }

  function normalise(raw) {
    if (raw && raw.data !== undefined) raw = raw.data;
    if (typeof raw === 'string') {
      if (raw.length > MAX_MESSAGE_BYTES) throw new Error('host message exceeds 8 MiB');
      raw = JSON.parse(raw);
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid host message');
    if (raw.protocol !== undefined && raw.protocol !== PROTOCOL) {
      throw new Error(`unsupported SolidArc protocol ${raw.protocol}`);
    }
    return raw;
  }

  function receive(raw) {
    let message;
    try { message = normalise(raw); }
    catch (error) { emit('error', { source: 'protocol', message: error.message }); return false; }

    if (message.replyTo) {
      const request = pending.get(message.replyTo);
      if (!request) return false;
      pending.delete(message.replyTo);
      clearTimeout(request.timer);
      if (message.ok === false) request.reject(new Error(message.error || 'host request failed'));
      else request.resolve(message.result);
      return true;
    }

    if (!message.event) return false;
    emit(message.event, message.payload);
    emit('*', message);
    return true;
  }

  function use(nextTransport, name) {
    if (!nextTransport || typeof nextTransport.send !== 'function') return false;
    if (transport && typeof transport.close === 'function') transport.close();
    transport = nextTransport;
    state = name || nextTransport.name || 'native';
    if (typeof nextTransport.listen === 'function') nextTransport.listen(receive);
    emit('connection', status());
    notify('panel.ready', {
      panel: 'SolidArc',
      protocol: PROTOCOL,
      capabilities: ['command.execute', 'document.snapshot', 'selection.changed', 'camera.changed']
    });
    return true;
  }

  function notify(event, payload) {
    if (!transport) return false;
    transport.send({ protocol: PROTOCOL, event, payload });
    return true;
  }

  function request(method, params, timeoutMs) {
    if (!transport) return Promise.reject(new Error('SolidArc native host is not connected'));
    const id = `panel-${Date.now().toString(36)}-${++sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`host request timed out: ${method}`));
      }, timeoutMs || 10000);
      pending.set(id, { resolve, reject, timer });
      transport.send({ protocol: PROTOCOL, id, method, params: params || {} });
    });
  }

  function disconnect(reason) {
    if (transport && typeof transport.close === 'function') transport.close();
    transport = null;
    state = 'prototype';
    pending.forEach(request => {
      clearTimeout(request.timer);
      request.reject(new Error(reason || 'SolidArc host disconnected'));
    });
    pending.clear();
    emit('connection', status());
  }

  function status() {
    return { connected: !!transport, mode: state, protocol: PROTOCOL };
  }

  function webViewTransport(send, subscribe, name) {
    return {
      name,
      send(message) { send(JSON.stringify(message)); },
      listen(handler) { if (subscribe) subscribe(handler); }
    };
  }

  function connectWebSocket(url) {
    if (!root.WebSocket) return false;
    let socket;
    try { socket = new root.WebSocket(url); } catch (_) { return false; }
    socket.addEventListener('message', receive);
    socket.addEventListener('open', () => use({
      name: 'websocket',
      send(message) { socket.send(JSON.stringify(message)); },
      close() { socket.close(); }
    }, 'websocket'));
    socket.addEventListener('close', () => {
      if (transport && state === 'websocket') disconnect('SolidArc WebSocket closed');
    });
    socket.addEventListener('error', () => emit('error', { source: 'transport', message: 'WebSocket connection failed' }));
    return true;
  }

  function autoConnect() {
    if (!root || !root.location) return false;

    // Microsoft WebView2.
    if (root.chrome && root.chrome.webview) {
      return use(webViewTransport(
        message => root.chrome.webview.postMessage(message),
        handler => root.chrome.webview.addEventListener('message', handler),
        'webview2'
      ), 'webview2');
    }

    // WKWebView. Native code sends replies through window.SolidArcBridge.receive(...).
    if (root.webkit && root.webkit.messageHandlers && root.webkit.messageHandlers.solidarc) {
      return use(webViewTransport(
        message => root.webkit.messageHandlers.solidarc.postMessage(message),
        null,
        'wkwebview'
      ), 'wkwebview');
    }

    // Generic injected object (CEF/QWebEngine/custom host).
    if (root.solidarcHost && typeof root.solidarcHost.postMessage === 'function') {
      return use(webViewTransport(
        message => root.solidarcHost.postMessage(message),
        handler => {
          if (typeof root.solidarcHost.setMessageHandler === 'function') root.solidarcHost.setMessageHandler(handler);
        },
        'embedded'
      ), 'embedded');
    }

    const query = new URLSearchParams(root.location.search || '');
    const socketUrl = query.get('bridge');
    if (socketUrl && /^wss?:\/\//i.test(socketUrl)) return connectWebSocket(socketUrl);
    emit('connection', status());
    return false;
  }

  const api = { PROTOCOL, MAX_MESSAGE_BYTES, on, receive, use, notify, request, disconnect, status, autoConnect, connectWebSocket };
  return api;
});
