#!/usr/bin/env node

'use strict';

// cron: 15 8 * * *
// name: 海康上班打卡

const path = require('path');
const { spawnSync } = require('child_process');

const coreScript = path.join(__dirname, '..', 'hik_daka.js');
const result = spawnSync(
  process.execPath,
  [coreScript, ...process.argv.slice(2), '--shift=morning', '--delay=300'],
  { stdio: 'inherit', env: process.env },
);

if (result.error) {
  console.error(`启动上班打卡任务失败：${result.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
