// Shared OpenAI text-to-speech helper (no handler — used by speak.js and telegram.js).
const https = require('https');

/**
 * Synthesize speech with OpenAI TTS.
 * @param {string} text
 * @param {object} opts {voice, speed, format} — format: 'mp3' | 'opus' | 'aac' | 'flac'
 * @returns {Promise<Buffer>} audio bytes; rejects on error
 */
function synthesizeSpeech(text, { voice = 'alloy', speed = 1.15, format = 'mp3' } = {}) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return reject(new Error('OPENAI_API_KEY not configured'));
    if (!text) return reject(new Error('No text provided'));
    const requestBody = JSON.stringify({
      model: 'tts-1', voice, speed,
      input: String(text).slice(0, 4096),
      response_format: format,
    });
    const chunks = [];
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/audio/speech',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
      },
    }, (res) => {
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.headers['content-type'] && res.headers['content-type'].includes('application/json')) {
          try {
            const err = JSON.parse(buf.toString());
            reject(new Error(err.error?.message || 'TTS failed'));
          } catch { reject(new Error('TTS failed')); }
          return;
        }
        resolve(buf);
      });
    });
    req.on('error', e => reject(new Error('Connection error: ' + e.message)));
    req.write(requestBody);
    req.end();
  });
}

module.exports = { synthesizeSpeech };
