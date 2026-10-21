const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('./server.cjs');
const { Sessions } = require('./sessions.cjs');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const owners = {
  [A]: { accountId: 'owner-A', accountName: '用户A', envName: 'HIK_DAKA_TOKEN', teamNo: 'TEAM-A' },
  [B]: { accountId: 'owner-B', accountName: '用户B', envName: 'HIK_DAKA_TOKEN_2', teamNo: 'TEAM-B' },
};
async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hik-http-'));
  const writes = [];
  const helper = async body => {
    const owner = owners[body.token];
    if (body.action === 'profile') {
      const own = Object.values(owners).find(item => item.accountId === body.accountId);
      return { success: true, bound: true, accountName: own.accountName, teamNo: own.teamNo, today: [{ desc: '上班', statusDesc: '正常' }], history: [{ message: own.accountName + '的记录' }] };
    }
    if (!owner) throw new Error('Token 已失效');
    if (body.expectedAccountId && body.expectedAccountId !== owner.accountId) throw new Error('不能修改其他账号');
    if (body.action === 'submit') writes.push(body);
    return { success: true, exists: true, sameToken: true, hasPushKey: true, unverifiedCount: 9, count: 99, ...owner };
  };
  const manager = {
    directory, defaultTeamNo: 'TEAM-A',
    records: [{ username: '18000000001', envName: 'HIK_DAKA_TOKEN', teamNo: 'TEAM-A' }, { username: '18000000002', envName: 'HIK_DAKA_TOKEN_2', teamNo: 'TEAM-B' }],
    status(envName) { return this.records.filter(item => !envName || item.envName === envName).map(item => ({ ...item })); },
    async configure(body) {
      if (body.enabled === false) { writes.push(body); return { success: true, disabled: true }; }
      if (body.username !== '18000000001' || body.password !== 'test-password') throw new Error('密码错误');
      return { success: true, ...owners[A], token: A };
    },
  };
  const app = createApp({ helper, manager, sessions: new Sessions(directory), csrfToken: 'public-csrf' });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { app.closeAllConnections?.(); await new Promise(resolve => app.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const request = async (browser, route, body, headers = {}) => {
    const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': browser.csrf || 'public-csrf', ...(browser.cookie ? { Cookie: browser.cookie } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const cookie = response.headers.get('set-cookie');
    if (cookie) browser.cookie = cookie.split(';')[0];
    const data = await response.json();
    if (data.csrfToken) browser.csrf = data.csrfToken;
    return { status: response.status, data, response };
  };
  return { app, base, request, writes, manager, directory };
}
test('匿名和隐私窗口无账号数据，两个浏览器只恢复各自身份与打卡记录', async t => {
  const { request } = await fixture(t);
  const anonymous = {};
  assert.equal((await request(anonymous, '/api/auto-login')).status, 401);
  assert.deepEqual((await request(anonymous, '/api/status')).data, { success: true });
  assert.equal((await request(anonymous, '/api/session')).data.authenticated, false);
  const browserA = {}, browserB = {};
  const login = await request(browserA, '/api/accounts/check', { token: A });
  assert.equal(login.status, 200);
  assert.equal(JSON.stringify(login.data).includes('99'), false);
  assert.equal(Object.hasOwn(login.data, 'unverifiedCount'), false);
  await request(browserB, '/api/accounts/check', { token: B });
  const a = await request(browserA, '/api/session?envName=HIK_DAKA_TOKEN_2');
  const b = await request(browserB, '/api/session');
  assert.equal(a.data.account.accountName, '用户A');
  assert.equal(b.data.account.accountName, '用户B');
  assert.equal(JSON.stringify(a.data).includes('用户B'), false);
  assert.equal(JSON.stringify(a.data).includes('18000000002'), false);
  assert.equal(JSON.stringify(a.data).includes(A), false);
  assert.equal((await request({}, '/api/session')).data.authenticated, false);
  const csrfA = browserA.csrf;
  assert.equal((await request(browserB, '/api/session/logout', {}, { 'X-CSRF-Token': csrfA })).status, 403);
});
test('停用和 Token 更新不能越权，Cookie 退出后无法复用', async t => {
  const { request, writes } = await fixture(t);
  assert.equal((await request({}, '/api/auto-login', { username: '18000000001', enabled: false })).status, 401);
  const browser = {};
  await request(browser, '/api/accounts/check', { token: A });
  assert.equal((await request(browser, '/api/auto-login', { username: '18000000002', enabled: false })).status, 403);
  assert.equal((await request(browser, '/api/tokens', { token: B, confirmExisting: true })).status, 500);
  assert.equal(writes.length, 0);
  const copied = { ...browser };
  assert.equal((await request(browser, '/api/session/logout', {})).status, 200);
  assert.equal((await request(copied, '/api/session')).data.authenticated, false);
});
test('密码验证后才建立会话，匿名旧接口不泄露已保存账号', async t => {
  const { request } = await fixture(t);
  const browser = {};
  assert.equal((await request(browser, '/api/auto-login', { username: '18000000001', password: 'wrong' })).status, 500);
  assert.equal((await request(browser, '/api/session')).data.authenticated, false);
  const login = await request(browser, '/api/auto-login', { username: '18000000001', password: 'test-password' });
  assert.equal(login.status, 200);
  assert.equal(JSON.stringify(login.data).includes(A), false);
  assert.equal((await request(browser, '/api/session')).data.account.teamNo, 'TEAM-A');
  assert.equal((await request({}, '/api/auto-login')).status, 401);
});
