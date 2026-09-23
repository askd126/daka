#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const https = require('https');
const path = require('path');

const API_BASE = 'https://api.hikiot.com';
const SIGN_SALT = 'WE1mfER7artAoJEwXKaCjw==';

const DEFAULTS = {
  location: '江苏省南京市浦口区江浦街道南京农业大学滨江校区农学院南京农业大学(滨江校区)',
  address: '江苏省南京市浦口区江浦街道南京农业大学滨江校区农学院南京农业大学(滨江校区)',
  longitude: 118.636838,
  latitude: 32.011898,
  wifiName: 'NJAU',
  wifiMac: '58:ae:a8:32:59:90',
  randomRadius: 50,
  retries: 3,
  retryDelayMs: 5000,
  timeoutMs: 30000,
};

// 请假当天是否照常打卡：false = 请假不打卡，true = 请假也打卡。
// 这个开关直接改脚本，不通过青龙环境变量配置。
const ALLOW_LEAVE_DAYS = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timestamp = () => new Date().toLocaleString('zh-CN', { hour12: false });
const log = (message) => console.log(`[${timestamp()}] ${message}`);

const withRetry = async (operation, label, attempts = 2, delayMs = 2000) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        log(`${label}失败，${delayMs / 1000} 秒后重试`);
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
};

const readNumber = (name, fallback, { min = -Infinity, max = Infinity, integer = false } = {}) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`环境变量 ${name} 的值无效`);
  }
  return value;
};

const readBoolean = (name, fallback = false) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
};

const parseArgs = () => {
  const args = new Set(process.argv.slice(2));
  const readArg = (name) => {
    const prefix = `--${name}=`;
    const item = [...args].find((arg) => arg.startsWith(prefix));
    return item ? item.slice(prefix.length) : undefined;
  };
  return {
    checkOnly: args.has('--check'),
    shift: readArg('shift'),
    delaySeconds: Number(readArg('delay') || 0),
  };
};

const md5 = (value) => crypto.createHash('md5').update(value, 'utf8').digest('hex');

const getSign = (payload) => {
  const base = Object.keys(payload)
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join('&');
  return md5(md5(base).toUpperCase() + SIGN_SALT).toUpperCase();
};

