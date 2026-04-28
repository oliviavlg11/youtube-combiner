const { v4: uuidv4 } = require('uuid');
const { getStore } = require('../utils/sessionStore');

const COOKIE_NAME = 'sid';
const ONE_YEAR = 60 * 60 * 24 * 365;

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function sessionMiddleware(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  let sid = cookies[COOKIE_NAME];
  if (!sid || !/^[a-f0-9-]{16,}$/i.test(sid)) {
    sid = uuidv4();
    res.setHeader('Set-Cookie',
      `${COOKIE_NAME}=${sid}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax; HttpOnly`);
  }
  req.sid = sid;
  req.store = getStore(sid);
  next();
}

module.exports = { sessionMiddleware };
