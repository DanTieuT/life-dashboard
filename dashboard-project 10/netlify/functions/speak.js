const https = require('https');

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ error: 'OPENAI_API_KEY not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { text, voice = 'alloy', speed = 1.15 } = body;
  if (!text) return { statusCode: 400, body: JSON.stringify({ error: 'No text provided' }) };

  const requestBody = JSON.stringify({ model: 'tts-1', voice, speed, input: text.slice(0, 4096) });

  return new Promise((resolve) => {
    const chunks = [];
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/audio/speech',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody)
      }
    }, (res) => {
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.headers['content-type'] && res.headers['content-type'].includes('application/json')) {
          try {
            const err = JSON.parse(buf.toString());
            resolve({ statusCode: 200, headers: corsHeaders, body: JSON.stringify({ error: err.error?.message || 'TTS failed' }) });
          } catch {
            resolve({ statusCode: 200, headers: corsHeaders, body: JSON.stringify({ error: 'TTS failed' }) });
          }
          return;
        }
        resolve({
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ audio: buf.toString('base64') })
        });
      });
    });

    req.on('error', e => resolve({
      statusCode: 200, headers: corsHeaders,
      body: JSON.stringify({ error: 'Connection error: ' + e.message })
    }));

    req.write(requestBody);
    req.end();
  });
};
