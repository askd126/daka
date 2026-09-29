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

test('独立周末的决定跨班次稳定，长期比例接近 80%', () => {
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
  assert.ok(punchDays / weekendDays > 0.75 && punchDays / weekendDays < 0.85);
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
