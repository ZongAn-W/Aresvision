import test from 'node:test';
import assert from 'node:assert/strict';
import { createDialogFocusScope } from './dialogFocus.js';

function fixture() {
  const listeners = new Map();
  const doc = {
    activeElement: null,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
  };
  const element = (name, options = {}) => ({
    name, isConnected: true,
    closest() { return options.hidden ? this : null; },
    getClientRects() { return options.visible === false ? [] : [{}]; },
    focus() { doc.activeElement = this; },
  });
  const container = (elements, initial = null) => ({
    querySelectorAll() { return elements; },
    querySelector() { return initial; },
    contains(target) { return target === this || elements.includes(target); },
    focus() { doc.activeElement = this; },
  });
  const key = (value, shiftKey = false) => {
    const event = { key: value, shiftKey, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    for (const handler of Array.from(listeners.get('keydown') || [])) handler(event);
    return event;
  };
  return { doc, element, container, key, listeners };
}

test('dialog enters initial focus, traps both Tab edges and restores its trigger', () => {
  const f = fixture();
  const trigger = f.element('trigger');
  const first = f.element('cancel');
  const last = f.element('confirm');
  trigger.focus();
  const cleanup = createDialogFocusScope(f.container([first, last], first), () => {}, f.doc);
  assert.equal(f.doc.activeElement, first);
  assert.equal(f.key('Tab', true).prevented, true);
  assert.equal(f.doc.activeElement, last);
  assert.equal(f.key('Tab').prevented, true);
  assert.equal(f.doc.activeElement, first);
  cleanup();
  assert.equal(f.doc.activeElement, trigger);
  assert.equal(f.listeners.get('keydown').size, 0);
  assert.equal(f.listeners.get('focusin').size, 0);
});

test('only the top dialog handles Escape and closing it restores its parent focus', () => {
  const f = fixture();
  const trigger = f.element('trigger');
  const parentButton = f.element('parent');
  const childButton = f.element('child');
  let parentClosed = 0;
  let childClosed = 0;
  trigger.focus();
  const closeParent = createDialogFocusScope(f.container([parentButton]), () => { parentClosed += 1; }, f.doc);
  const closeChild = createDialogFocusScope(f.container([childButton]), () => { childClosed += 1; }, f.doc);
  const event = f.key('Escape');
  assert.equal(childClosed, 1);
  assert.equal(parentClosed, 0);
  assert.equal(event.stopped, true);
  closeChild();
  assert.equal(f.doc.activeElement, parentButton);
  f.key('Escape');
  assert.equal(parentClosed, 1);
  closeParent();
  assert.equal(f.doc.activeElement, trigger);
});

test('hidden controls are skipped and dialogs without focusable controls retain focus', () => {
  const f = fixture();
  const hidden = f.element('hidden', { hidden: true });
  const visible = f.element('visible');
  const cleanup = createDialogFocusScope(f.container([hidden, visible]), () => {}, f.doc);
  assert.equal(f.doc.activeElement, visible);
  cleanup();
  const empty = f.container([]);
  const cleanupEmpty = createDialogFocusScope(empty, () => {}, f.doc);
  assert.equal(f.doc.activeElement, empty);
  assert.equal(f.key('Tab').prevented, true);
  assert.equal(f.doc.activeElement, empty);
  cleanupEmpty();
});

test('removing a background dialog never steals focus from its active child', () => {
  const f = fixture();
  const parentButton = f.element('parent');
  const childButton = f.element('child');
  const closeParent = createDialogFocusScope(f.container([parentButton]), () => {}, f.doc);
  const closeChild = createDialogFocusScope(f.container([childButton]), () => {}, f.doc);
  closeParent();
  assert.equal(f.doc.activeElement, childButton);
  parentButton.isConnected = false;
  closeChild();
  assert.equal(f.doc.activeElement, childButton);
});
