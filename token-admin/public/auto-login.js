'use strict';
(() => {
  const form = document.querySelector('#auto-login-form');
  const username = document.querySelector('#auto-username');
  const password = document.querySelector('#auto-password');
  const save = document.querySelector('#auto-save');
  const disable = document.querySelector('#auto-disable');
  const result = document.querySelector('#auto-result');
  const status = document.querySelector('#auto-status');
  let confirmation = false;
  const reset = () => { confirmation = false; save.textContent = '启用并立即更新'; };
  username.addEventListener('input', reset);
  password.addEventListener('input', reset);
  async function refresh() {
    try {
      const response = await fetch('/api/auto-login');
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error();
      status.textContent = data.accounts.map(account => `${account.username}\n最近更新：${new Date(account.lastSuccess).toLocaleString()}\n下次更新：${new Date(account.nextRefresh).toLocaleString()}${account.error ? '\n更新失败：' + account.error : ''}`).join('\n\n') || '尚未启用自动登录';
    } catch { status.textContent = '无法读取自动登录状态'; }
  }
  async function submit(enabled) {
    if (enabled && !password.value) { result.textContent = '请填写密码'; return; }
    save.disabled = disable.disabled = username.disabled = password.disabled = true;
    result.textContent = '正在处理…';
    try {
      const response = await fetch('/api/auto-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content },
        body: JSON.stringify({ username: username.value, ...(enabled ? { password: password.value } : {}), enabled, confirm: confirmation }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '保存失败');
      if (data.requiresConfirmation) {
        confirmation = true;
        save.textContent = '确认保存并更新';
        result.textContent = '已有账号将更新 Token，或存在无法核验的旧账号。请核对青龙账号后再次点击确认，原通知 Key 保持不变。';
        return;
      }
      password.value = '';
      reset();
      result.textContent = enabled ? '已启用，Cookie 已更新；下次将在 10 天后自动更新。' : '已停用并删除此账号保存的密码。';
      await refresh();
    } catch (error) { reset(); result.textContent = error.message; }
    finally { save.disabled = disable.disabled = username.disabled = password.disabled = false; }
  }
  form.addEventListener('submit', event => { event.preventDefault(); submit(true); });
  disable.addEventListener('click', () => submit(false));
  refresh();
})();
