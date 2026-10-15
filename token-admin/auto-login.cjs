'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const AES = require('./vendor/crypto-js.cjs');
const INTERVAL = 10 * 24 * 60 * 60 * 1000;
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function login(username, password, request = fetch) {
  // Match the official portal's CryptoJS key schedule, including its 30-byte key.
  const encrypted = AES.AES.encrypt(AES.enc.Utf8.parse(password),
    AES.enc.Utf8.parse('I0YmM5NTgtY2IyYi00OWIzLWFkZTktZj'),
    { iv: AES.enc.Utf8.parse('BjNzhiZDctOGMxOS'), mode: AES.mode.CBC, padding: AES.pad.Pkcs7 }).ciphertext.toString(AES.enc.Base64);
  try {
    const response = await request('https://api.hikiot.com/api-saas/open/v1/pwdLogin', {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', Authorization: 'hidden', 'login-source': 'link-web' },
      body: JSON.stringify({ username, password: encrypted, isAuto: true }),
    });
    const data = await response.json();
    if (!response.ok || data.code !== 0 || !TOKEN.test(data.data?.token || '')) throw new Error();
    return data.data.token;
  } catch {
    throw new Error('账号密码登录失败，请检查凭据或到官方页面完成人工验证');
  }
}

class AutoLogin {
  constructor(helper, directory = process.env.TOKEN_ADMIN_STATE_DIR || path.join(os.homedir(), '.hik-daka-token-admin'), authenticate = login) {
    this.helper = helper;
    this.authenticate = authenticate;
    this.directory = directory;
    this.records = [];
    this.recoveries = {};
    const file = path.join(directory, 'accounts.enc');
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file);
      this.key = fs.readFileSync(path.join(directory, 'key'));
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      const saved = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString());
      this.records = Array.isArray(saved) ? saved : saved.records;
      this.recoveries = Array.isArray(saved) ? {} : saved.recoveries || {};
    }
  }
  save() {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const keyFile = path.join(this.directory, 'key');
    if (!this.key) {
      if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
      this.key = fs.readFileSync(keyFile);
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify({ records: this.records, recoveries: this.recoveries })), cipher.final()]);
    const file = path.join(this.directory, 'accounts.enc');
    fs.writeFileSync(file + '.tmp', Buffer.concat([iv, cipher.getAuthTag(), encrypted]), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  }
  status() {
    return this.records.map(({ username, lastSuccess, lastAttempt, error }) => ({
      username: username.slice(0, 3) + '****' + username.slice(-4), lastSuccess, lastAttempt,
      nextRefresh: lastSuccess + INTERVAL, error,
    }));
  }
  async configure(body) {
    const username = String(body.username || '').trim();
    if (!/^1\d{10}$/.test(username)) throw new Error('请填写有效的手机号账号');
    if (body.enabled === false) {
      this.records = this.records.filter(record => record.username !== username);
      this.save();
      return { success: true, disabled: true };
    }
    if (typeof body.password !== 'string' || !body.password || body.password.length > 256) throw new Error('请填写密码');
    const token = await this.authenticate(username, body.password);
    const result = await this.helper({ action: 'submit', token,
      confirmExisting: body.confirm === true, confirmNewWithUnknown: body.confirm === true });
    if (result.requiresConfirmation) return { success: true, requiresConfirmation: true };
    const now = Date.now();
    delete this.recoveries[result.envName];
    this.records = this.records.filter(record => record.username !== username && record.envName !== result.envName);
    this.records.push({ username, password: body.password, envName: result.envName, lastSuccess: now, lastAttempt: now, error: '' });
    this.save();
    return { success: true };
  }
  async updateRecord(record, now) {
    const token = await this.authenticate(record.username, record.password);
    const account = await this.helper({ action: 'check', token });
    if (!account.exists || account.envName !== record.envName) throw new Error('账号绑定已变更，请重新保存自动登录设置');
    const result = await this.helper({ action: 'submit', token, confirmExisting: true });
    if (result.requiresConfirmation || result.envName !== record.envName) throw new Error('账号更新需要人工确认');
    record.lastSuccess = now;
    record.error = '';
    return token;
  }
  async recover(envName, staleToken, now = Date.now()) {
    if (!/^HIK_DAKA_TOKEN(?:_\d+)?$/.test(envName) || !TOKEN.test(staleToken)) throw new Error('恢复请求无效');
    const current = await this.helper({ action: 'current', envName });
    if (current.token !== staleToken) return { success: true, recovered: true, notify: false, token: current.token, message: '使用后台已更新的 Cookie' };
    const fingerprint = crypto.createHash('sha256').update(staleToken).digest('hex');
    if (this.recoveries[envName]?.fingerprint === fingerprint) return { success: true, recovered: false, notify: false, message: '此次 Cookie 失效已处理，不再重复自动登录或提醒，请在管理页重新保存凭据' };
    this.recoveries[envName] = { fingerprint, at: now };
    const record = this.records.find(item => item.envName === envName);
    if (record) { record.lastAttempt = now; record.recoveryBlocked = true; }
    this.save(); // Claim and block periodic attempts before login, even if the process crashes.
    if (!record) return { success: true, recovered: false, notify: true, message: 'Cookie 已失效，未保存自动登录凭据，请在管理页配置账号密码或更新 Cookie' };
    record.lastAttempt = now;
    let result;
    try {
      const token = await this.updateRecord(record, now);
      record.recoveryBlocked = false;
      result = { success: true, recovered: true, notify: true, token, message: 'Cookie 已失效，自动登录一次成功，已更新 Cookie' };
    } catch (error) {
      record.error = error.message;
      record.recoveryBlocked = true;
      result = { success: true, recovered: false, notify: true, message: 'Cookie 已失效，自动登录一次失败，请在管理页检查凭据或完成人工验证后重新保存' };
    }
    this.save();
    return result;
  }
  async refresh(now = Date.now()) {
    for (const record of this.records) {
      if (record.recoveryBlocked) continue;
      if (now - record.lastSuccess < INTERVAL || now - record.lastAttempt < 3600000) continue;
      record.lastAttempt = now;
      try {
        await this.updateRecord(record, now);
      } catch (error) { record.error = error.message; }
      this.save();
    }
  }
}
module.exports = { login, AutoLogin, INTERVAL };
