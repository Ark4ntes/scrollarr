// Authentification (READ-002 §4.10) : mode « password » (identifiant et mot de
// passe uniques, session par cookie signé) ou mode « none » (aucun contrôle,
// activé volontairement). Un mot de passe partagé protège l'accès au service ;
// il ne sépare pas les personnes.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'folders_session';
const digest = (s) => createHash('sha256').update(String(s)).digest();
const same = (a, b) => timingSafeEqual(digest(a), digest(b));

export function createAuth(config, secret) {
  const password = config.auth === 'password';
  // La clé dépend aussi des identifiants : les changer ferme toutes les sessions.
  const key = createHmac('sha256', secret).update(`${config.user}\0${config.password}`).digest();
  const sign = (payload) => createHmac('sha256', key).update(payload).digest('base64url');
  const attempts = new Map(); // adresse → { count, resetAt }

  const cookieOf = (req) => {
    const hit = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(COOKIE + '='));
    return hit ? hit.slice(COOKIE.length + 1) : '';
  };

  return {
    required: password,

    /** Identifiant de la session de la requête, ou null. En mode none : toujours « anonyme » (pas de session). */
    user(req) {
      if (!password) return null;
      const [payload, sig] = cookieOf(req).split('.');
      if (!payload || !sig) return null;
      const expected = sign(payload);
      if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
      try {
        const { u, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        return u === config.user && e > Date.now() ? u : null;
      } catch { return null; }
    },

    /** Secondes à attendre avant une nouvelle tentative, ou 0. */
    blocked(address) {
      const a = attempts.get(address);
      if (!a || a.resetAt <= Date.now()) return 0;
      return a.count >= config.loginAttempts ? Math.ceil((a.resetAt - Date.now()) / 1000) : 0;
    },

    /** Vérifie les identifiants ; compte l'échec, ou oublie les échecs en cas de succès. */
    check(address, user, pass) {
      // Les deux comparaisons sont toujours faites (pas de court-circuit) et à temps constant.
      const ok = [same(user ?? '', config.user), same(pass ?? '', config.password), typeof user === 'string', typeof pass === 'string'].every(Boolean);
      if (ok) { attempts.delete(address); return true; }
      const now = Date.now();
      if (attempts.size > 10000) for (const [k, v] of attempts) if (v.resetAt <= now) attempts.delete(k);
      if (attempts.size > 10000) attempts.delete(attempts.keys().next().value);
      const a = attempts.get(address);
      if (!a || a.resetAt <= now) attempts.set(address, { count: 1, resetAt: now + config.loginWindowSeconds * 1000 });
      else a.count++;
      return false;
    },

    /** En-tête Set-Cookie d'une session ouverte, ou (sans utilisateur) d'une session effacée. */
    cookie(req, user) {
      const maxAge = user ? config.sessionHours * 3600 : 0;
      const payload = user ? Buffer.from(JSON.stringify({ u: user, e: Date.now() + maxAge * 1000 })).toString('base64url') : '';
      const value = user ? `${payload}.${sign(payload)}` : '';
      const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      return `${COOKIE}=${value}; Path=${config.cookiePath}; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure}`;
    },
  };
}
