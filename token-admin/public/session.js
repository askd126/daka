'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  let revision = 0;
  const clear = () => {
    revision++;
    $('#my-account').hidden = true;
    $('#result').hidden = true; $('#result').textContent = ''; $('#auto-result').textContent = '';
    for (const selector of ['#my-account-title', '#my-team', '#my-rule', '#attendance-error', '#today-rows', '#recent-records', '#auto-status']) $(selector).textContent = '';
  };
  const date = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '尚无记录';
  const render = data => {
    if (data.csrfToken) $('meta[name="csrf-token"]').content = data.csrfToken;
    if (!data.authenticated) { clear(); $('#session-message').textContent = '尚未登录，请验证本人 Token 或使用账号密码登录。'; return; }
    const account = data.account;
    $('#my-account-title').textContent = account.personName || account.accountName || '本人账号';
    $('#my-team').textContent = `当前考勤团队：${account.teamNo || data.autoLogin?.teamNo || '当前登录团队'}`;
    $('#my-rule').textContent = account.rule || '';
    $('#attendance-error').textContent = account.attendanceError || '';
    $('#today-rows').textContent = '';
    for (const shift of account.today || []) {
      const row = document.createElement('tr');
      for (const value of [shift.desc, shift.standardTime, shift.clockTime || '—', shift.statusDesc]) {
        const cell = document.createElement('td'); cell.textContent = value || '—'; row.appendChild(cell);
      }
      $('#today-rows').appendChild(row);
    }
    $('#recent-records').textContent = '';
    const history = account.history || [];
    for (const item of history) {
      const line = document.createElement('p');
      const details = (item.details || []).filter(shift => shift.clockTime).map(shift => `${shift.desc} ${shift.clockTime} ${shift.statusDesc || ''}`).join('；');
      line.textContent = `${date(item.at)} · ${item.shift === 'morning' ? '上班' : '下班'} · ${item.message}${details && !String(item.message).includes(details) ? ' · ' + details : ''}`;
      $('#recent-records').appendChild(line);
    }
    if (!history.length) $('#recent-records').textContent = '暂无历史任务记录，可先查看上方今日打卡状态。';
    const auto = data.autoLogin;
    $('#auto-status').textContent = auto ? `${auto.username}\n考勤团队：${auto.teamNo || account.teamNo}\n最近更新：${date(auto.lastSuccess)}\n下次更新：${date(auto.nextRefresh)}${auto.error ? '\n更新失败：' + auto.error : ''}` : '本人尚未启用自动更新';
    $('#session-message').textContent = '已登录本人账号；再次访问将通过本浏览器 Cookie 自动恢复。';
    $('#my-account').hidden = false;
  };
  const refresh = async () => {
    const current = ++revision;
    try {
      const response = await fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' });
      const data = await response.json();
      if (current !== revision) return;
      if (!response.ok || !data.success) throw new Error(data.error || '读取账号状态失败');
      render(data);
    } catch (error) { if (current === revision) { clear(); $('#session-message').textContent = error.message; } }
  };
  const accept = (data, source) => {
    const clearFields = source === 'token' ? ['#auto-username', '#auto-password', '#auto-team'] : source === 'password' ? ['#token', '#send-key'] : [];
    for (const id of clearFields) $(id).value = '';
    if (data.csrfToken) $('meta[name="csrf-token"]').content = data.csrfToken;
    clear(); refresh();
  };
  window.hikSession = { refresh, accept, clear };
  $('#refresh-account').addEventListener('click', refresh);
  $('#logout-button').addEventListener('click', async () => {
    clear();
    try {
      const response = await fetch('/api/session/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': $('meta[name="csrf-token"]').content }, body: '{}' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '退出失败，请刷新后重试');
      for (const id of ['#token', '#send-key', '#auto-username', '#auto-password', '#auto-team']) $(id).value = '';
      $('#token-length').textContent = '0 / 36'; $('#result').hidden = true; $('#auto-result').textContent = '';
      accept(data);
    } catch (error) { $('#session-message').textContent = error.message; }
  });
  window.addEventListener('pagehide', () => { clear(); for (const id of ['#token', '#send-key', '#auto-username', '#auto-password', '#auto-team']) $(id).value = ''; });
  window.addEventListener('pageshow', () => { clear(); refresh(); });
})();
