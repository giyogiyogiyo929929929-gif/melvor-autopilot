import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../setup.mjs';

test('UI starts stopped, keeps stop available during analysis and never resumes automatically', () => {
  const previous = Object.fromEntries(['document', 'game', 'setInterval', 'clearInterval'].map(key =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const panels = [];
  const intervals = new Map();
  let nextTimer = 0;
  let gameReads = 0;
  function element() {
    return { style: {}, children: [], listeners: {}, disabled: false,
      setAttribute() {}, append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); },
      addEventListener(event, handler) { this.listeners[event] = handler; } };
  }
  try {
    globalThis.document = { createElement: element, body: { appendChild(panel) { panels.push(panel); } } };
    globalThis.game = new Proxy({}, { get() { gameReads++; throw new Error('unverified game access'); } });
    globalThis.setInterval = callback => { intervals.set(++nextTimer, callback); return nextTimer; };
    globalThis.clearInterval = id => { intervals.delete(id); };
    const ctx = { onInterfaceReady(callback) { callback(); } };
    setup(ctx);
    const [, mode, status, detail, actions, log] = panels[0].children;
    const [start, stop] = actions.children;
    assert.match(mode.textContent, /解析専用/);
    assert.equal(status.textContent, '停止中');
    assert.equal(intervals.size, 0);
    assert.equal(start.disabled, false);
    start.listeners.click();
    assert.equal(intervals.size, 1);
    assert.equal(stop.disabled, false);
    assert.match(detail.textContent, /実機確認待ち/);
    assert.match(log.textContent, /runtime-adapter-unverified/);
    start.listeners.click(); // duplicate start never creates multiple timers
    assert.equal(intervals.size, 1);
    for (const tick of intervals.values()) tick();
    assert.equal(gameReads, 0);
    stop.listeners.click();
    assert.equal(intervals.size, 0);
    assert.equal(status.textContent, '停止中');
    assert.equal(start.disabled, false);
    setup(ctx); // simulated reload: no stored running state is restored
    assert.equal(intervals.size, 0);
    assert.equal(panels[1].children[2].textContent, '停止中');
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
