const { synthesizeSpeech } = require('./tts.js');

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { text, voice = 'alloy', speed = 1.15 } = body;
  if (!text) return { statusCode: 400, body: JSON.stringify({ error: 'No text provided' }) };

  try {
    const buf = await synthesizeSpeech(text, { voice, speed, format: 'mp3' });
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ audio: buf.toString('base64') }) };
  } catch (e) {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ error: e.message }) };
  }
};
