import { handler, json, clearSessionCookie } from '../lib/auth.mjs';

export default handler(async () => json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() }));

export const config = { path: '/api/logout' };
