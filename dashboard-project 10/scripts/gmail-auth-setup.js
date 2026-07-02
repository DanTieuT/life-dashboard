// One-time Gmail OAuth setup — gets a refresh token for gmail-scan.js.
//
// Prereqs (console.cloud.google.com, same project as Firebase):
//   1. APIs & Services → Library → enable "Gmail API"
//   2. Credentials → Create OAuth client ID → type "Desktop app"
//
// Run:  node scripts/gmail-auth-setup.js <CLIENT_ID> <CLIENT_SECRET>
//
// It opens a Google consent page, catches the redirect on localhost:8765,
// exchanges the code for a refresh token, and appends everything to .env.
// Afterwards, set the same three vars on Netlify:
//   netlify env:set GMAIL_CLIENT_ID ... ; GMAIL_CLIENT_SECRET ; GMAIL_REFRESH_TOKEN
const http = require('http');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const [clientId, clientSecret] = process.argv.slice(2);
if (!clientId || !clientSecret) {
  console.error('Usage: node scripts/gmail-auth-setup.js <CLIENT_ID> <CLIENT_SECRET>');
  process.exit(1);
}

const PORT = 8765;
const REDIRECT = `http://localhost:${PORT}/callback`;
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent', // force a refresh token even if previously authorized
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
  const code = url.searchParams.get('code');
  if (!code) { res.writeHead(400); res.end('No code in callback'); return; }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: REDIRECT, grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.refresh_token) throw new Error('No refresh token returned: ' + JSON.stringify(tokens));

    const envPath = path.resolve(__dirname, '../.env');
    fs.appendFileSync(envPath, `\nGMAIL_CLIENT_ID=${clientId}\nGMAIL_CLIENT_SECRET=${clientSecret}\nGMAIL_REFRESH_TOKEN=${tokens.refresh_token}\n`);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>✅ Gmail connected — you can close this tab.</h2>');
    console.log('\n✅ Refresh token saved to .env');
    console.log('\nNow set the same vars on Netlify:');
    console.log('  netlify env:set GMAIL_CLIENT_ID "' + clientId + '"');
    console.log('  netlify env:set GMAIL_CLIENT_SECRET "<same secret>"');
    console.log('  netlify env:set GMAIL_REFRESH_TOKEN "<see .env>"');
  } catch (e) {
    res.writeHead(500); res.end('Error: ' + e.message);
    console.error('\n❌', e.message);
  }
  server.close();
});

server.listen(PORT, () => {
  console.log('Opening Google consent page…\nIf it does not open, visit:\n' + authUrl + '\n');
  exec(`open "${authUrl}"`);
});
