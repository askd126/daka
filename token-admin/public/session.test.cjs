const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('切换账号时清空旧 DOM，迟到的旧账号响应不能覆盖新账号', async () => {
  const element = () => ({ hidden: true, value: '', content: '', children: [], _text: '', listeners: {},
    set textContent(value) { this._text = value; this.children = []; }, get textContent() { return this._text; },
    appendChild(child) { this.children.push(child); }, addEventListener(name, fn) { this.listeners[name] = fn; } });
  const selectors = ['#token', '#send-key', '#auto-username', '#auto-password', '#auto-team', '#result', '#auto-result', '#my-account', '#my-account-title', '#my-team', '#my-rule', '#attendance-error', '#today-rows', '#recent-records', '#auto-status', '#session-message', '#refresh-account', '#logout-button', 'meta[name="csrf-token"]'];
  const elements = Object.fromEntries(selectors.map(key => [key, element()]));
  const calls = [];
  const window = { events: {}, addEventListener(name, fn) { this.events[name] = fn; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'session.js'), 'utf8'), {
    window, document: { querySelector: key => elements[key], createElement: element },
    fetch: () => new Promise(resolve => calls.push(resolve)),
  });
  const response = name => ({ ok: true, json: async () => ({ success: true, authenticated: true,
    account: { personName: name, today: [], history: [] }, autoLogin: { username: name, teamNo: name } }) });
  const previous = window.hikSession.refresh();
  window.hikSession.clear();
  const current = window.hikSession.refresh();
  calls[1](response('用户B')); await current;
  calls[0](response('用户A')); await previous;
  assert.equal(elements['#my-account-title'].textContent, '用户B');
  assert.equal(elements['#auto-status'].textContent.includes('用户A'), false);
  window.events.pagehide();
  assert.equal(elements['#my-account'].hidden, true);
  assert.equal(elements['#my-account-title'].textContent, '');
  assert.equal(elements['#auto-status'].textContent, '');
});
