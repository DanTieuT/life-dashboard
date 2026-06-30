const https = require('https');

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 200, headers: corsHeaders,
      body: JSON.stringify({ error: 'Add OPENAI_API_KEY to your environment to enable Whisper transcription.' })
    };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { audio, mimeType = 'audio/webm' } = body;
  if (!audio) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No audio provided' }) };
  }

  const audioBuffer = Buffer.from(audio, 'base64');
  const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
  const boundary = '----WhisperBoundary' + Date.now();

  const preamble = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="model"\r\n\r\n` +
    `whisper-1\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="audio.${ext}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`
  );
  const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`);
  const formData = Buffer.concat([preamble, audioBuffer, epilogue]);

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/audio/transcriptions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': formData.length
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.error) {
            resolve({ statusCode: 200, headers: corsHeaders, body: JSON.stringify({ error: result.error.message }) });
          } else {
            resolve({ statusCode: 200, headers: corsHeaders, body: JSON.stringify({ transcript: result.text }) });
          }
        } catch (e) {
          resolve({ statusCode: 200, headers: corsHeaders, body: JSON.stringify({ error: 'Transcription failed: ' + e.message }) });
        }
      });
    });

    req.on('error', (e) => resolve({
      statusCode: 200, headers: corsHeaders,
      body: JSON.stringify({ error: 'Connection error: ' + e.message })
    }));

    req.write(formData);
    req.end();
  });
};
