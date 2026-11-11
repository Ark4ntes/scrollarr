// Connexion : une carte par serveur activé. L'utilisateur peut aussi écarter
// un serveur dont il ne veut pas se servir.
import * as api from '../api.js';
import { h, add, fill, icon } from '../ui.js';
import { t } from '../i18n.js';

export async function login(root, _params, { onDone }) {
  const list = h('div.servers');
  const footer = h('div.login-foot');

  add(root, h('div.login',
    h('div.login-tone', { 'aria-hidden': 'true' }),
    h('h1.wordmark', 'Scrollarr'),
    h('p.login-lead'),
    list, footer));
  const lead = root.querySelector('.login-lead');

  async function change(fn) {
    await fn();
    if (!api.needsLogin()) return onDone();
    paint();
  }

  function card(s) {
    const many = api.serverList().filter((x) => x.available).length > 1;
    const skip = many
      ? h('button.textbtn', { type: 'button', onclick: () => change(() => api.setEnabled(s.id, false)) }, t('Ne pas utiliser ce serveur'))
      : null;

    if (s.state === 'ok' || s.state === 'offline') {
      return h('section.server.done', h('h2', s.label),
        h('p.server-state', icon('check', 18), s.user ? t('Connecté en tant que {name}', { name: s.user }) : t('Connecté')));
    }
    if (s.state === 'down') {
      return h('section.server', h('h2', s.label),
        h('p.form-error', t('{server} ne répond pas. Vérifiez qu’il est démarré et joignable.', { server: s.label })),
        h('div.server-actions',
          h('button.btn', { type: 'button', onclick: () => change(() => api.connect()) }, t('Réessayer')), skip));
    }

    const error = h('p.form-error', { role: 'alert', hidden: true });
    const user = h('input', { type: 'text', name: 'username', autocomplete: 'username', required: true, autocapitalize: 'off' });
    const pass = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
    const submit = h('button.btn.primary.wide', { type: 'submit' }, t('Se connecter à {server}', { server: s.label }));
    return h('section.server', h('h2', s.label),
      h('form.login-form', {
        onsubmit: async (e) => {
          e.preventDefault();
          error.hidden = true;
          submit.disabled = true;
          try {
            await change(() => api.login(s.id, user.value.trim(), pass.value));
          } catch (err) {
            error.textContent = err instanceof api.AuthError ? t('Identifiant ou mot de passe incorrect.')
              : err instanceof api.OfflineError ? t('{server} ne répond pas. Vérifiez qu’il est démarré et joignable.', { server: s.label })
                : t('Connexion impossible (erreur {code}).', { code: err.status || '?' });
            error.hidden = false;
            submit.disabled = false;
          }
        },
      },
      h('label', h('span', t(s.userLabel)), user),
      h('label', h('span', t('Mot de passe')), pass),
      error, submit),
      skip);
  }

  function paint() {
    const all = api.serverList().filter((s) => s.available);
    const on = all.filter((s) => s.enabled);
    const off = all.filter((s) => !s.enabled);
    if (!all.length) {
      lead.textContent = t('Aucun serveur n’est configuré sur cette installation. Renseignez KOMGA_URL, SUWAYOMI_URL ou FOLDERS_URL dans le fichier .env, puis redémarrez Scrollarr.');
      fill(list);
      fill(footer);
      return;
    }
    lead.textContent = on.length > 1 ? t('Connectez-vous aux serveurs que vous voulez utiliser.')
      : on.length === 1 ? t('Connectez-vous avec votre compte {server}.', { server: on[0].label })
        : t('Choisissez au moins un serveur.');
    fill(list, on.map(card));
    fill(footer, off.map((s) =>
      h('button.btn', { type: 'button', onclick: () => change(() => api.setEnabled(s.id, true)) }, icon('plus', 18), t('Utiliser {server}', { server: s.label }))));
    list.querySelector('input')?.focus();
  }

  await api.connect();
  if (!api.needsLogin()) return onDone();
  paint();
}
