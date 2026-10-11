#!/usr/bin/env node

'use strict';

const ql = require('/ql/shell/preload/client.js');
const { getAccount } = require('/ql/data/scripts/hik_daka.js');

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
  const envs = await getEnvList('HIK_DAKA_TOKEN', ENV_PATTERN);
  const pushEnvs = await getEnvList('HIK_DAKA_PUSH_KEY', PUSH_ENV_PATTERN);

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
  if (request.action === 'check' && exact) {
    const pushEnvName = pushEnvNameFor(exact.name);
    return { success: true, exists: true, sameToken: true, envName: exact.name,
      hasPushKey: pushEnvs.some((item) => item.name === pushEnvName), unverifiedCount: 0 };
  }

  const account = await getAccount(token, 30000);
  const accountName = String(account?.nickName || account?.name || account?.accountNo || '未知账号');
  const accountId = accountIdOf(account);
  if (!accountId && !exact) throw new Error('海康接口未返回账号 ID，无法安全检查是否已存在');
  const { existing: duplicate, unverifiedCount } = await findExistingAccount(envs, token, accountId);
  const pushEnvName = duplicate ? pushEnvNameFor(duplicate.name) : '';
  const existingPush = duplicate && pushEnvs.find((item) => item.name === pushEnvName);
  const sameToken = !!duplicate && String(duplicate.value || '').trim() === token;

  if (request.action === 'check') {
    return { success: true, exists: !!duplicate, sameToken, envName: duplicate?.name || '',
      accountName, hasPushKey: !!existingPush, unverifiedCount };
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

if (require.main === module) {
  readRequest()
    .then(handleRequest)
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.log(JSON.stringify({ success: false, error: error.message }));
      process.exitCode = 1;
    })
    .finally(() => ql.close());
}

module.exports = { handleRequest };
