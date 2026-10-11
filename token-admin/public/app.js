'use strict';

const form = document.querySelector('#token-form');
const tokenInput = document.querySelector('#token');
const tokenLength = document.querySelector('#token-length');
const toggleVisibility = document.querySelector('#toggle-visibility');
const sendKeyInput = document.querySelector('#send-key');
const toggleSendKey = document.querySelector('#toggle-send-key');
const submitButton = document.querySelector('#submit-button');
const submitLabel = submitButton.querySelector('.button-label');
const result = document.querySelector('#result');
const panelState = document.querySelector('#panel-state');
const csrfToken = document.querySelector('meta[name="csrf-token"]').content;

const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 与容器内 helper 的校验保持一致：旧版 SCT 开头，Turbo 版 sctp<N>t 开头。
const SEND_KEY_PATTERN = /^(?:sctp\d+t[0-9a-z]+|sct[0-9a-z]+)$/i;
let pendingConfirmation = null;

const resetConfirmation = () => {
  pendingConfirmation = null;
  submitLabel.textContent = '验证并添加';
};

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

const checkAccount = async (token) => {
  const response = await fetch('/api/accounts/check', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({ token }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || '账号检测失败');
  return data;
};

tokenInput.addEventListener('input', () => {
  tokenLength.textContent = `${tokenInput.value.length} / 36`;
  result.hidden = true;
  resetConfirmation();
});

sendKeyInput.addEventListener('input', () => {
  result.hidden = true;
  resetConfirmation();
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
    const account = await checkAccount(token);
    const tokenChanged = account.exists && !account.sameToken;
    if (account.exists && !tokenChanged && !sendKey) {
      const pushNote = account.hasPushKey
        ? '已有通知 Key 保持不变'
        : '未填写通知 Key，不会上传通知 Key';
      showResult(`账号已存在（${account.envName}），${pushNote}，未做任何更改。`, 'info');
      return;
    }

    const confirmedExisting = account.exists
      && pendingConfirmation?.token === token
      && pendingConfirmation?.sendKey === sendKey
      && pendingConfirmation?.envName === account.envName
      && pendingConfirmation?.sameToken === account.sameToken
      && pendingConfirmation?.hasPushKey === account.hasPushKey;
    if (account.exists && !confirmedExisting) {
      const changes = [];
      if (tokenChanged) changes.push('更新原账号 Token');
      if (sendKey) changes.push(account.hasPushKey ? '更换通知 Key' : '补配通知 Key');
      pendingConfirmation = { mode: 'existing', token, sendKey, envName: account.envName,
        sameToken: account.sameToken, hasPushKey: account.hasPushKey };
      submitLabel.textContent = '确认更新已有账号';
      showResult(`账号已存在（${account.envName}），将${changes.join('并')}。请再次点击确认；通知 Key 留空时保持原值。`, 'info');
      return;
    }

    const confirmedNewWithUnknown = !account.exists && account.unverifiedCount > 0
      && pendingConfirmation?.mode === 'new-unverified'
      && pendingConfirmation?.token === token
      && pendingConfirmation?.sendKey === sendKey
      && pendingConfirmation?.unverifiedCount === account.unverifiedCount;
    if (!account.exists && account.unverifiedCount > 0 && !confirmedNewWithUnknown) {
      pendingConfirmation = { mode: 'new-unverified', token, sendKey,
        unverifiedCount: account.unverifiedCount };
      submitLabel.textContent = '确认新增账号';
      showResult(`有 ${account.unverifiedCount} 个旧账号的 Token 已失效，无法核对账号 ID。请先核对青龙中的账号；若确定是新账号，再次点击确认新增。`, 'info');
      return;
    }

    const response = await fetch('/api/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ token, ...(sendKey ? { sendKey } : {}),
        confirmExisting: confirmedExisting, confirmNewWithUnknown: confirmedNewWithUnknown }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || '提交失败');

    if (data.requiresConfirmation) {
      if (data.checkIncomplete) {
        pendingConfirmation = { mode: 'new-unverified', token, sendKey,
          unverifiedCount: data.unverifiedCount };
        submitLabel.textContent = '确认新增账号';
        showResult(`有 ${data.unverifiedCount} 个旧账号无法核对账号 ID，请核对后再次点击确认新增。`, 'info');
      } else {
        pendingConfirmation = { mode: 'existing', token, sendKey, envName: data.envName,
          sameToken: data.sameToken, hasPushKey: data.hasPushKey };
        submitLabel.textContent = '确认更新已有账号';
        showResult(`账号已存在（${data.envName}），请再次点击确认更新。`, 'info');
      }
      return;
    }

    let action = '账号添加成功';
    if (data.duplicate) {
      action = data.updatedToken ? '已更新原账号 Token' : '该账号已存在';
      if (data.updatedPushKey) action = data.updatedToken
        ? '已更新原账号 Token 和通知 Key' : '已更新该账号的通知 Key';
    }
    const pushNote = data.hasPushKey ? '，已配推送' : '，未配推送';
    showResult(`${action}：${data.accountName}（${data.envName}）${pushNote}`, 'success');
    resetConfirmation();
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
