const assert = require('assert');
const bridge = require('../solidarc-bridge.js');

(async () => {
  const sent = [];
  bridge.use({ name: 'test', send: message => sent.push(message) }, 'test');
  assert.equal(bridge.status().connected, true);
  assert.equal(sent[0].event, 'panel.ready');
  assert.equal(sent[0].protocol, 1);

  const resultPromise = bridge.request('command.execute', { command: 'box 1 2 3' }, 1000);
  const request = sent.at(-1);
  assert.equal(request.method, 'command.execute');
  assert.equal(request.params.command, 'box 1 2 3');
  bridge.receive({ protocol: 1, replyTo: request.id, ok: true, result: { changed: true } });
  assert.deepEqual(await resultPromise, { changed: true });

  let snapshot;
  const stop = bridge.on('document.snapshot', payload => { snapshot = payload; });
  assert.equal(bridge.receive(JSON.stringify({ protocol: 1, event: 'document.snapshot', payload: { document: { figures: [] } } })), true);
  assert.deepEqual(snapshot.document.figures, []);
  stop();

  let protocolError;
  bridge.on('error', payload => { protocolError = payload.message; });
  assert.equal(bridge.receive({ protocol: 99, event: 'host.log' }), false);
  assert.match(protocolError, /unsupported SolidArc protocol/);

  bridge.disconnect();
  assert.equal(bridge.status().mode, 'prototype');
  console.log('bridge: protocol, request/reply, events and disconnect OK');
})().catch(error => { console.error(error); process.exit(1); });
