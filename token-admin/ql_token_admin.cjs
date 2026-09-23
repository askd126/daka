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

// 青龙不同版本 updateEnv 的入参形状不同（{ env } 或 { envs: [env] }），两种都试。
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
  const first = await ql.updateEnv({ env });
  if (first?.code === 200) return;
  const second = await ql.updateEnv({ envs: [env] });
  if (second?.code === 200) return;
  throw new Error(first?.message || second?.message || '更新青龙环境变量失败');
};

const main = async () => {
  const request = await readRequest();
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

  if (request.action !== 'submit') throw new Error('不支持的操作');
  const token = String(request.token || '').trim();
  if (!TOKEN_PATTERN.test(token)) throw new Error('Token 格式不正确，应为 36 位 UUID');
  const sendKey = String(request.sendKey || '').trim();
  if (sendKey && !SEND_KEY_PATTERN.test(sendKey)) {
    throw new Error('SendKey 格式不正确，应为 SCT 开头或 sctp<N>t 开头的 Server酱密钥');
  }

  const account = await getAccount(token, 30000);
  const accountName = String(account?.nickName || account?.name || account?.accountNo || '未知账号');
  const duplicate = envs.find((item) => String(item.value || '').trim() === token);

  if (duplicate) {
    const pushEnvName = pushEnvNameFor(duplicate.name);
    const existing = pushEnvs.find((item) => item.name === pushEnvName);
    if (!sendKey) {
      return {
        success: true,
        duplicate: true,
        envName: duplicate.name,
        accountName,
        count: envs.length,
        pushKeyCount: pushEnvs.length,
        hasPushKey: !!existing,
      };
    }
    // 补配或更换这个账号的 SendKey，不用先删掉 Token 再重建。
    const remarks = `Server酱 SendKey - ${accountName}`;
    if (existing) {
      await updateEnvValue(existing, pushEnvName, sendKey, remarks);
    } else {
      await createEnvs([{ name: pushEnvName, value: sendKey, remarks }]);
    }
    return {
      success: true,
      duplicate: true,
      updatedPushKey: true,
      envName: duplicate.name,
      pushEnvName,
      accountName,
      count: envs.length,
      pushKeyCount: existing ? pushEnvs.length : pushEnvs.length + 1,
      hasPushKey: true,
    };
  }

  const envName = nextEnvName(envs);
  const pushEnvName = pushEnvNameFor(envName);
  const newEnvs = [{ name: envName, value: token, remarks: `海康考勤 Token - ${accountName}` }];
  if (sendKey) newEnvs.push({ name: pushEnvName, value: sendKey, remarks: `Server酱 SendKey - ${accountName}` });
  await createEnvs(newEnvs);

  return {
    success: true,
    duplicate: false,
    envName,
    pushEnvName: sendKey ? pushEnvName : '',
    accountName,
    count: envs.length + 1,
    pushKeyCount: pushEnvs.length + (sendKey ? 1 : 0),
    hasPushKey: !!sendKey,
  };
};

main()
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error) => {
    console.log(JSON.stringify({ success: false, error: error.message }));
    process.exitCode = 1;
  })
  .finally(() => ql.close());