const requestJson = (method, path, token, body, extraHeaders = {}, timeoutMs = DEFAULTS.timeoutMs) =>
  new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const url = new URL(path, API_BASE);
    const headers = {
      Authorization: `Bearer ${token}`,
      terminal: '0',
      'UNI-Request-Source': '4',
      Pragma: 'no-cache',
      'content-type': 'application/json',
      ...extraHeaders,
    };
    if (payload) headers['content-length'] = Buffer.byteLength(payload);

    const req = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method,
      headers,
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error('接口返回了无法解析的数据'));
        }
      });
    });

    req.on('timeout', () => req.destroy(new Error(`请求超过 ${timeoutMs}ms`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });

const requestPublicJson = (urlString, timeoutMs = 12000) =>
  new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const req = https.get(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'qinglong-hik-daka/1.0',
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`节假日数据 HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error('节假日数据无法解析'));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('查询节假日数据超时')));
    req.on('error', reject);
  });

const fetchHolidayYear = async (year) => {
  const sources = [
    `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`,
    `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`,
  ];
  let lastError;
  for (const source of sources) {
    try {
      const data = await requestPublicJson(source);
      if (Number(data?.year) !== year || !Array.isArray(data?.days)) {
        throw new Error(`${year} 年节假日数据格式不正确`);
      }
      return data;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`无法获取 ${year} 年节假日数据`);
};

const getChinaHolidayStatus = async (date = new Date()) => {
  const dayOfWeek = date.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return { isOffDay: false, weekendExcluded: true, name: '' };
  }

  const year = date.getFullYear();
  const dateKey = [
    year,
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
  // A December date can be affected by the following year's State Council notice.
  const years = date.getMonth() === 11 ? [year, year + 1] : [year];
  const datasets = [];
  for (const dataYear of years) datasets.push(await fetchHolidayYear(dataYear));
  const entry = datasets.flatMap((item) => item.days).find((item) => item.date === dateKey);
  return {
    isOffDay: entry?.isOffDay === true,
    weekendExcluded: false,
    name: entry?.name || '',
  };
};

const addRandomOffset = (latitude, longitude, radiusMeters) => {
  // sqrt(random) makes points uniformly distributed inside a circle.
  const distance = Math.sqrt(Math.random()) * radiusMeters;
  const angle = Math.random() * Math.PI * 2;
  const northMeters = Math.cos(angle) * distance;
  const eastMeters = Math.sin(angle) * distance;
  const latitudeOffset = northMeters / 111000;
  const longitudeScale = Math.max(0.01, Math.abs(Math.cos((latitude * Math.PI) / 180)));
  const longitudeOffset = eastMeters / (111000 * longitudeScale);
  return {
    latitude: latitude + latitudeOffset,
    longitude: longitude + longitudeOffset,
  };
};

const collectDetails = (status) => [
  ...(status?.current?.details || []),
  ...(status?.others || []).flatMap((item) => item?.details || []),
];

const getDetailLabel = (item) => `${item?.desc || ''} ${item?.name || ''} ${item?.clockName || ''}`;

const matchShift = (label, shift) => {
  if (shift === 'morning') return label.includes('上班') || label.includes('签到');
  if (shift === 'evening') return label.includes('下班') || label.includes('签退');
  return true;
};

const isAlreadyCheckedIn = (status, shift) => collectDetails(status).some((item) => {
  const statusText = String(item?.statusDesc || '');
  const completed = statusText.includes('已打卡') || statusText.includes('正常');
  if (!completed) return false;
  return matchShift(getDetailLabel(item), shift);
});

// 请假等各种“假”都不需要打卡。海康用 statusDesc 文本表达考勤结论，具体文案随企业配置变化。
const LEAVE_KEYWORDS = ['请假', '休假', '调休', '年假', '事假', '病假', '婚假', '产假', '陪产假', '丧假', '公假'];

// 请假只认今日记录：others 可能混入其它日期的记录，误判会导致漏打卡。
const getTodayDetails = (status) => {
  const currentDetails = status?.current?.details || [];
  if (currentDetails.length) return currentDetails;
  return (status?.others || []).flatMap((item) => item?.details || []);
};

const isOnLeave = (status, shift) => getTodayDetails(status).some((item) => {
  if (!matchShift(getDetailLabel(item), shift)) return false;
  const statusText = String(item?.statusDesc || '');
  return LEAVE_KEYWORDS.some((keyword) => statusText.includes(keyword));
});

// 通知里的班次行，例如「上班 08:30 → 08:16 正常」「上班 08:30 → 请假」
const formatShiftLine = (item) => {
  const desc = item?.desc || item?.name || item?.clockName || '班次';
  const label = item?.standardTime ? `${desc} ${item.standardTime}` : desc;
  const statusText = String(item?.statusDesc || '').trim();
  const clockTime = String(item?.clockTime || '').trim();
  const clocked = item?.clocked && clockTime && clockTime !== '--';
  const actual = clocked ? clockTime : (statusText || '未打卡');
  const suffix = clocked && statusText && statusText !== actual ? ` ${statusText}` : '';
  return `${label} → ${actual}${suffix}`;
};

const getAccount = async (token, timeoutMs) => {
  const result = await requestJson('GET', '/api-saas/v1/account/detail', token, undefined, {}, timeoutMs);
  if (result?.code !== 0 || !result?.data) throw new Error(result?.msg || 'Token 校验失败');
  return result.data;
};

const getRule = async (token, timeoutMs) => {
  const result = await requestJson(
    'GET',
    '/api-attendance/mobile-clock/v1/individual-clock-rules',
    token,
    undefined,
    {},
    timeoutMs,
  );
  if (result?.code !== 0) throw new Error(result?.msg || '获取考勤规则失败');
  return String(result?.data?.shiftDetail || '');
};

const getTodayStatus = async (token, timeoutMs) => {
  const result = await requestJson(
    'GET',
    '/api-attendance/mobile-clock/v1/require-commuting',
    token,
    undefined,
    {},
    timeoutMs,
  );
  if (result?.code !== 0) throw new Error(result?.msg || '获取今日状态失败');
  return result?.data || {};
};

const checkIn = async (token, config) => {
  const point = addRandomOffset(config.latitude, config.longitude, config.randomRadius);
  const payload = {
    deviceSerial: '',
    longitude: point.longitude,
    latitude: point.latitude,
    clockSite: config.location,
    address: config.address,
    deviceName: '微信小程序',
    wifiName: config.wifiName,
    wifiMac: config.wifiMac,
  };
  const headers = {
    sign: getSign(payload),
    timestamp: Date.now().toString(),
    authPerm: 'PUNCHCLOCKFUN',
    appNo: '__UNI__89A1A02',
  };
  return requestJson(
    'POST',
    '/api-attendance/mobile-clock/v1/normal',
    token,
    payload,
    headers,
    config.timeoutMs,
  );
};

const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const getConfiguredAccounts = (environment = process.env) => {
  const entries = Object.entries(environment)
    .filter(([name, value]) => /^HIK_DAKA_TOKEN(?:_\d+)?$/.test(name) && String(value || '').trim())
    .sort(([left], [right]) => {
      if (left === 'HIK_DAKA_TOKEN') return -1;
      if (right === 'HIK_DAKA_TOKEN') return 1;
      return left.localeCompare(right, 'zh-CN', { numeric: true });
    });

  const seen = new Set();
  return entries.flatMap(([envName, value]) => {
    const token = String(value).trim();
    if (seen.has(token)) return [];
    seen.add(token);
    return [{ envName, token }];
  });
};

const STATUS_ICONS = {
  success: '✅',
  skipped: '⏭️',
  failed: '❌',
};

// 优先显示考勤系统里的真实姓名，昵称放在括号里便于和环境变量备注对照。
const displayName = (result) => {
  const personName = String(result.personName || '').trim();
  const accountName = String(result.accountName || '').trim();
  if (personName && accountName && personName !== accountName) return `${personName}（${accountName}）`;
  return personName || accountName || '未知账号';
};

// 标题保持固定：sendNotify.js 的 SKIP_PUSH_TITLE 按标题精确匹配，改动会导致跳过规则失效。
const buildNotificationContent = (results, globalMessage = '') => {
  const lines = [];
  if (globalMessage) lines.push(globalMessage);

  for (const result of results) {
    lines.push(`${STATUS_ICONS[result.status] || 'ℹ️'} ${displayName(result)}：${result.message}`);
    if (result.rule) lines.push(`· 班次规则 ${result.rule}`);
    for (const item of (result.details || []).slice(0, 4)) {
      lines.push(`· ${formatShiftLine(item)}`);
    }
    if (result.attempts > 1) lines.push(`· 共尝试 ${result.attempts} 次`);
  }

  if (results.length) {
    const countOf = (status) => results.filter((item) => item.status === status).length;
    lines.push('', `成功 ${countOf('success')} 个，跳过 ${countOf('skipped')} 个，失败 ${countOf('failed')} 个`);
  }

  lines.push(`时间：${timestamp()}`);
  return lines.join('\n');
};

const sendSummaryNotification = async (shift, results, globalMessage = '') => {
  const shiftName = shift === 'morning' ? '上班' : '下班';
  const title = `海康${shiftName}打卡结果`;
  const content = buildNotificationContent(results, globalMessage);

  try {
    if (globalThis.QLAPI && typeof globalThis.QLAPI.systemNotify === 'function') {
      const response = await globalThis.QLAPI.systemNotify({ title, content });
      if (response?.code && response.code !== 200) {
        throw new Error(response.message || `青龙通知接口返回 ${response.code}`);
      }
    } else {
      const notifyPath = path.join(__dirname, 'sendNotify.js');
      const { sendNotify } = require(notifyPath);
      if (typeof sendNotify !== 'function') throw new Error('sendNotify.js 未导出 sendNotify');
      await sendNotify(title, content);
    }
    log('所有账号的汇总通知已发送');
  } catch (error) {
    log(`汇总通知发送失败：${error.message}`);
  }
};

const runAccount = async ({ envName, token }, config, args, shift) => {
  if (!TOKEN_PATTERN.test(token)) throw new Error(`${envName} 不是有效的 Token`);

  const account = await withRetry(
    () => getAccount(token, config.timeoutMs),
    `${envName} 账号校验`,
  );
  const accountName = String(account?.nickName || account?.name || account?.accountNo || envName);
  const accountLog = (message) => log(`[${accountName}] ${message}`);
  accountLog(`Token 有效（来源：${envName}）`);

  const [rule, todayStatus] = await Promise.all([
    withRetry(() => getRule(token, config.timeoutMs), `[${accountName}] 获取考勤规则`),
    withRetry(() => getTodayStatus(token, config.timeoutMs), `[${accountName}] 获取今日状态`),
  ]);

  const personName = String(todayStatus?.personName || '').trim();
  const context = { accountName, personName, rule, details: getTodayDetails(todayStatus) };

  if (!ALLOW_LEAVE_DAYS && isOnLeave(todayStatus, shift)) {
    const shiftName = shift === 'morning' ? '上班' : '下班';
    accountLog(`今日${shiftName}状态为请假，无需打卡，本次跳过`);
    return { ...context, status: 'skipped', message: '请假无需打卡，跳过' };
  }
  if (isAlreadyCheckedIn(todayStatus, shift)) {
    accountLog('今日对应班次已完成打卡，本次安全跳过');
    return { ...context, status: 'skipped', message: '已完成打卡，跳过' };
  }
  if (rule.includes('休息') && !config.allowRestDay) {
    accountLog('今日考勤规则为休息，本次安全跳过');
    return { ...context, status: 'skipped', message: '考勤规则为休息，跳过' };
  }
  if (args.checkOnly) {
    accountLog('检查模式完成：尚未打卡，但不会提交打卡请求');
    return { ...context, status: 'skipped', message: '检查通过，未提交打卡' };
  }

  let lastError = null;
  for (let attempt = 1; attempt <= config.retries; attempt += 1) {
    try {
      accountLog(`提交打卡（第 ${attempt}/${config.retries} 次）`);
      const result = await checkIn(token, config);
      if (result?.code === 0) {
        accountLog('打卡成功');
        return { ...context, status: 'success', message: '打卡成功', attempts: attempt };
      }
      lastError = new Error(result?.msg || '接口返回打卡失败');
    } catch (error) {
      lastError = error;
    }

    accountLog(`本次失败：${lastError.message}`);
    if (attempt < config.retries) {
      const delay = config.retryDelayMs * (2 ** (attempt - 1));
      accountLog(`${delay / 1000} 秒后重试`);
      await sleep(delay);
    }
  }

  // 把账号和班次信息挂到错误上，失败时汇总通知里也能看到是谁、哪个班次、考勤状态如何。
  const failure = lastError || new Error('打卡失败');
  failure.accountName = accountName;
  failure.personName = personName;
  failure.rule = rule;
  failure.details = context.details;
  failure.attempts = config.retries;
  throw failure;
};

const main = async () => {
  const args = parseArgs();
  const accounts = getConfiguredAccounts();
  if (!accounts.length) throw new Error('请在青龙环境变量中设置 HIK_DAKA_TOKEN 或 HIK_DAKA_TOKEN_2 等账号 Token');

  if (!Number.isFinite(args.delaySeconds) || args.delaySeconds < 0 || args.delaySeconds > 7200) {
    throw new Error('--delay 必须是 0 到 7200 之间的秒数');
  }

  const currentHour = new Date().getHours();
  const shift = args.shift || (currentHour < 12 ? 'morning' : 'evening');
  if (!['morning', 'evening'].includes(shift)) throw new Error('--shift 只能是 morning 或 evening');

  const config = {
    location: process.env.HIK_DAKA_LOCATION || DEFAULTS.location,
    address: process.env.HIK_DAKA_ADDRESS || process.env.HIK_DAKA_LOCATION || DEFAULTS.address,
    longitude: readNumber('HIK_DAKA_LONGITUDE', DEFAULTS.longitude, { min: -180, max: 180 }),
    latitude: readNumber('HIK_DAKA_LATITUDE', DEFAULTS.latitude, { min: -90, max: 90 }),
    wifiName: process.env.HIK_DAKA_WIFI || DEFAULTS.wifiName,
    wifiMac: process.env.HIK_DAKA_WIFI_MAC || DEFAULTS.wifiMac,
    randomRadius: readNumber('HIK_DAKA_RANDOM_RADIUS', DEFAULTS.randomRadius, { min: 0, max: 1000 }),
    retries: readNumber('HIK_DAKA_RETRIES', DEFAULTS.retries, { min: 1, max: 5, integer: true }),
    retryDelayMs: readNumber('HIK_DAKA_RETRY_DELAY_MS', DEFAULTS.retryDelayMs, { min: 1000, max: 60000, integer: true }),
    timeoutMs: readNumber('HIK_DAKA_TIMEOUT_MS', DEFAULTS.timeoutMs, { min: 3000, max: 60000, integer: true }),
    allowRestDay: readBoolean('HIK_DAKA_ALLOW_REST', false),
  };

  log(`任务开始：${shift === 'morning' ? '上班' : '下班'}检查，共 ${accounts.length} 个账号`);
  const holiday = await getChinaHolidayStatus();
  if (holiday.weekendExcluded) {
    log('今天是普通周末，按你的设置不作为节假日跳过');
  } else if (holiday.isOffDay) {
    log(`今天是官方节假日${holiday.name ? `（${holiday.name}）` : ''}，本次安全跳过`);
    if (!args.checkOnly) {
      await sendSummaryNotification(
        shift,
        [],
        `⏭️ 官方节假日${holiday.name ? `（${holiday.name}）` : ''}，全部 ${accounts.length} 个账号跳过`,
      );
    }
    return;
  } else {
    log('官方节假日检查通过');
  }

  if (!args.checkOnly && args.delaySeconds > 0) {
    const delay = Math.floor(Math.random() * (args.delaySeconds + 1));
    log(`所有账号统一随机等待 ${delay} 秒后执行`);
    await sleep(delay * 1000);
  }

  const results = [];
  for (const account of accounts) {
    try {
      results.push(await runAccount(account, config, args, shift));
    } catch (error) {
      const accountName = error.accountName || account.envName;
      results.push({
        accountName,
        personName: error.personName,
        status: 'failed',
        message: error.message,
        rule: error.rule,
        details: error.details,
        attempts: error.attempts,
      });
      log(`[${accountName}] 处理失败：${error.message}`);
    }
  }

  if (!args.checkOnly) await sendSummaryNotification(shift, results);

  const failureCount = results.filter((result) => result.status === 'failed').length;
  if (failureCount) {
    log(`${failureCount}/${accounts.length} 个账号处理失败`);
    process.exitCode = 1;
    return;
  }
  log(`全部 ${accounts.length} 个账号处理完成`);
};

if (require.main === module) {
  main().catch(async (error) => {
    console.error(`[${timestamp()}] 任务失败：${error.message}`);
    if (!process.argv.includes('--check')) {
      const shiftArg = process.argv.find((arg) => arg.startsWith('--shift='));
      const shift = shiftArg?.split('=', 2)[1] || (new Date().getHours() < 12 ? 'morning' : 'evening');
      await sendSummaryNotification(shift, [{
        accountName: '任务',
        status: 'failed',
        message: error.message,
      }]);
    }
    process.exitCode = 1;
  });
}

module.exports = {
  buildNotificationContent,
  getAccount,
  getConfiguredAccounts,
  getChinaHolidayStatus,
  isOnLeave,
  sendSummaryNotification,
};
