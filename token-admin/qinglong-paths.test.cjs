const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { resolveCorePath, findQingLongCore } = require('./ql_token_admin.cjs');

const fixture = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qinglong-path-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const add = (relative) => {
    const filename = path.join(root, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, 'module.exports = {};');
    return fs.realpathSync(filename);
  };
  return { root, add };
};

test('兼容根目录与订阅仓库内的核心脚本，重复根目录不会产生歧义', (t) => {
  const { root, add } = fixture(t);
  const nested = add('askd126_daka/qinglong/hik_daka.js');
  assert.equal(resolveCorePath({ roots: [root, root], explicitPath: '' }), nested);
  fs.unlinkSync(nested);
  const flat = add('hik_daka.js');
  assert.equal(resolveCorePath({ roots: [root], explicitPath: '' }), flat);
});

test('多份核心脚本要求显式选择，不能静默使用旧副本', (t) => {
  const { root, add } = fixture(t);
  const first = add('github/qinglong/hik_daka.js');
  const second = add('gitee/qinglong/hik_daka.js');
  assert.throws(() => resolveCorePath({ roots: [root], explicitPath: '' }), /找到多份/);
  assert.equal(resolveCorePath({ roots: [root], explicitPath: second }), second);
  assert.equal(resolveCorePath({ roots: [], explicitPath: first }), first);
});

test('缺失核心、错误覆盖路径和相对路径给出具体错误', (t) => {
  const { root } = fixture(t);
  assert.throws(() => resolveCorePath({ roots: [root], explicitPath: '' }), /未找到 hik_daka.js/);
  assert.throws(() => resolveCorePath({ explicitPath: path.join(root, 'missing.js') }), /指定的青龙核心脚本不存在/);
  assert.throws(() => resolveCorePath({ explicitPath: 'relative/hik_daka.js' }), /绝对路径/);
});

test('忽略依赖目录中的同名文件', (t) => {
  const { root, add } = fixture(t);
  const core = add('repository/qinglong/hik_daka.js');
  add('repository/node_modules/package/hik_daka.js');
  assert.equal(resolveCorePath({ roots: [root], explicitPath: '' }), core);
});

test('Docker 检查传递覆盖路径并保留容器原始错误', () => {
  let called = false;
  const explicitPath = '/ql/data/scripts/repo/qinglong/hik_daka.js';
  const resolved = findQingLongCore('my-qinglong', explicitPath, (command, args) => {
    called = true;
    assert.equal(command, 'docker');
    assert.deepEqual(args.slice(0, 4), ['exec', 'my-qinglong', 'node', '-e']);
    assert.equal(args.at(-1), explicitPath);
    assert.match(args[4], /resolveCorePath/);
    return { status: 0, stdout: `${explicitPath}\n` };
  });
  assert.equal(called, true);
  assert.equal(resolved, explicitPath);
  assert.throws(() => findQingLongCore('stopped', '', () => ({ status: 1, stderr: 'container is not running' })), /container is not running/);
  assert.throws(() => findQingLongCore('missing', '', () => ({ error: new Error('spawn docker ENOENT') })), /ENOENT/);
});
