const { app, BrowserWindow, protocol, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

protocol.registerSchemesAsPrivileged([
  { scheme: 'jiuban', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function getAppRoot() {
  return app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..');
}

function registerAppProtocol() {
  const root = getAppRoot();
  protocol.handle('jiuban', async (request) => {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(root, relative);
    if (!filePath.startsWith(`${root}${path.sep}`) || relative.split(/[\\/]/).some((part) => part.startsWith('.'))) {
      return new Response('Not Found', { status: 404 });
    }
    try {
      const body = await fs.readFile(filePath);
      return new Response(body, {
        headers: {
          'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  });
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 640,
    title: '久伴 · 在线聊天',
    backgroundColor: '#eef1f6',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  await window.loadURL('jiuban://app/index.html');
}

app.whenReady().then(async () => {
  registerAppProtocol();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
