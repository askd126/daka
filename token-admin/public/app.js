'use strict';

const form = document.querySelector('#token-form');
const tokenInput = document.querySelector('#token');
const tokenLength = document.querySelector('#token-length');
const toggleVisibility = document.querySelector('#toggle-visibility');
const sendKeyInput = document.querySelector('#send-key');
const toggleSendKey = document.querySelector('#toggle-send-key');
const submitButton = document.querySelector('#submit-button');
const result = document.querySelector('#result');
const panelState = document.querySelector('#panel-state');
const csrfToken = document.querySelector('meta[name="csrf-token"]').content;

const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 与容器内 helper 的校验保持一致：旧版 SCT 开头，Turbo 版 sctp<N>t 开头。
const SEND_KEY_PATTERN = /^(?:sctp\d+t[0-9a-z]+|sct[0-9a-z]+)$/i;

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
  sendKeyInput.disabled = loading;
  toggleSendKey.disabled = loading;
};

const refreshStatus = async () => {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || '连接失败');
    panelState.textContent = '青龙已连接';
    panelState.className = 'pill online';
  } catch {
    panelState.textContent = '青龙连接失败';
    panelState.className = 'pill offline';
  }
};

tokenInput.addEventListener('input', () => {
  tokenLength.textContent = `${tokenInput.value.length} / 36`;
  result.hidden = true;
});

sendKeyInput.addEventListener('input', () => {
  result.hidden = true;
});

const wireVisibilityToggle = (input, button, labels) => {
  button.addEventListener('click', () => {
    const shouldShow = input.type === 'password';
    input.type = shouldShow ? 'text' : 'password';
    button.textContent = shouldShow ? '隐藏' : '显示';
    button.setAttribute('aria-label', shouldShow ? labels.hide : labels.show);
    input.focus();
  });
};

wireVisibilityToggle(tokenInput, toggleVisibility, { show: '显示 Token', hide: '隐藏 Token' });
wireVisibilityToggle(sendKeyInput, toggleSendKey, { show: '显示 SendKey', hide: '隐藏 SendKey' });

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const token = tokenInput.value.trim();
  if (!TOKEN_PATTERN.test(token)) {
    showResult('Token 格式不正确，请检查后重试。', 'error');
    tokenInput.focus();
    return;
  }
  const sendKey = sendKeyInput.value.trim();
  if (sendKey && !SEND_KEY_PATTERN.test(sendKey)) {
    showResult('SendKey 格式不正确，应为 SCT 开头或 sctp<N>t 开头的 Server酱密钥。', 'error');
    sendKeyInput.focus();
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
      body: JSON.stringify({ token, sendKey }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || '提交失败');

    let action = '账号添加成功';
    if (data.duplicate) action = data.updatedPushKey ? '已更新该账号的 SendKey' : '该账号已存在';
    const pushNote = data.hasPushKey ? '，已配推送' : '，未配推送';
    showResult(`${action}：${data.accountName}（${data.envName}）${pushNote}`, 'success');
    tokenInput.value = '';
    sendKeyInput.value = '';
    tokenInput.type = 'password';
    sendKeyInput.type = 'password';
    toggleVisibility.textContent = '显示';
    toggleSendKey.textContent = '显示';
    tokenLength.textContent = '0 / 36';
  } catch (error) {
    showResult(error.message || '提交失败，请稍后重试。', 'error');
  } finally {
    setLoading(false);
  }
});

refreshStatus();
