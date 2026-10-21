const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

// The mocked account module lives at this container path; filesystem discovery has separate tests.
process.env.QL_HIK_DAKA_PATH = '/ql/data/scripts/hik_daka.js';

const OLD_TOKEN = '11111111-1111-4111-8111-111111111111';
const NEW_TOKEN = '22222222-2222-4222-8222-222222222222';
const OTHER_TOKEN = '33333333-3333-4333-8333-333333333333';

const loadHelper = (initialEnvs, accounts, extraCore = {}) => {
  const envs = initialEnvs.map((item) => ({ ...item }));
  const writes = [];
  const ql = {
    getEnvs: async ({ searchValue }) => ({ code: 200,
      data: envs.filter((item) => item.name.includes(searchValue)) }),
    createEnv: async ({ envs: created }) => {
      writes.push({ type: 'create', envs: created });
      envs.push(...created.map((item) => ({ ...item })));
      return { code: 200 };
    },
    updateEnv: async ({ env }) => {
      writes.push({ type: 'update', env });
      const index = envs.findIndex((item) => item.id === env.id);
      envs[index] = { ...env };
      return { code: 200 };
    },
  };
  const filename = path.join(__dirname, 'ql_token_admin.cjs');
  const script = new Module(filename, module);
  script.filename = filename;
  script.paths = Module._nodeModulePaths(__dirname);
  script.require = (request) => {
    if (request === '/ql/shell/preload/client.js') return ql;
    if (request === '/ql/data/scripts/hik_daka.js') return {
      ...extraCore,
      getAccount: async (token) => {
        if (!accounts[token]) throw new Error('Token 已失效');
        return accounts[token];
      },
    };
    return Module.prototype.require.call(script, request);
  };
  script._compile(fs.readFileSync(filename, 'utf8'), filename);
  return { handleRequest: script.exports.handleRequest, envs, writes };
};

test('相同海康账号的新 Token 更新原变量，留空不修改通知 Key', async () => {
  const helper = loadHelper([
    { id: '1', name: 'HIK_DAKA_TOKEN', value: OLD_TOKEN, remarks: '海康考勤 Token - 张三' },
    { id: '2', name: 'HIK_DAKA_PUSH_KEY', value: 'SCToldkey', remarks: '旧通知 Key' },
  ], {
    [OLD_TOKEN]: { accountNo: 'A100', nickName: '张三' },
    [NEW_TOKEN]: { accountNo: 'A100', nickName: '张三' },
  });

  const check = await helper.handleRequest({ action: 'check', token: NEW_TOKEN });
  assert.equal(check.exists, true);
  assert.equal(check.sameToken, false);
  assert.equal(check.hasPushKey, true);

  const pending = await helper.handleRequest({ action: 'submit', token: NEW_TOKEN });
  assert.equal(pending.requiresConfirmation, true);
  assert.equal(helper.writes.length, 0);

  const result = await helper.handleRequest({ action: 'submit', token: NEW_TOKEN, confirmExisting: true });
  assert.equal(result.updatedToken, true);
  assert.equal(result.updatedPushKey, false);
  assert.equal(helper.envs.find((item) => item.name === 'HIK_DAKA_TOKEN').value, NEW_TOKEN);
  assert.equal(helper.envs.find((item) => item.name === 'HIK_DAKA_PUSH_KEY').value, 'SCToldkey');
  assert.match(helper.envs.find((item) => item.name === 'HIK_DAKA_TOKEN').remarks, /hik-account:A100/);
  assert.equal(helper.writes.length, 1);
});

test('相同 Token 且留空通知 Key 时不写入任何变量', async () => {
  const helper = loadHelper([
    { id: '1', name: 'HIK_DAKA_TOKEN', value: OLD_TOKEN, remarks: '海康考勤 Token - 张三' },
  ], { [OLD_TOKEN]: { accountNo: 'A100', nickName: '张三' } });

  const check = await helper.handleRequest({ action: 'check', token: OLD_TOKEN });
  assert.equal(check.exists, true);
  assert.equal(check.sameToken, true);
  const result = await helper.handleRequest({ action: 'submit', token: OLD_TOKEN });
  assert.equal(result.duplicate, true);
  assert.equal(helper.writes.length, 0);
});

