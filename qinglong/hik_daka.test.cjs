const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

// 仓库根目录是 ESM；青龙订阅脚本实际作为 CommonJS 在 /ql/data/scripts 下运行。
const filename = path.join(__dirname, 'hik_daka.js');
const script = new Module(filename, module);
script.filename = filename;
script.paths = Module._nodeModulePaths(__dirname);
script._compile(fs.readFileSync(filename, 'utf8'), filename);
const { classifyHolidayDate, isOnLeave } = script.exports;
test('过期仅恢复一次，更新后继续；检查模式不恢复，普通错误不恢复', async () => {
  const { runWithRecovery } = script.exports;
  const expired = () => Object.assign(new Error('expired'), { code: 'AUTH_EXPIRED' });
  let runs = 0;
  let recoveries = 0;
  const account = { token: 'old', envName: 'HIK_DAKA_TOKEN', pushKey: 'key' };
  const recover = async () => { recoveries++; return { recovered: true, notify: true, token: 'new', message: '已恢复' }; };
  const operation = async item => { runs++; if (item.token === 'old') throw expired(); return { status: 'success', message: '已打卡' }; };
  const result = await runWithRecovery(account, {}, {}, 'morning', operation, recover);
  assert.equal(result.message, '已恢复；已打卡');
  assert.equal(recoveries, 1);
  assert.equal(runs, 2);
  await assert.rejects(runWithRecovery({ ...account, token: 'old' }, {}, { checkOnly: true }, '', operation, recover));
  assert.equal(recoveries, 1);
  await assert.rejects(runWithRecovery(account, {}, {}, '', async () => { throw new Error('network'); }, recover));
  assert.equal(recoveries, 1);
  await assert.rejects(runWithRecovery(account, {}, {}, '', async () => { throw expired(); }, recover));
  assert.equal(recoveries, 2);
  const text = script.exports.buildNotificationContent([{ status: 'failed', accountName: 'hidden', message: 'expired', suppressSummary: true }, { status: 'success', accountName: 'other', message: 'ok' }]);
  assert.equal(text.includes('expired'), false);
  assert.equal(text.includes('other'), true);
});

const chinaTime = (day, hour = 9) => new Date(`${day}T${String(hour - 8).padStart(2, '0')}:00:00Z`);
const off = (date, name = '节假日') => ({ date, name, isOffDay: true });

test('官方节假日与周末相连时，周六和周日都跳过', () => {
  for (const holiday of [off('2026-09-25', '中秋节'), off('2026-09-26', '中秋节'), off('2026-09-28', '中秋节')]) {
    for (const day of ['2026-09-26', '2026-09-27']) {
      const result = classifyHolidayDate(chinaTime(day), [holiday]);
      assert.equal(result.isOffDay, true);
      assert.equal(result.weekendPunch, false);
      assert.equal(result.name, '中秋节');
    }
  }
});

test('独立周末的决定跨班次稳定，长期比例接近 50%', () => {
  let punchDays = 0;
  let weekendDays = 0;
  for (let day = Date.UTC(2026, 0, 1); day < Date.UTC(2036, 0, 1); day += 86400000) {
    const date = new Date(day);
    if (![0, 6].includes(date.getUTCDay())) continue;
    const key = date.toISOString().slice(0, 10);
    const morning = classifyHolidayDate(chinaTime(key, 8), []);
    const evening = classifyHolidayDate(chinaTime(key, 22), []);
    assert.equal(morning.weekendPunch, evening.weekendPunch);
    punchDays += Number(morning.weekendPunch);
    weekendDays += 1;
  }
  assert.ok(punchDays / weekendDays > 0.45 && punchDays / weekendDays < 0.55);
});

test('跨年相连的周末、补班日和普通工作日按各自规则判断', () => {
  assert.equal(classifyHolidayDate(chinaTime('2028-01-01'), [off('2027-12-31')]).isOffDay, true);
  assert.equal(classifyHolidayDate(chinaTime('2028-01-02'), [off('2027-12-31')]).isOffDay, true);
  assert.equal(classifyHolidayDate(chinaTime('2026-09-20'), [{ date: '2026-09-20', isOffDay: false }]).isOffDay, false);
  assert.equal(classifyHolidayDate(chinaTime('2026-09-28'), [off('2026-09-25')]).isOffDay, false);
});

test('请假状态继续由账号流程跳过', () => {
  assert.equal(isOnLeave({ current: { details: [{ desc: '上班', statusDesc: '请假' }] } }, 'morning'), true);
});


test('Cookie 过期通知隐藏 Token 并停止重试，权限和网络错误保持区分', async () => {
  const { makeApiError, withRetry, buildNotificationContent } = script.exports;
  const secret = '22222222-2222-4222-8222-222222222222';
  const error = makeApiError(401, { msg: `Invalid access token: ${secret}`, code: 401 });
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw error; }, 'test', 3, 1), { code: 'AUTH_EXPIRED' });
  assert.equal(calls, 1);
  const notice = buildNotificationContent([{ accountName: 'HIK_DAKA_TOKEN_2', status: 'failed', message: error.message }]);
  assert.match(notice, /登录已过期或失效/);
  assert.match(notice, /管理页更新 Cookie/);
  assert.equal(notice.includes(secret), false);
  assert.equal(makeApiError(200, { code: 401 }).code, 'AUTH_EXPIRED');
  assert.equal(makeApiError(200, { code: 999999, msg: '您的登录状态已失效，请重新登录' }).code, 'AUTH_EXPIRED');
  assert.notEqual(makeApiError(200, { code: 999999, msg: '其他业务错误' }).code, 'AUTH_EXPIRED');
  assert.notEqual(makeApiError(403, { msg: '无权限' }).code, 'AUTH_EXPIRED');
  assert.notEqual(makeApiError(500, { msg: '服务异常' }).code, 'AUTH_EXPIRED');
  assert.equal(makeApiError(500, { msg: secret }).message.includes(secret), false);
});
