'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const TTL = 30 * 24 * 60 * 60 * 1000;
const COOKIE = 'hik_session';
class Sessions {
  constructor(directory) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = path.join(directory, 'sessions.enc');
    const keyFile = path.join(directory, 'session-key');
    if (!fs.existsSync(keyFile)) {
      if (fs.existsSync(this.file)) throw new Error('浏览器会话密钥缺失');
      fs.writeFileSync(keyFile, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
    }
    this.key = fs.readFileSync(keyFile);
    this.entries = {};
    if (fs.existsSync(this.file)) {
      const raw = fs.readFileSync(this.file);
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      this.entries = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString());
    }
  }
  hash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
  save() {
    for (const [key, item] of Object.entries(this.entries)) if (item.expires <= Date.now()) delete this.entries[key];
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(this.entries)), cipher.final()]);
    fs.writeFileSync(this.file + '.tmp', Buffer.concat([iv, cipher.getAuthTag(), encrypted]), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
  }
  cookieToken(req) {
    const value = String(req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
    return /^[0-9a-f]{64}$/.test(value || '') ? value : '';
  }
  get(req) {
    const token = this.cookieToken(req);
    const item = token && this.entries[this.hash(token)];
    return item && item.expires > Date.now() ? item : null;
  }
  cookie(token, secure, maxAge = TTL / 1000) {
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  }
  issue(req, res, identity, secure = false) {
    if (!identity.accountId) throw new Error('登录未返回账号身份');
    const previous = this.cookieToken(req);
    if (previous) delete this.entries[this.hash(previous)];
    const token = crypto.randomBytes(32).toString('hex');
    const session = { ...identity, csrf: crypto.randomBytes(32).toString('hex'), expires: Date.now() + TTL };
    this.entries[this.hash(token)] = session;
    this.save();
    res.setHeader('Set-Cookie', this.cookie(token, secure));
    return session;
  }
  logout(req, res, secure = false) {
    const token = this.cookieToken(req);
    if (token) delete this.entries[this.hash(token)];
    this.save();
    res.setHeader('Set-Cookie', this.cookie('', secure, 0));
  }
}
module.exports = { Sessions, TTL };
