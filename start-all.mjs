#!/usr/bin/env node
/**
 * 一键启动本地开发环境：
 *   1) 网页端  http://127.0.0.1:5188      （node serve.mjs）
 *   2) 记忆库服务 http://127.0.0.1:5189   （node memory-service/server.mjs）
 *
 * 用法：node start-all.mjs   或   npm run dev
 * 端口可用环境变量覆盖：PORT=5188 / MEMORY_PORT=5189
 */
import { spawn } from 'node:child_process';

const WEB_PORT = process.env.PORT || '5188';
const MEMORY_PORT = process.env.MEMORY_PORT || '5189';
const children = [];
let shuttingDown = false;

function run(name, args, env) {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (data) => process.stdout.write(`[${name}] ${data}`));
  child.stderr.on('data', (data) => process.stderr.write(`[${name}] ${data}`));
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`[${name}] 已退出（code=${code ?? 'null'} signal=${signal ?? 'null'}）`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
  }
  setTimeout(() => process.exit(code), 400);
}

process.on('SIGINT', () => { console.log('\n正在停止本地服务…'); shutdown(0); });
process.on('SIGTERM', () => shutdown(0));

console.log('Memora 本地开发环境启动中…');
run('web', ['serve.mjs'], { HOST: '127.0.0.1', PORT: WEB_PORT });
run('memory', ['memory-service/server.mjs'], { MEMORY_HOST: '127.0.0.1', MEMORY_PORT });
setTimeout(() => {
  console.log('');
  console.log('  网页端：      http://127.0.0.1:' + WEB_PORT + '/');
  console.log('  记忆库服务：  http://127.0.0.1:' + MEMORY_PORT + '/');
  console.log('  图形化页面：  http://127.0.0.1:' + WEB_PORT + '/#memory/service');
  console.log('  按 Ctrl+C 同时停止两个服务');
  console.log('');
}, 900);
