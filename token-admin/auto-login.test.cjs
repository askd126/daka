const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AutoLogin, login, INTERVAL } = require('./auto-login.cjs');
const token = '22222222-2222-4222-8222-222222222222';
test('每枚失效 Cookie 只登录一次，失败和无凭据仅提醒一次，重启后仍去重', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hik-recover-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let calls = 0;
  let current = token;
  const updated = '33333333-3333-4333-8333-333333333333';
  const helper = async request => {
    if (request.action === 'current') return { token: current };
    if (request.action === 'submit') current = request.token;
    return { success: true, exists: true, envName: 'HIK_DAKA_TOKEN' };
  };
  const authenticate = async () => { calls++; throw new Error('bad password'); };
  let manager = new AutoLogin(helper, directory, authenticate);
  manager.records = [{ envName: 'HIK_DAKA_TOKEN', username: '18000000000', password: 'test', lastSuccess: 0, lastAttempt: 0 }];
  const first = await manager.recover('HIK_DAKA_TOKEN', token);
  assert.equal(first.notify, true);
  assert.equal(first.recovered, false);
  manager = new AutoLogin(helper, directory, authenticate);
  assert.equal((await manager.recover('HIK_DAKA_TOKEN', token)).notify, false);
  await manager.refresh(Date.now() + INTERVAL);
  assert.equal(calls, 1);
  assert.equal((await manager.recover('HIK_DAKA_TOKEN_2', token)).notify, true);
  assert.equal((await manager.recover('HIK_DAKA_TOKEN_2', token)).notify, false);
  manager.recoveries = {};
  manager.authenticate = async () => { calls++; return updated; };
  const success = await manager.recover('HIK_DAKA_TOKEN', token);
  assert.equal(success.recovered, true);
  assert.equal(success.token, updated);
  assert.equal((await manager.recover('HIK_DAKA_TOKEN', token)).notify, false);
  assert.equal(calls, 2);
});
test('官方登录仅返回有效 Token，错误响应不回显服务端内容', async () => {
  const value = await login('18000000000', 'test-secret', async (_, options) => {
    const body = JSON.parse(options.body);
    assert.notEqual(body.password, 'test-secret');
    assert.equal(options.headers['login-source'], 'link-web');
    return { ok: true, json: async () => ({ code: 0, data: { token } }) };
  });
  assert.equal(value, token);
  await assert.rejects(login('18000000000', 'test-secret', async () => ({
    ok: false, json: async () => ({ message: 'test-secret' }),
  })), error => !error.message.includes('test-secret'));
});
test('加密落盘、确认门、十天周期、失败退避、重启恢复与删除凭据', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hik-auto-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let logins = 0;
  let fail = false;
  const helper = async body => body.action === 'check'
    ? { exists: true, envName: 'HIK_DAKA_TOKEN' }
    : !body.confirmExisting ? { requiresConfirmation: true }
      : { success: true, envName: 'HIK_DAKA_TOKEN' };
  const authenticate = async () => { logins++; if (fail) throw new Error('登录失败'); return token; };
  let manager = new AutoLogin(helper, directory, authenticate);
  const body = { username: '18000000000', password: 'test-secret' };
  assert.equal((await manager.configure(body)).requiresConfirmation, true);
  assert.equal(fs.existsSync(path.join(directory, 'accounts.enc')), false);
  await manager.configure({ ...body, confirm: true });
  assert.equal(fs.readFileSync(path.join(directory, 'accounts.enc')).includes('test-secret'), false);
  assert.equal(JSON.stringify(manager.status()).includes('test-secret'), false);
  const start = manager.records[0].lastSuccess;
  manager = new AutoLogin(helper, directory, authenticate);
  const before = logins;
  await manager.refresh(start + INTERVAL - 1);
  assert.equal(logins, before);
  fail = true;
  await manager.refresh(start + INTERVAL);
  assert.equal(manager.records[0].lastSuccess, start);
  assert.equal(manager.status()[0].error, '登录失败');
  await manager.refresh(start + INTERVAL + 1000);
  assert.equal(logins, before + 1);
  fail = false;
  await manager.refresh(start + INTERVAL + 3600000);
  assert.equal(manager.records[0].lastSuccess, start + INTERVAL + 3600000);
  await manager.configure({ username: body.username, enabled: false });
  assert.deepEqual(new AutoLogin(helper, directory).status(), []);
});
test('后台刷新拒绝把凭据写入另一个账号或新增变量', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hik-bind-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let writes = 0;
  const manager = new AutoLogin(async body => {
    if (body.action === 'submit') writes++;
    return { exists: true, envName: 'HIK_DAKA_TOKEN_2' };
  }, directory, async () => token);
  manager.records = [{ username: '18000000000', password: 'test', envName: 'HIK_DAKA_TOKEN', lastSuccess: 0, lastAttempt: 0 }];
  await manager.refresh(INTERVAL);
  assert.equal(writes, 0);
  assert.match(manager.records[0].error, /账号绑定/);
});
