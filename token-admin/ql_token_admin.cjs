#!/usr/bin/env node

'use strict';

const ql = require('/ql/shell/preload/client.js');
const { getAccount } = require('/ql/data/scripts/hik_daka.js');

const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENV_PATTERN = /^HIK_DAKA_TOKEN(?:_\d+)?$/;

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

const getTokenEnvs = async () => {
  const response = await ql.getEnvs({ searchValue: 'HIK_DAKA_TOKEN' });
  if (response.code !== 200) throw new Error(response.message || '读取青龙环境变量失败');
  return (response.data || [])
    .filter((item) => ENV_PATTERN.test(item.name))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true }));
};

const nextEnvName = (items) => {
  const names = new Set(items.map((item) => item.name));
  if (!names.has('HIK_DAKA_TOKEN')) return 'HIK_DAKA_TOKEN';
  let index = 2;
  while (names.has(`HIK_DAKA_TOKEN_${index}`)) index += 1;
  return `HIK_DAKA_TOKEN_${index}`;
};

const main = async () => {
  const request = await readRequest();
  const envs = await getTokenEnvs();

  if (request.action === 'status') {
    return {
      success: true,
      count: envs.length,
      envNames: envs.map((item) => item.name),
    };
  }

  if (request.action !== 'submit') throw new Error('不支持的操作');
  const token = String(request.token || '').trim();
  if (!TOKEN_PATTERN.test(token)) throw new Error('Token 格式不正确，应为 36 位 UUID');

  const account = await getAccount(token, 30000);
  const accountName = String(account?.nickName || account?.name || account?.accountNo || '未知账号');
  const duplicate = envs.find((item) => String(item.value || '').trim() === token);
  if (duplicate) {
    return {
      success: true,
      duplicate: true,
      envName: duplicate.name,
      accountName,
      count: envs.length,
    };
  }

  const envName = nextEnvName(envs);
  const response = await ql.createEnv({
    envs: [{
      name: envName,
      value: token,
      remarks: `海康考勤 Token - ${accountName}`,
    }],
  });
  if (response.code !== 200) throw new Error(response.message || '保存到青龙失败');

  return {
    success: true,
    duplicate: false,
    envName,
    accountName,
    count: envs.length + 1,
  };
};

main()
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error) => {
    console.log(JSON.stringify({ success: false, error: error.message }));
    process.exitCode = 1;
  })
  .finally(() => ql.close());
