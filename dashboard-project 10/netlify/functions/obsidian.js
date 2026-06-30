const https = require('https');

const MEMORY_PATH = 'Memory/core-memory.md';

function obsidianRequest(method, path, body) {
  return new Promise((resolve) => {
    const isText = typeof body === 'string';
    const payload = body ? (isText ? body : JSON.stringify(body)) : null;
    const headers = {
      'Authorization': `Bearer ${process.env.OBSIDIAN_API_KEY}`,
      'Content-Type': isText ? 'text/markdown' : 'application/json',
    };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const req = https.request({
      hostname: '127.0.0.1',
      port: 27124,
      path,
      method,
      headers,
      rejectUnauthorized: false, // self-signed cert
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 300, status: res.statusCode, body: d }); }
        catch { resolve({ ok: false, body: d }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, body: e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

function vaultPath(p) {
  return '/vault/' + p.split('/').map(encodeURIComponent).join('/');
}

async function readMemory() {
  try {
    const res = await obsidianRequest('GET', vaultPath(MEMORY_PATH));
    return res.ok ? res.body : '';
  } catch { return ''; }
}

async function appendMemory(text) {
  try {
    const current = await readMemory();
    const lines = current.trimEnd().split('\n');
    const sectionIdx = lines.findIndex(l => l.startsWith('## Preferences'));
    const newLine = `- ${text.trim()}`;
    if (sectionIdx !== -1) {
      lines.splice(sectionIdx + 1, 0, newLine);
    } else {
      lines.push('', '## Preferences & Notes', newLine);
    }
    const updated = lines.join('\n') + '\n';
    await obsidianRequest('PUT', vaultPath(MEMORY_PATH), updated);
    return true;
  } catch { return false; }
}

async function writeSection(section, content) {
  try {
    const current = await readMemory();
    const lines = current.split('\n');
    const header = `## ${section}`;
    const idx = lines.findIndex(l => l.trim() === header);
    if (idx !== -1) {
      let end = lines.findIndex((l, i) => i > idx && l.startsWith('## '));
      if (end === -1) end = lines.length;
      lines.splice(idx + 1, end - idx - 1, ...content.split('\n'));
    } else {
      lines.push('', header, ...content.split('\n'));
    }
    await obsidianRequest('PUT', vaultPath(MEMORY_PATH), lines.join('\n') + '\n');
    return true;
  } catch { return false; }
}

async function saveNote(filename, content) {
  try {
    const path = `Memory/${filename.replace(/[^a-zA-Z0-9 _-]/g, '').trim()}.md`;
    await obsidianRequest('PUT', vaultPath(path), content);
    return true;
  } catch { return false; }
}

async function readNote(filename) {
  try {
    const path = `Memory/${filename.replace(/[^a-zA-Z0-9 _-]/g, '').trim()}.md`;
    const res = await obsidianRequest('GET', vaultPath(path));
    return res.ok ? res.body : '';
  } catch { return ''; }
}

module.exports = { readMemory, appendMemory, writeSection, saveNote, readNote };
