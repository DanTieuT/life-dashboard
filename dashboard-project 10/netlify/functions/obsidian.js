// Memory backed by Firebase (profile string + notes array in appData)
// Kept as obsidian.js so existing imports don't break.
const admin = require('firebase-admin');
const USER_UID = 'aqzJe5gq4IVYdKmUIW0pNJGL2ML2';

function getRef() {
  const db = admin.firestore();
  return db.doc(`users/${USER_UID}/data/main`);
}

async function readMemory() {
  try {
    const snap = await getRef().get();
    return snap.exists ? (snap.data().profile || '') : '';
  } catch { return ''; }
}

// Kept for legacy callers but memory is now managed directly in applyActions
async function appendMemory(text) {
  try {
    const snap = await getRef().get();
    const current = snap.exists ? (snap.data().profile || '') : '';
    const updated = current ? current.trimEnd() + '\n- ' + text.trim() : '- ' + text.trim();
    await getRef().update({ profile: updated });
    return true;
  } catch { return false; }
}

async function saveNote(filename, content) {
  try {
    const snap = await getRef().get();
    const data = snap.exists ? snap.data() : {};
    const notes = data.notes || [];
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    notes.unshift({ id, text: `**${filename}**\n${content}`, createdAt: Date.now(), source: 'jarvis' });
    await getRef().update({ notes });
    return true;
  } catch { return false; }
}

async function readNote(filename) {
  try {
    const snap = await getRef().get();
    const notes = snap.exists ? (snap.data().notes || []) : [];
    const note = notes.find(n => n.text && n.text.toLowerCase().includes(filename.toLowerCase()));
    return note ? note.text : '';
  } catch { return ''; }
}

module.exports = { readMemory, appendMemory, saveNote, readNote };
