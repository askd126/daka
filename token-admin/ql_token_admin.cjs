#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// This resolver runs inside Qinglong; host filesystem paths do not apply.
const resolveCorePath = ({
  roots = ['/ql/data/scripts', '/ql/scripts'],
  explicitPath = process.env.QL_HIK_DAKA_PATH || '',
} = {}) => {
  if (explicitPath) {
    if (!path.isAbsolute(explicitPath)) throw new Error('QL_HIK_DAKA_PATH 必须是容器内的绝对路径');
    if (!fs.existsSync(explicitPath) || !fs.statSync(explicitPath).isFile()) {
      throw new Error(`指定的青龙核心脚本不存在：${explicitPath}`);
    }
    return fs.realpathSync(explicitPath);
  }
  const found = new Set();
  const visited = new Set();
  const scan = (directory, depth) => {
    if (!fs.existsSync(directory)) return;
    const realDirectory = fs.realpathSync(directory);
    if (visited.has(realDirectory)) return;
    visited.add(realDirectory);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.name === 'hik_daka.js' && fs.statSync(filename).isFile()) {
        found.add(fs.realpathSync(filename));
      } else if (depth < 8 && entry.isDirectory() &&
          !['node_modules', '.git', '.cache', '__pycache__'].includes(entry.name)) {
        scan(filename, depth + 1);
      }
    }
  };
  for (const root of roots) scan(root, 0);
  const candidates = [...found].sort();
  if (!candidates.length) {
    throw new Error(`青龙脚本目录中未找到 hik_daka.js（已检查 ${roots.join('、')} 及订阅子目录），请先运行本项目订阅`);
  }
  if (candidates.length > 1) {
    throw new Error(`找到多份 hik_daka.js，请通过 QL_HIK_DAKA_PATH 或安装参数 --core-path 指定：\n${candidates.join('\n')}`);
  }
  return candidates[0];
};

