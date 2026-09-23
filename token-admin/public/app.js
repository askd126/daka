'use strict';

const form = document.querySelector('#token-form');
const tokenInput = document.querySelector('#token');
const tokenLength = document.querySelector('#token-length');
const toggleVisibility = document.querySelector('#toggle-visibility');
const submitButton = document.querySelector('#submit-button');
const result = document.querySelector('#result');
const accountCount = document.querySelector('#account-count');
const panelState = document.querySelector('#panel-state');
const csrfToken = document.querySelector('meta[name="csrf-token"]').content;

const showResult = (message, type) => {
  result.hidden = false;
  result.className = `result ${type}`;
  result.textContent = message;
};

const setLoading = (loading) => {
  submitButton.disabled = loading;
  submitButton.classList.toggle('loading', loading);
  tokenInput.disabled = loading;
  toggleVisibility.disabled = loading;
};

const refreshStatus = async () => {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || '连接失败');
    accountCount.textContent = data.count;
    panelState.textContent = '青龙已连接';
    panelState.className = 'pill online';
  } catch {
    accountCount.textContent = '—';
    panelState.textContent = '青龙连接失败';
    panelState.className = 'pill offline';
  }
};

tokenInput.addEventListener('input', () => {
  tokenLength.textContent = `${tokenInput.value.length} / 36`;
  result.hidden = true;
});

toggleVisibility.addEventListener('click', () => {
  const shouldShow = tokenInput.type === 'password';
  tokenInput.type = shouldShow ? 'text' : 'password';
  toggleVisibility.textContent = shouldShow ? '隐藏' : '显示';
  toggleVisibility.setAttribute('aria-label', shouldShow ? '隐藏 Token' : '显示 Token');
  tokenInput.focus();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const token = tokenInput.value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    showResult('Token 格式不正确，请检查后重试。', 'error');
    tokenInput.focus();
    return;
  }

  setLoading(true);
  try {
    const response = await fetch('/api/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ token }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || '提交失败');

    const action = data.duplicate ? '该账号已存在' : '账号添加成功';
    showResult(`${action}：${data.accountName}（${data.envName}）`, 'success');
    tokenInput.value = '';
    tokenInput.type = 'password';
    toggleVisibility.textContent = '显示';
    tokenLength.textContent = '0 / 36';
    accountCount.textContent = data.count;
  } catch (error) {
    showResult(error.message || '提交失败，请稍后重试。', 'error');
  } finally {
    setLoading(false);
  }
});

refreshStatus();
