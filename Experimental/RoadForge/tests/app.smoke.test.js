import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { test } from 'node:test';
import { createServer } from 'vite';

const ProjectRoot = resolve(import.meta.dirname, '..');

test('editor renders its initial UI without runtime reference errors', async () => {
  const OriginalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null },
  });

  let Server;
  try {
    Server = await createServer({
      configFile: resolve(ProjectRoot, 'vite.config.js'),
      root: ProjectRoot,
      server: { middlewareMode: true },
      appType: 'custom',
      logLevel: 'silent',
    });
    const { default: App } = await Server.ssrLoadModule('/src/App.jsx');
    const Markup = renderToString(React.createElement(App));

    assert.match(Markup, /ROADFORGE/);
    assert.match(Markup, /INFRASTRUCTURE STUDIO/);
  } finally {
    await Server?.close();
    if (OriginalLocalStorage) {
      Object.defineProperty(globalThis, 'localStorage', OriginalLocalStorage);
    } else {
      delete globalThis.localStorage;
    }
  }
});
