#!/usr/bin/env node
/**
 * 久伴 本地静态服务器（零依赖）
 *
 * 用法：
 *   node serve.mjs                    # 默认局域网可访问，端口 5188
 *   PORT=8080 node serve.mjs          # 指定端口
 *   HOST=127.0.0.1 node serve.mjs     # 只允许本机访问
 *
 * 默认监听 0.0.0.0，同一 Wi-Fi 下的其他设备可通过「局域网地址」访问。
 *
 * 说明：久伴 使用原生 ES Modules，浏览器出于 CORS 限制不能直接以
 * file:// 方式打开 index.html，所以需要这个极简静态服务器。
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT) || 5188;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/** 阻止 ../ 逃逸出项目目录 */
function resolveSafePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const relative = decoded === '/' ? '/index.html' : decoded;
  const normalized = path.posix.normalize(relative);
  // 局域网/公网访问时，不暴露隐藏目录（.qa/.git 等）与源码/文档文件
  if (normalized.split('/').some((segment) => segment.startsWith('.'))) return null;
  if (/^\/(serve\.mjs|package\.json|README\.md|CONTRACT\.md)$/i.test(normalized)) return null;
  const resolved = path.resolve(ROOT, `.${normalized}`);
  if (!resolved.startsWith(`${ROOT}${path.sep}`) && resolved !== path.join(ROOT, 'index.html')) {
    return null;
  }
  return resolved;
}

const server = http.createServer((req, res) => {
  const startedAt = Date.now();
  const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  res.on('finish', () => {
    console.log(
      `[${stamp}] ${req.method} ${req.url} -> ${res.statusCode} ${Date.now() - startedAt}ms`
    );
  });

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end('Method Not Allowed');
    return;
  }

  const filePath = resolveSafePath(req.url || '/');
  if (!filePath) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const headers = {
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    };

    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    res.writeHead(200, headers);
    fs.createReadStream(filePath)
      .on('error', () => {
        res.destroy();
      })
      .pipe(res);
  });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用，请换一个端口：PORT=8080 node serve.mjs`);
    process.exit(1);
  }
  throw error;
});

function getLanAddresses() {
  const result = [];
  const interfaces = os.networkInterfaces();
  const skipName = /^(lo|bridge|utun|awdl|llw|anpi|vnic|docker|veth|tap|tun)/i;
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (skipName.test(name)) continue;
    for (const address of addresses || []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      result.push({ name, address: address.address });
    }
  }
  return result;
}

server.listen(PORT, HOST, () => {
  const lanAddresses = HOST === '0.0.0.0' || HOST === '::' ? getLanAddresses() : [];
  console.log('');
  console.log('  久伴 已启动 🚀');
  console.log(`  本机访问: http://127.0.0.1:${PORT}`);
  if (lanAddresses.length) {
    for (const item of lanAddresses) {
      console.log(`  局域网访问: http://${item.address}:${PORT}  (${item.name})`);
    }
    console.log('  提示: 同一 Wi-Fi 下的手机/电脑可直接打开上面的「局域网访问」地址');
  } else {
    console.log('  当前只允许本机访问（HOST=' + HOST + '）');
  }
  console.log('  按 Ctrl+C 停止');
  console.log('');
});
