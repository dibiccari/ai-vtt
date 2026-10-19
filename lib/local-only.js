// Keys are secrets: only this computer may read or change settings (blocks LAN devices, other sites, DNS rebinding). Express middleware.
export function localOnly(req, res, next) {
  const addr = req.socket.remoteAddress || '';
  const loopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  const host = req.get('host') || '';
  const hostOk = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  let originOk = true;
  const origin = req.get('origin');
  if (origin) {
    try { originOk = new URL(origin).host === host; } catch { originOk = false; }
  }
  if (!loopback || !hostOk || !originOk) return res.status(403).json({ error: 'This can only be done from this computer.' });
  next();
}
