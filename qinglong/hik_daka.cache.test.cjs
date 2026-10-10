const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const https = require('node:https');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('节假日数据离线时使用缓存，无缓存则安全失败', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hik-daka-holiday-'));
  const cacheFile = path.join(cacheDir, '2026.json');
  fs.writeFileSync(cacheFile, JSON.stringify({
    year: 2026,
    days: [{ date: '2026-09-29', name: '测试假日', isOffDay: true }],
  }));

  const previousCacheDir = process.env.HIK_DAKA_CACHE_DIR;
  process.env.HIK_DAKA_CACHE_DIR = cacheDir;
  const filename = path.join(__dirname, 'hik_daka.js');
  const script = new Module(filename, module);
  script.filename = filename;
  script.paths = Module._nodeModulePaths(__dirname);
  script._compile(fs.readFileSync(filename, 'utf8'), filename);
  if (previousCacheDir === undefined) delete process.env.HIK_DAKA_CACHE_DIR;
  else process.env.HIK_DAKA_CACHE_DIR = previousCacheDir;

  const originalGet = https.get;
  https.get = () => {
    const request = new EventEmitter();
    queueMicrotask(() => request.emit('error', new Error('offline')));
    return request;
  };

  try {
    const date = new Date('2026-09-29T01:00:00Z');
    const status = await script.exports.getChinaHolidayStatus(date);
    assert.equal(status.isOffDay, true);
    assert.equal(status.name, '测试假日');

    fs.unlinkSync(cacheFile);
    await assert.rejects(script.exports.getChinaHolidayStatus(date), /offline/);
  } finally {
    https.get = originalGet;
    if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
    fs.rmdirSync(cacheDir);
  }
});
