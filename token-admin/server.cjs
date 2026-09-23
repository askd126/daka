#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const HOST = process.env.TOKEN_ADMIN_HOST || '0.0.0.0';
const PORT = Number(process.env.TOKEN_ADMIN_PORT || 5710);
const QL_CONTAINER = process.env.QL_CONTAINER || 'qinglong';
const HELPER_PATH = '/ql/data/scripts/ql_token_admin.cjs';
const CORE_PATH = '/ql/data/scripts/hik_daka.js';
const LOCAL_HELPER_PATH = path.join(__dirname, 'ql_token_admin.cjs');
const PUBLIC_DIR = path.join(__dirname, 'public');
const CSRF_TOKEN = crypto.randomBytes(32).toString('hex');
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let queue = Promise.resolve();
const rateWindow = [];

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('TOKEN_ADMIN_PORT 必须是 1 到 65535 之间的整数');
}

const securityHeaders = {
  'Cache-Control': 'no-store',
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
    'exec', '-i', QL_CONTAINER, 'node', HELPER_PATH,
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

const enqueue = (operation) => {
  const current = queue.then(operation, operation);
  queue = current.catch(() => {});
  return current;
};

const allowSubmission = () => {
  const now = Date.now();
  while (rateWindow.length && now - rateWindow[0] > 60000) rateWindow.shift();
  if (rateWindow.length >= 10) return false;
  rateWindow.push(now);
  return true;
};

const prepareQingLong = () => {
  const coreCheck = spawnSync('docker', [
    'exec', QL_CONTAINER, 'test', '-f', CORE_PATH,
  ], {
    windowsHide: true,
    encoding: 'utf8',
  });
  if (coreCheck.error) {
    throw new Error(`无法执行 Docker：${coreCheck.error.message}`);
  }
  if (coreCheck.status !== 0) {
    throw new Error(`青龙容器 ${QL_CONTAINER} 中未找到 ${CORE_PATH}，请先运行青龙订阅`);
  }

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

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${HOST}:${PORT}`);
    if (req.method === 'GET' && requestUrl.pathname === '/') {
      serveStatic(res, 'index.html', 'text/html; charset=utf-8', { '{{CSRF_TOKEN}}': CSRF_TOKEN });
      return;
    }
    if (req.method === 'GET' && requestUrl.pathname === '/styles.css') {
      serveStatic(res, 'styles.css', 'text/css; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && requestUrl.pathname === '/app.js') {
      serveStatic(res, 'app.js', 'text/javascript; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && requestUrl.pathname === '/api/status') {
      sendJson(res, 200, await runHelper({ action: 'status' }));
      return;
    }
    if (req.method === 'POST' && requestUrl.pathname === '/api/tokens') {
      if (req.headers['x-csrf-token'] !== CSRF_TOKEN) {
        sendJson(res, 403, { success: false, error: '页面验证已失效，请刷新后重试' });
        return;
      }
      if (req.headers['content-type']?.split(';', 1)[0] !== 'application/json') {
        sendJson(res, 415, { success: false, error: '仅接受 JSON 请求' });
        return;
      }
      if (!allowSubmission()) {
        sendJson(res, 429, { success: false, error: '操作过于频繁，请稍后重试' });
        return;
      }
      const body = await readJson(req);
      const token = String(body.token || '').trim();
      if (!TOKEN_PATTERN.test(token)) {
        sendJson(res, 400, { success: false, error: 'Token 格式不正确，应为 36 位 UUID' });
        return;
      }
      const result = await enqueue(() => runHelper({ action: 'submit', token }));
      sendJson(res, 200, result);
      return;
    }
    sendJson(res, 404, { success: false, error: '页面不存在' });
  } catch (error) {
    sendJson(res, 500, { success: false, error: error.message || '服务器异常' });
  }
});

try {
  prepareQingLong();
  server.listen(PORT, HOST, () => {
    console.log(`Token 管理页已启动：http://${HOST}:${PORT}`);
  });
} catch (error) {
  console.error(`Token 管理页启动失败：${error.message}`);
  process.exitCode = 1;
}
