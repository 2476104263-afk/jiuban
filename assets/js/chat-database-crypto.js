const HEADER = new TextEncoder().encode('SQLite format 3\0');
export const CIPHER_PROFILES = [
  { id: 'windows-3', label: 'Windows 微信 3.x / MemoTrace 0.2.8', pageSize: 4096, reserve: 48, hash: 'SHA-1', iterations: 64000 },
  { id: 'mac-3-raw', label: 'SQLCipher 3 / 1024 字节原始密钥', pageSize: 1024, reserve: 48, hash: 'SHA-1', iterations: 0 },
  { id: 'sqlcipher-3-raw', label: 'SQLCipher 3 / 4096 字节原始密钥', pageSize: 4096, reserve: 48, hash: 'SHA-1', iterations: 0 },
  { id: 'sqlcipher-4-raw', label: '微信 4.x / SQLCipher 4 原始密钥', pageSize: 4096, reserve: 80, hash: 'SHA-512', iterations: 0 },
  { id: 'sqlcipher-4', label: 'SQLCipher 4 / 派生密钥', pageSize: 4096, reserve: 80, hash: 'SHA-512', iterations: 256000 },
  { id: 'sqlcipher-3-1024', label: 'SQLCipher 3 / 1024 字节派生密钥', pageSize: 1024, reserve: 48, hash: 'SHA-1', iterations: 64000 },
];

export function isPlainDatabase(bytes) {
  return bytes.length >= 100 && HEADER.every((value, index) => bytes[index] === value);
}

function concat(...arrays) {
  const result = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0));
  let offset = 0;
  for (const array of arrays) { result.set(array, offset); offset += array.length; }
  return result;
}

function equal(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function derive(bytes, salt, iterations, hash) {
  const key = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash, iterations, salt }, key, 256));
}

async function pageAuthenticated(bytes, pageIndex, profile, macKey) {
  const start = pageIndex * profile.pageSize;
  const page = bytes.subarray(start, start + profile.pageSize);
  const number = new Uint8Array(4);
  new DataView(number.buffer).setUint32(0, pageIndex + 1, true);
  const payload = concat(page.subarray(pageIndex === 0 ? 16 : 0, profile.pageSize - profile.reserve + 16), number);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', macKey, payload));
  const tagOffset = profile.pageSize - profile.reserve + 16;
  return equal(digest, page.subarray(tagOffset, tagOffset + digest.length));
}

async function decryptPage(page, pageIndex, profile, aesKey) {
  const offset = pageIndex === 0 ? 16 : 0;
  const cipher = page.subarray(offset, profile.pageSize - profile.reserve);
  const iv = page.subarray(profile.pageSize - profile.reserve, profile.pageSize - profile.reserve + 16);
  // SQLCipher encrypts whole blocks without PKCS#7. Append one correctly padded
  // block so WebCrypto removes only that block, preserving the original bytes.
  const padding = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: cipher.subarray(-16) }, aesKey, new Uint8Array()));
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, aesKey, concat(cipher, padding)));
}

export async function decryptDatabase(input, keyText = '', { profileId = 'auto', onProgress = () => {} } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (isPlainDatabase(bytes)) return { bytes, profile: '未加密 SQLite' };
  if (!crypto?.subtle) throw new Error('解密需要通过本机 localhost 或 HTTPS 打开网页。');
  let hex = String(keyText).trim().replace(/^x'([\da-f]+)'$/i, '$1');
  if (!/^(?:[\da-f]{64}|[\da-f]{96})$/i.test(hex)) throw new Error('加密数据库需要 64 位十六进制密钥，或带盐值的 96 位原始密钥。');
  const keyBytes = Uint8Array.from(hex.match(/../g), (part) => parseInt(part, 16));
  hex = '';
  const salt = bytes.subarray(0, 16);
  if (keyBytes.length === 48 && !equal(salt, keyBytes.subarray(32))) throw new Error('密钥附带的盐值与所选数据库不匹配。');
  let selected;
  try {
    for (const profile of CIPHER_PROFILES.filter((item) => profileId === 'auto' || item.id === profileId)) {
      if (!bytes.length || bytes.length % profile.pageSize !== 0) continue;
      onProgress({ stage: '验证数据库格式', percent: 0 });
      const encryptionKey = profile.iterations ? await derive(keyBytes.subarray(0, 32), salt, profile.iterations, profile.hash) : keyBytes.slice(0, 32);
      const macBytes = await derive(encryptionKey, Uint8Array.from(salt, (value) => value ^ 0x3a), 2, profile.hash);
      const macKey = await crypto.subtle.importKey('raw', macBytes, { name: 'HMAC', hash: profile.hash }, false, ['sign']);
      macBytes.fill(0);
      if (await pageAuthenticated(bytes, 0, profile, macKey)) {
        const aesKey = await crypto.subtle.importKey('raw', encryptionKey, 'AES-CBC', false, ['encrypt', 'decrypt']);
        selected = { profile, macKey, aesKey };
        encryptionKey.fill(0);
        break;
      }
      encryptionKey.fill(0);
    }
    if (!selected) throw new Error('密钥不匹配、数据库快照不完整，或加密格式尚未支持。未提取任何消息。');
    const { profile, aesKey, macKey } = selected;
    const output = new Uint8Array(bytes.length);
    output.set(HEADER);
    const count = bytes.length / profile.pageSize;
    for (let pageIndex = 0; pageIndex < count; pageIndex++) {
      if (!await pageAuthenticated(bytes, pageIndex, profile, macKey)) throw new Error(`数据库第 ${pageIndex + 1} 页校验失败，请重新复制完整备份。`);
      const start = pageIndex * profile.pageSize;
      const plain = await decryptPage(bytes.subarray(start, start + profile.pageSize), pageIndex, profile, aesKey);
      output.set(plain, start + (pageIndex === 0 ? 16 : 0));
      plain.fill(0);
      if (pageIndex % 64 === 0 || pageIndex === count - 1) onProgress({ stage: '解密并校验数据页', percent: Math.round((pageIndex + 1) / count * 100) });
    }
    if (output[20] !== profile.reserve) throw new Error('解密后的数据库页格式不匹配。');
    return { bytes: output, profile: profile.label };
  } finally { keyBytes.fill(0); }
}