test('新账号未填通知 Key 时只创建 Token 变量', async () => {
  const helper = loadHelper([], { [OTHER_TOKEN]: { accountNo: 'B200', nickName: '李四' } });
  const result = await helper.handleRequest({ action: 'submit', token: OTHER_TOKEN });
  assert.equal(result.duplicate, false);
  assert.equal(helper.writes.length, 1);
  assert.deepEqual(helper.writes[0].envs.map((item) => item.name), ['HIK_DAKA_TOKEN']);
});

test('账号 ID 备注可识别失效旧 Token，补配通知 Key 需要确认', async () => {
  const helper = loadHelper([
    { id: '1', name: 'HIK_DAKA_TOKEN', value: OLD_TOKEN,
      remarks: '海康考勤 Token - 张三 [hik-account:A100]' },
  ], { [NEW_TOKEN]: { accountNo: 'A100', nickName: '张三' } });

  const check = await helper.handleRequest({ action: 'check', token: NEW_TOKEN });
  assert.equal(check.exists, true);
  assert.equal(check.sameToken, false);
  assert.equal(check.hasPushKey, false);

  const pending = await helper.handleRequest({ action: 'submit', token: NEW_TOKEN,
    sendKey: 'SCTnewkey' });
  assert.equal(pending.requiresConfirmation, true);
  assert.equal(helper.writes.length, 0);

  const result = await helper.handleRequest({ action: 'submit', token: NEW_TOKEN,
    sendKey: 'SCTnewkey', confirmExisting: true });
  assert.equal(result.updatedToken, true);
  assert.equal(result.updatedPushKey, true);
  assert.deepEqual(helper.writes.map((item) => item.type), ['update', 'create']);
  assert.deepEqual(helper.writes[1].envs.map((item) => item.name), ['HIK_DAKA_PUSH_KEY']);
});

test('旧 Token 无法核验时先提示，再确认新增', async () => {
  const helper = loadHelper([
    { id: '1', name: 'HIK_DAKA_TOKEN', value: OLD_TOKEN, remarks: '海康考勤 Token - 未知旧账号' },
  ], { [OTHER_TOKEN]: { accountNo: 'B200', nickName: '李四' } });

  const check = await helper.handleRequest({ action: 'check', token: OTHER_TOKEN });
  assert.equal(check.exists, false);
  assert.equal(check.unverifiedCount, 1);
  const pending = await helper.handleRequest({ action: 'submit', token: OTHER_TOKEN });
  assert.equal(pending.requiresConfirmation, true);
  assert.equal(helper.writes.length, 0);

  const result = await helper.handleRequest({ action: 'submit', token: OTHER_TOKEN,
    confirmNewWithUnknown: true });
  assert.equal(result.duplicate, false);
  assert.deepEqual(helper.writes[0].envs.map((item) => item.name), ['HIK_DAKA_TOKEN_2']);
});


test('个人资料和写入都验证账号 ID，相同失效 Token 不能用于网页登录', async () => {
  const helper = loadHelper([
    { id: '1', name: 'HIK_DAKA_TOKEN', value: OLD_TOKEN, remarks: 'A [hik-account:A100]' },
    { id: '2', name: 'HIK_DAKA_TOKEN_2', value: OTHER_TOKEN, remarks: 'B [hik-account:B200]' },
  ], { [NEW_TOKEN]: { accountNo: 'A100', nickName: '用户A' }, [OTHER_TOKEN]: { accountNo: 'B200', nickName: '用户B' } }, {
    getTodayStatus: async token => { assert.equal(token, NEW_TOKEN); return { personName: '用户A' }; },
    getRule: async () => '规则A', getTodayDetails: () => [],
  });
  const own = await helper.handleRequest({ action: 'profile', accountId: 'A100', envName: 'HIK_DAKA_TOKEN_2', token: NEW_TOKEN });
  assert.equal(own.accountName, '用户A');
  assert.equal(own.bound, false);
  assert.equal(JSON.stringify(own).includes('用户B'), false);
  await assert.rejects(helper.handleRequest({ action: 'profile', accountId: 'A100', envName: 'HIK_DAKA_TOKEN_2', token: OTHER_TOKEN }), /不匹配/);
  await assert.rejects(helper.handleRequest({ action: 'submit', expectedAccountId: 'A100', token: OTHER_TOKEN, confirmExisting: true }), /其他账号/);
  await assert.rejects(helper.handleRequest({ action: 'check', token: OLD_TOKEN }), /Token 已失效/);
  assert.equal(helper.writes.length, 0);
});