const findQingLongCore = (container, explicitPath = '', run = spawnSync) => {
  const code = `const fs = require('node:fs'); const path = require('node:path');
const resolveCorePath = ${resolveCorePath.toString()};
try { console.log(resolveCorePath({ explicitPath: process.argv[1] || '' })); }
catch (error) { console.error(error.message); process.exitCode = 1; }`;
  const result = run('docker', ['exec', container, 'node', '-e', code, explicitPath], {
    windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
  });
  if (result.error) throw new Error(`无法检查青龙容器 ${container}：${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(String(result.stderr || '').trim() || `青龙容器 ${container} 检查失败（退出码 ${result.status}）`);
  }
  const resolved = String(result.stdout || '').trim();
  if (!resolved.startsWith('/') || resolved.includes('\n')) throw new Error('青龙返回的核心脚本路径无效');
  return resolved;
};

// Keep path discovery importable on the host without loading container-only modules.
let ql;
let getAccount;
let attendance;
const loadQingLong = () => {
  if (ql) return;
  const corePath = process.env.QL_HIK_DAKA_PATH || resolveCorePath();
  attendance = require(corePath);
  ({ getAccount } = attendance);
  ql = require('/ql/shell/preload/client.js');
};

const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENV_PATTERN = /^HIK_DAKA_TOKEN(?:_\d+)?$/;
const PUSH_ENV_PATTERN = /^HIK_DAKA_PUSH_KEY(?:_\d+)?$/;
// Server酱 SendKey：旧版以 SCT 开头，Turbo 版形如 sctp<N>t...
const SEND_KEY_PATTERN = /^(?:sctp\d+t[0-9a-z]+|sct[0-9a-z]+)$/i;

// HIK_DAKA_TOKEN_3 ↔ HIK_DAKA_PUSH_KEY_3，与 hik_daka.js 的配对规则保持一致。
const pushEnvNameFor = (tokenEnvName) => tokenEnvName.replace('HIK_DAKA_TOKEN', 'HIK_DAKA_PUSH_KEY');
const accountIdOf = (account) => String(account?.accountNo || '').trim();
const accountIdFromRemarks = (remarks) => {
  const matched = String(remarks || '').match(/\[hik-account:([^\]]+)\]/);
  if (!matched) return '';
  try { return decodeURIComponent(matched[1]); } catch { return ''; }
};
const tokenRemarks = (accountName, accountId) =>
  `海康考勤 Token - ${accountName} [hik-account:${encodeURIComponent(accountId)}]`;

const readRequest = () => new Promise((resolve, reject) => {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    input += chunk;
    if (input.length > 8192) reject(new Error('请求内容过大'));
  });
  process.stdin.on('end', () => {
    try {
      resolve(JSON.parse(input || '{}'));
    } catch {
      reject(new Error('请求格式无效'));
    }
  });
  process.stdin.on('error', reject);
});

const getEnvList = async (searchValue, pattern) => {
  const response = await ql.getEnvs({ searchValue });
  if (response.code !== 200) throw new Error(response.message || '读取青龙环境变量失败');
  return (response.data || [])
    .filter((item) => pattern.test(item.name))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true }));
};

const nextEnvName = (items) => {
  const names = new Set(items.map((item) => item.name));
  if (!names.has('HIK_DAKA_TOKEN')) return 'HIK_DAKA_TOKEN';
  let index = 2;
  while (names.has(`HIK_DAKA_TOKEN_${index}`)) index += 1;
  return `HIK_DAKA_TOKEN_${index}`;
};

const createEnvs = async (envs) => {
  const response = await ql.createEnv({ envs });
  if (response.code !== 200) throw new Error(response.message || '保存到青龙失败');
};

// 青龙不同版本 updateEnv 的入参形状不同（{ env } 或 { envs: [env] }），
// 且有的版本对不认识的形状会直接 throw 而不是返回错误码，两种形状各试一次。
const updateEnvValue = async (existing, name, value, remarks) => {
  if (typeof ql.updateEnv !== 'function') {
    throw new Error(`当前青龙版本不支持更新环境变量，请在面板里手动修改 ${name}`);
  }
  const env = {
    id: existing.id,
    name,
    value,
    remarks,
    status: existing.status ?? 0,
    position: existing.position,
  };
  let firstError = null;
  try {
    const first = await ql.updateEnv({ env });
    if (first?.code === 200) return;
    firstError = new Error(first?.message || '更新青龙环境变量失败');
  } catch (error) {
    firstError = error;
  }
  try {
    const second = await ql.updateEnv({ envs: [env] });
    if (second?.code === 200) return;
  } catch {
    // 第二次失败的根因在第一次，统一抛 firstError
  }
  throw firstError || new Error('更新青龙环境变量失败');
};

// 老环境变量没有账号 ID 备注时，用仍有效的旧 Token 查询账号 ID；失效的旧 Token 无法自动判定身份。
const findExistingAccount = async (envs, token, accountId) => {
  const exact = envs.find((item) => String(item.value || '').trim() === token);
  if (exact) return { existing: exact, unverifiedCount: 0 };
  if (!accountId) return { existing: null, unverifiedCount: 0 };

  const tagged = envs.find((item) => accountIdFromRemarks(item.remarks) === accountId);
  if (tagged) return { existing: tagged, unverifiedCount: 0 };

  const legacy = envs.filter((item) => !accountIdFromRemarks(item.remarks));
  const results = await Promise.allSettled(legacy.map((item) =>
    getAccount(String(item.value || '').trim(), 6000)));
  let unverifiedCount = 0;
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (result.status === 'rejected' || !accountIdOf(result.value)) {
      unverifiedCount += 1;
    } else if (accountIdOf(result.value) === accountId) {
      return { existing: legacy[index], unverifiedCount };
    }
  }
  return { existing: null, unverifiedCount };
};

const handleRequest = async (request) => {
  loadQingLong();
  const envs = await getEnvList('HIK_DAKA_TOKEN', ENV_PATTERN);
  const pushEnvs = await getEnvList('HIK_DAKA_PUSH_KEY', PUSH_ENV_PATTERN);

  if (request.action === 'profile') {
    const expected = String(request.accountId || '');
    if (!expected) throw new Error('未登录');
    const env = envs.find(item => item.name === request.envName && accountIdFromRemarks(item.remarks) === expected);
    let token = env ? String(env.value || '').trim() : String(request.token || '');
    let account;
    let accountError = '';
    try { account = await getAccount(token, 10000); }
    catch (error) {
      accountError = error.message;
      if (request.token && token !== request.token) {
        token = request.token;
        try { account = await getAccount(token, 10000); accountError = ''; } catch (fallback) { accountError = fallback.message; }
      }
    }
    if (account && accountIdOf(account) !== expected) throw new Error('账号会话不匹配，请重新登录');
    const result = { success: true, bound: !!env, accountName: String(account?.nickName || account?.name || request.accountName || ''), personName: '', teamNo: request.teamNo || '', today: [], history: [], rule: '', attendanceError: accountError };
    try {
      if (accountError) throw new Error(accountError);
      if (!attendance.getTodayStatus || !attendance.getRule) throw new Error('请更新考勤核心脚本后查看打卡状态');
      const [today, rule] = await Promise.all([attendance.getTodayStatus(token, 10000), attendance.getRule(token, 10000)]);
      result.personName = String(today.personName || '');
      result.today = attendance.getTodayDetails(today);
      result.rule = rule;
    } catch (error) { result.attendanceError = error.message; }
    const filename = '/ql/data/config/hik-attendance-history.jsonl';
    if (fs.existsSync(filename)) {
      const size = fs.statSync(filename).size;
      const fd = fs.openSync(filename, 'r');
      try {
        const buffer = Buffer.alloc(Math.min(size, 256 * 1024));
        fs.readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length));
        result.history = buffer.toString('utf8').split(/\r?\n/).flatMap(line => {
          try { const row = JSON.parse(line); return row.accountId === expected ? [{ at: row.at, shift: row.shift, status: row.status, message: row.message, details: row.details || [] }] : []; }
          catch { return []; }
        }).slice(-20).reverse();
      } finally { fs.closeSync(fd); }
    }
    if (!result.history.length) {
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      result.history = result.today.filter(item => item.clocked && /^\d{2}:\d{2}$/.test(item.clockTime || '')).map(item => ({
        at: `${day}T${item.clockTime}:00+08:00`, shift: String(item.desc).includes('下班') ? 'evening' : 'morning',
        status: 'recorded', message: `${item.desc} ${item.clockTime} ${item.statusDesc || '已打卡'}`, details: [item],
      })).reverse();
    }
    return result;
  }
  if (request.action === 'current') {
    const env = envs.find(item => item.name === request.envName);
    if (!env) throw new Error('绑定的账号变量不存在');
    return { success: true, token: String(env.value || '').trim() };
  }

  if (request.action === 'status') {
    return {
      success: true,
      count: envs.length,
      pushKeyCount: pushEnvs.length,
      envNames: envs.map((item) => item.name),
    };
  }

  if (request.action !== 'check' && request.action !== 'submit') throw new Error('不支持的操作');
  const token = String(request.token || '').trim();
  if (!TOKEN_PATTERN.test(token)) throw new Error('Token 格式不正确，应为 36 位 UUID');

  const exact = envs.find((item) => String(item.value || '').trim() === token);

  const account = await getAccount(token, 30000);
  const accountName = String(account?.nickName || account?.name || account?.accountNo || '未知账号');
  const accountId = accountIdOf(account);
  if (!accountId) throw new Error('海康接口未返回账号 ID，无法安全检查是否已存在');
  if (request.expectedAccountId && request.expectedAccountId !== accountId) throw new Error('不能修改其他账号');
  const { existing: duplicate, unverifiedCount } = await findExistingAccount(envs, token, accountId);
  const pushEnvName = duplicate ? pushEnvNameFor(duplicate.name) : '';
  const existingPush = duplicate && pushEnvs.find((item) => item.name === pushEnvName);
  const sameToken = !!duplicate && String(duplicate.value || '').trim() === token;

  if (request.action === 'check') {
    return { success: true, exists: !!duplicate, sameToken, envName: duplicate?.name || '',
      accountId, accountName, hasPushKey: !!existingPush, unverifiedCount };
  }

  const sendKey = String(request.sendKey || '').trim();
  if (sendKey && !SEND_KEY_PATTERN.test(sendKey)) {
    throw new Error('SendKey 格式不正确，应为 SCT 开头或 sctp<N>t 开头的 Server酱密钥');
  }

  if (duplicate) {
    if (sameToken && !sendKey) {
      return {
        success: true,
        duplicate: true,
        sameToken: true,
        envName: duplicate.name,
        accountName,
        count: envs.length,
        pushKeyCount: pushEnvs.length,
        hasPushKey: !!existingPush,
      };
    }
    if (request.confirmExisting !== true) {
      return { success: true, duplicate: true, requiresConfirmation: true,
        sameToken, envName: duplicate.name, accountName, hasPushKey: !!existingPush };
    }

    // 账号 ID 相同时更新原 Token；SendKey 留空时完全不触碰原通知变量。
    if (!sameToken) {
      await updateEnvValue(duplicate, duplicate.name, token, tokenRemarks(accountName, accountId));
    }
    const remarks = `Server酱 SendKey - ${accountName}`;
    if (sendKey) {
      if (existingPush) {
        await updateEnvValue(existingPush, pushEnvName, sendKey, remarks);
      } else {
        await createEnvs([{ name: pushEnvName, value: sendKey, remarks }]);
      }
    }
    return {
      success: true,
      duplicate: true,
      updatedToken: !sameToken,
      updatedPushKey: !!sendKey,
      envName: duplicate.name,
      pushEnvName,
      accountName,
      count: envs.length,
      pushKeyCount: existingPush || !sendKey ? pushEnvs.length : pushEnvs.length + 1,
      hasPushKey: !!existingPush || !!sendKey,
    };
  }

  if (unverifiedCount && request.confirmNewWithUnknown !== true) {
    return { success: true, exists: false, requiresConfirmation: true,
      checkIncomplete: true, unverifiedCount, accountName };
  }

  const envName = nextEnvName(envs);
  const newPushEnvName = pushEnvNameFor(envName);
  const newEnvs = [{ name: envName, value: token, remarks: tokenRemarks(accountName, accountId) }];
  if (sendKey) newEnvs.push({ name: newPushEnvName, value: sendKey, remarks: `Server酱 SendKey - ${accountName}` });
  await createEnvs(newEnvs);

  return {
    success: true,
    duplicate: false,
    envName,
    pushEnvName: sendKey ? newPushEnvName : '',
    accountName,
    count: envs.length + 1,
    pushKeyCount: pushEnvs.length + (sendKey ? 1 : 0),
    hasPushKey: !!sendKey,
  };
};

if (require.main === module && process.argv[2] === '--resolve-container') {
  try {
    console.log(findQingLongCore(process.argv[3] || 'qinglong', process.argv[4] || process.env.QL_HIK_DAKA_PATH || ''));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else if (require.main === module) {
  readRequest()
    .then(handleRequest)
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.log(JSON.stringify({ success: false, error: error.message }));
      process.exitCode = 1;
    })
    .finally(() => ql?.close());
}

module.exports = { handleRequest, resolveCorePath, findQingLongCore };
