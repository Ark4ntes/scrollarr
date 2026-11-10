// Routage par fragment d'URL (#/series/…) : aucun réglage serveur nécessaire.
let forward = false;
let depth = 0;

/** Navigue vers une route de l'application. */
export function go(path, { replace = false } = {}) {
  forward = true;
  if (replace) location.replace('#' + path);
  else { depth++; location.hash = path; }
}

/** Retour arrière, ou repli sur une route quand l'appli a été ouverte directement ici. */
export function back(fallback = '/home') {
  if (depth > 0) { depth--; history.back(); }
  else go(fallback, { replace: true });
}

/** Indique si la navigation en cours vient d'un lien (et non du bouton retour). */
export function consumeForward() {
  const f = forward;
  forward = false;
  return f;
}

/** Redessine l'écran courant (après une action qui change les données affichées). */
export const refresh = () => window.dispatchEvent(new Event('app:refresh'));

export const currentPath =() => location.hash.slice(1) || '/home';

// Les liens <a href="#/…"> comptent comme une navigation vers l'avant.
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href^="#/"]');
  if (a && !e.defaultPrevented && a.getAttribute('href') !== location.hash) { forward = true; depth++; }
});
