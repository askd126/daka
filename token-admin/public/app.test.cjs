const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const TOKEN = '22222222-2222-4222-8222-222222222222';

const makeElement = () => {
  const listeners = {};
  return {
    listeners,
    value: '',
    type: 'password',
    hidden: true,
    textContent: '',
    classList: { toggle() {} },
    addEventListener(type, listener) { listeners[type] = listener; },
    setAttribute() {},
    focus() {},
  };
};

const loadPage = (account) => {
  const selectors = ['#token-form', '#token', '#token-length', '#toggle-visibility',
    '#send-key', '#toggle-send-key', '#submit-button', '#result', '#panel-state',
    'meta[name="csrf-token"]'];
  const elements = Object.fromEntries(selectors.map((selector) => [selector, makeElement()]));
  elements['meta[name="csrf-token"]'].content = 'test-csrf';
  const submitLabel = makeElement();
  elements['#submit-button'].querySelector = () => submitLabel;
  const submissions = [];

  const fetch = async (url, options = {}) => {
    if (url === '/api/status') return { ok: true, json: async () => ({ success: true }) };
    if (url === '/api/accounts/check') return { ok: true,
      json: async () => ({ success: true, ...account }) };
    if (url === '/api/tokens') {
      submissions.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ success: true, duplicate: true,
        updatedToken: true, envName: 'HIK_DAKA_TOKEN', accountName: '张三', hasPushKey: false }) };
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const document = { querySelector: (selector) => elements[selector] };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8'),
    { document, fetch });

  return {
    elements,
    submitLabel,
    submissions,
    submit: () => elements['#token-form'].listeners.submit({ preventDefault() {} }),
  };
};

test('已有相同 Token 且 SendKey 留空时只提示，不提交写入', async () => {
  const page = loadPage({ exists: true, sameToken: true, hasPushKey: false,
    envName: 'HIK_DAKA_TOKEN' });
  page.elements['#token'].value = TOKEN;
  await page.submit();
  assert.equal(page.submissions.length, 0);
  assert.match(page.elements['#result'].textContent, /未做任何更改/);
});

test('刷新 Token 先确认，留空 SendKey 不会出现在提交体中', async () => {
  const page = loadPage({ exists: true, sameToken: false, hasPushKey: true,
    envName: 'HIK_DAKA_TOKEN' });
  page.elements['#token'].value = TOKEN;
  await page.submit();
  assert.equal(page.submissions.length, 0);
  assert.match(page.submitLabel.textContent, /确认更新/);

  await page.submit();
  assert.equal(page.submissions.length, 1);
  assert.equal(page.submissions[0].confirmExisting, true);
  assert.equal(Object.hasOwn(page.submissions[0], 'sendKey'), false);
});
