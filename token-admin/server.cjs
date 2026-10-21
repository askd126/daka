#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { findQingLongCore } = require('./ql_token_admin.cjs');

const { AutoLogin } = require('./auto-login.cjs');
const { Sessions } = require('./sessions.cjs');
const HOST = process.env.TOKEN_ADMIN_HOST || '0.0.0.0';
const PORT = Number(process.env.TOKEN_ADMIN_PORT || 5710);
const QL_CONTAINER = process.env.QL_CONTAINER || 'qinglong';
const HELPER_PATH = '/ql/data/scripts/ql_token_admin.cjs';
let corePath;
const LOCAL_HELPER_PATH = path.join(__dirname, 'ql_token_admin.cjs');
const PUBLIC_DIR = path.join(__dirname, 'public');
const CSRF_TOKEN = crypto.randomBytes(32).toString('hex');
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEND_KEY_PATTERN = /^(?:sctp\d+t[0-9a-z]+|sct[0-9a-z]+)$/i;


if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('TOKEN_ADMIN_PORT 必须是 1 到 65535 之间的整数');
}

const securityHeaders = {
  'Cache-Control': 'no-store',
  'Vary': 'Cookie',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

const sendJson = (res, status, body) => {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    ...securityHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
  });
  res.end(data);
};

const readJson = (req) => new Promise((resolve, reject) => {
  let input = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    input += chunk;
    if (input.length > 4096) {
      reject(new Error('请求内容过大'));
      req.destroy();
    }
  });
  req.on('end', () => {
    try {
      resolve(JSON.parse(input || '{}'));
    } catch {
      reject(new Error('请求格式无效'));
    }
  });
  req.on('error', reject);
});

const runHelper = (payload) => new Promise((resolve, reject) => {
  const child = spawn('docker', [
    'exec', '-i', '-e', `QL_HIK_DAKA_PATH=${corePath}`, QL_CONTAINER, 'node', HELPER_PATH,
  ], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  const timer = setTimeout(() => {
    child.kill();
    reject(new Error('青龙响应超时'));
  }, 45000);

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', (error) => {
    clearTimeout(timer);
    reject(new Error(`无法连接青龙容器：${error.message}`));
  });
  child.on('close', () => {
    clearTimeout(timer);
    const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
    try {
      const result = JSON.parse(line || '{}');
      if (!result.success) reject(new Error(result.error || '青龙操作失败'));
      else resolve(result);
    } catch (error) {
      reject(new Error(stderr.trim() || error.message || '青龙返回内容无效'));
    }
  });
  child.stdin.end(`${JSON.stringify(payload)}\n`);
});

const prepareQingLong = () => {
  corePath = findQingLongCore(QL_CONTAINER, process.env.QL_HIK_DAKA_PATH || '');
  const copyResult = spawnSync('docker', [
    'cp', LOCAL_HELPER_PATH, `${QL_CONTAINER}:${HELPER_PATH}`,
  ], {
    windowsHide: true,
    encoding: 'utf8',
  });
  if (copyResult.error) {
    throw new Error(`无法安装青龙辅助脚本：${copyResult.error.message}`);
  }
  if (copyResult.status !== 0) {
    throw new Error(copyResult.stderr.trim() || '安装青龙辅助脚本失败');
  }
  console.log(`青龙核心脚本：${corePath}`);
};

const serveStatic = (res, filename, contentType, replacements = {}) => {
  let content = fs.readFileSync(path.join(PUBLIC_DIR, filename));
  if (Object.keys(replacements).length) {
    let text = content.toString('utf8');
    for (const [key, value] of Object.entries(replacements)) text = text.replaceAll(key, value);
    content = Buffer.from(text);
  }
  res.writeHead(200, {
    ...securityHeaders,
    'Content-Type': contentType,
    'Content-Length': content.length,
  });
  res.end(content);
};

