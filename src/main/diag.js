'use strict';
// In-memory diagnostics log shown under Accounts & setup. Never holds passwords or tokens:
// callers log statuses and shapes only, and everything is redacted again here as a backstop.
const lines = [];
function redact(s) {
  return String(s)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
    .replace(/[A-Za-z0-9_\-.]{24,}/g, '<redacted>');
}
const fs = require('fs');
let file = null;
// Also keep the (already redacted) log in a file, so a failed session can be read afterwards without copy/paste.
// The previous session's file is kept once as *.prev.
function setFile(p) {
  try { if (fs.existsSync(p)) fs.renameSync(p, p + '.prev'); fs.writeFileSync(p, lines.map((l) => l + '\n').join('')); file = p; } catch { file = null; }
}
function log(area, msg) {
  const line = `${new Date().toISOString().slice(11, 19)} [${area}] ${redact(msg)}`;
  lines.push(line);
  if (lines.length > 400) lines.shift();
  if (file) { try { fs.appendFileSync(file, line + '\n'); } catch { file = null; } }
}
function dump() { return lines.join('\n'); }
module.exports = { log, dump, redact, setFile, get file() { return file; } };
