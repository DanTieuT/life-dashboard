const admin = require('firebase-admin');

try {
  const fs = require('fs'), path = require('path');
  const envPath = path.resolve(__dirname, '../../.env');
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s]+)=(.+)$/);
    if (m) process.env[m[1]] = m[2].trim();
  });
} catch {}

function initFirebase() {
  if (admin.apps.length > 0) return;
  let sa;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
    sa = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString());
  } else {
    sa = require('./service-account.json');
  }
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

exports.handler = async (event) => {
  // Simple key check so this isn't fully public
  const key = event.queryStringParameters?.key || event.headers?.['x-profile-key'];
  if (key !== process.env.PROFILE_KEY && process.env.PROFILE_KEY) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  initFirebase();
  const db = admin.firestore();
  const userUid = 'aqzJe5gq4IVYdKmUIW0pNJGL2ML2';

  try {
    const snap = await db.doc(`users/${userUid}/data/main`).get();
    if (!snap.exists) return { statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: '(no profile yet)' };

    const data = snap.data();
    const profile = data.profile || '(no profile yet)';
    const recentNotes = (data.notes || []).slice(0, 20).map(n => `- [${n.source || 'dashboard'}] ${n.text}`).join('\n');
    const projects = (data.userProjects || []).map(p => `- ${p.emoji || '🔨'} ${p.name} [${p.stage}]${p.nextAction ? ' → ' + p.nextAction : ''}`).join('\n');

    const body = `# Dan's Profile & Memory
Last fetched: ${new Date().toISOString()}

## Profile
${profile}

## Active Projects
${projects || '(none)'}

## Recent Brain Dump Notes
${recentNotes || '(none)'}
`;
    return { statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body };
  } catch (e) {
    return { statusCode: 500, body: 'Error: ' + e.message };
  }
};