const installRecoveryBridge = autoLogin => {
  fs.mkdirSync(autoLogin.directory, { recursive: true, mode: 0o700 });
  const keyPath = path.join(autoLogin.directory, 'bridge-key');
  if (!fs.existsSync(keyPath)) fs.writeFileSync(keyPath, crypto.randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
  const bridgeKey = fs.readFileSync(keyPath, 'utf8');
  const inspected = spawnSync('docker', ['inspect', '-f', '{{range .NetworkSettings.Networks}}{{println .Gateway}}{{end}}', QL_CONTAINER], { encoding: 'utf8', windowsHide: true });
  const gateway = inspected.stdout?.trim().split(/\s+/)[0];
  if (inspected.status !== 0 || !/^[0-9.]+$/.test(gateway || '')) throw new Error('无法获取青龙容器网关');
  const filename = path.join(autoLogin.directory, 'bridge.json');
  fs.writeFileSync(filename, JSON.stringify({ url: `http://${gateway}:${PORT}/api/auto-login/recover`, key: bridgeKey }), { mode: 0o600 });
  const copied = spawnSync('docker', ['cp', filename, `${QL_CONTAINER}:/ql/data/config/hik-auto-login-bridge.json`], { encoding: 'utf8', windowsHide: true });
  if (copied.status !== 0) throw new Error('无法安装自动登录恢复桥接');
  const secured = spawnSync('docker', ['exec', QL_CONTAINER, 'chmod', '600', '/ql/data/config/hik-auto-login-bridge.json'], { encoding: 'utf8', windowsHide: true });
  if (secured.status !== 0) throw new Error('无法保护恢复桥接凭据');
  return bridgeKey;
};

const createApp = ({ helper, manager, sessions, csrfToken = CSRF_TOKEN, secureCookies = false, recoveryKey = '' }) => {
  const limit = maximum => { const entries = []; return () => { const now = Date.now(); while (entries.length && now - entries[0] > 60000) entries.shift(); if (entries.length >= maximum) return false; entries.push(now); return true; }; };
  const allowSubmission = limit(10);
  const allowStatusCheck = limit(20);
  let pending = Promise.resolve();
  const enqueue = operation => { const result = pending.then(operation, operation); pending = result.catch(() => {}); return result; };
  const safeResult = data => Object.fromEntries(Object.entries({
    success: data.success, exists: data.exists, sameToken: data.sameToken, envName: data.envName,
    accountName: data.accountName, hasPushKey: data.hasPushKey, duplicate: data.duplicate,
    updatedToken: data.updatedToken, updatedPushKey: data.updatedPushKey,
    requiresConfirmation: data.requiresConfirmation, checkIncomplete: !!(data.checkIncomplete || data.unverifiedCount),
    disabled: data.disabled,
  }).filter(([, value]) => value !== undefined));
  const profile = async session => {
    const data = await helper({ action: 'profile', accountId: session.accountId, envName: session.envName,
      token: session.token, teamNo: session.teamNo, accountName: session.accountName });
    const { success, bound, ...account } = data;
    return { account, autoLogin: bound ? manager.status(session.envName)[0] || null : null };
  };
  const app = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const session = sessions.get(req);
      const csrf = session?.csrf || csrfToken;
      const secure = secureCookies || !!req.socket.encrypted;
      if (req.method === 'GET' && url.pathname === '/') {
        serveStatic(res, 'index.html', 'text/html; charset=utf-8', { '{{CSRF_TOKEN}}': csrf }); return;
      }
      const assets = { '/styles.css': ['styles.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'], '/auto-login.js': ['auto-login.js', 'text/javascript'], '/session.js': ['session.js', 'text/javascript'] };
      if (req.method === 'GET' && assets[url.pathname]) {
        const [filename, mime] = assets[url.pathname]; serveStatic(res, filename, mime + '; charset=utf-8'); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        sendJson(res, 200, { success: true }); return; // Public connectivity only, no account totals.
      }
      if (req.method === 'GET' && url.pathname === '/api/session') {
        if (!session) { sendJson(res, 200, { success: true, authenticated: false, csrfToken }); return; }
        if (!allowStatusCheck()) { sendJson(res, 429, { success: false, error: '刷新过于频繁，请稍后重试' }); return; }
        const own = await profile(session);
        sendJson(res, 200, { success: true, authenticated: true, csrfToken: csrf, ...own }); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/auto-login') {
        if (!session) { sendJson(res, 401, { success: false, error: '请先登录本人账号' }); return; }
        if (!allowStatusCheck()) { sendJson(res, 429, { success: false, error: '刷新过于频繁' }); return; }
        const own = await profile(session);
        sendJson(res, 200, { success: true, accounts: own.autoLogin ? [own.autoLogin] : [] }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/auto-login/recover') {
        const actual = Buffer.from(req.headers.authorization || '');
        const expected = Buffer.from(`Bearer ${recoveryKey}`);
        if (!recoveryKey || actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
          sendJson(res, 403, { success: false, error: '恢复请求未授权' }); return;
        }
        if (!allowSubmission()) { sendJson(res, 429, { success: false, error: '操作过于频繁' }); return; }
        const body = await readJson(req);
        sendJson(res, 200, await enqueue(() => manager.recover(body.envName, body.token))); return;
      }
      const writes = ['/api/session/logout', '/api/accounts/check', '/api/tokens', '/api/auto-login'];
      if (req.method !== 'POST' || !writes.includes(url.pathname)) { sendJson(res, 404, { success: false, error: '页面不存在' }); return; }
      if (req.headers['x-csrf-token'] !== csrf) { sendJson(res, 403, { success: false, error: '页面验证已失效，请刷新后重试' }); return; }
      if (req.headers.origin) {
        const origin = new URL(req.headers.origin);
        if (origin.host !== req.headers.host) { sendJson(res, 403, { success: false, error: '请求来源无效' }); return; }
      }
      if (req.headers['content-type']?.split(';', 1)[0] !== 'application/json') { sendJson(res, 415, { success: false, error: '仅接受 JSON 请求' }); return; }
      if (!allowSubmission()) { sendJson(res, 429, { success: false, error: '操作过于频繁，请稍后重试' }); return; }
      const body = await readJson(req);
      if (url.pathname === '/api/session/logout') {
        sessions.logout(req, res, secure); sendJson(res, 200, { success: true, csrfToken }); return;
      }
      if (url.pathname === '/api/accounts/check') {
        const token = String(body.token || '').trim();
        if (!TOKEN_PATTERN.test(token)) { sendJson(res, 400, { success: false, error: 'Token 格式不正确，应为 36 位 UUID' }); return; }
        const data = await enqueue(() => helper({ action: 'check', token }));
        const own = sessions.issue(req, res, { accountId: data.accountId, accountName: data.accountName, envName: data.envName || '', token,
          teamNo: manager.records.find(item => item.envName === data.envName)?.teamNo || manager.defaultTeamNo || '' }, secure);
        sendJson(res, 200, { ...safeResult(data), csrfToken: own.csrf }); return;
      }
      if (url.pathname === '/api/tokens') {
        if (!session) { sendJson(res, 401, { success: false, error: '请先验证本人 Token' }); return; }
        const token = String(body.token || '').trim();
        const sendKey = String(body.sendKey || '').trim();
        if (!TOKEN_PATTERN.test(token)) { sendJson(res, 400, { success: false, error: 'Token 格式不正确' }); return; }
        if (sendKey && (sendKey.length > 64 || !SEND_KEY_PATTERN.test(sendKey))) { sendJson(res, 400, { success: false, error: 'SendKey 格式不正确' }); return; }
        const data = await enqueue(() => helper({ action: 'submit', token, sendKey, expectedAccountId: session.accountId,
          confirmExisting: body.confirmExisting === true, confirmNewWithUnknown: body.confirmNewWithUnknown === true }));
        if (!data.requiresConfirmation) {
          session.envName = data.envName; session.token = token; sessions.save();
        }
        sendJson(res, 200, { ...safeResult(data), csrfToken: csrf }); return;
      }
      if (body.enabled === false) {
        if (!session) { sendJson(res, 401, { success: false, error: '请先登录本人账号' }); return; }
        const own = await profile(session);
        const record = own.autoLogin && manager.records.find(item => item.envName === session.envName);
        if (!record || (body.username && String(body.username).trim() !== record.username)) {
          sendJson(res, 403, { success: false, error: '只能管理本人自动登录设置' }); return;
        }
        const data = await enqueue(() => manager.configure({ username: record.username, enabled: false }));
        sendJson(res, 200, safeResult(data)); return;
      }
      const data = await enqueue(() => manager.configure(body));
      const own = sessions.issue(req, res, { accountId: data.accountId, accountName: data.accountName, envName: data.envName || '', token: data.token, teamNo: data.teamNo }, secure);
      sendJson(res, 200, { ...safeResult(data), csrfToken: own.csrf });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error.message || '服务器异常' });
    }
  });
  app.enqueue = enqueue;
  return app;
};

if (require.main === module) {
  try {
    const autoLogin = new AutoLogin(runHelper);
    const sessions = new Sessions(autoLogin.directory);
    prepareQingLong();
    const recoveryKey = installRecoveryBridge(autoLogin);
    const server = createApp({ helper: runHelper, manager: autoLogin, sessions, recoveryKey, secureCookies: process.env.TOKEN_ADMIN_SECURE_COOKIE === '1' });
    const refresh = () => server.enqueue(() => autoLogin.refresh()).catch(() => console.error('自动登录状态保存失败'));
    refresh();
    setInterval(refresh, 60 * 60 * 1000).unref();
    server.listen(PORT, HOST, () => console.log(`Token 管理页已启动：http://${HOST}:${PORT}`));
  } catch (error) { console.error(`Token 管理页启动失败：${error.message}`); process.exitCode = 1; }
}
module.exports = { createApp };
