import * as api from '../api.js';
import * as store from '../store.js';
import * as downloads from '../downloads.js';
import * as push from '../push.js';
import * as profiles from '../profiles.js';
import { h, toast, fmtBytes, add, fill, icon } from '../ui.js';
import { t } from '../i18n.js';
import { topbar } from '../components.js';
import { go, refresh } from '../router.js';
import { APP_VERSION, SOURCE_URL } from '../config.js';

export async function more(root) {
  const cfg = store.getSettings();
  await downloads.load();
  const { used } = await downloads.usage();

  const seg = (label, key, options, after) => h('fieldset.field', h('legend', label),
    h('div.seg', options.map(([v, l]) => h('label',
      h('input', { type: 'radio', name: key, checked: cfg[key] === v, onchange: () => { store.setSetting(key, v); after?.(); } }), h('span', l)))));

  // ── Serveurs ──
  const STATE = { ok: 'Connecté', offline: 'Hors ligne, données en cache', auth: 'Connexion requise', down: 'Injoignable', off: 'Non utilisé' };
  function serversPanel() {
    const list = api.serverList().filter((s) => s.available);
    const usable = list.filter((s) => s.state === 'ok' || s.state === 'offline');
    const after = () => (api.needsLogin() ? go('/login') : refresh());

    const rows = list.map((s) => {
      const toggle = h('input', { type: 'checkbox', checked: s.enabled, onchange: async () => {
        if (!toggle.checked && usable.length === 1 && usable[0].id === s.id) {
          toggle.checked = true;
          return toast(t('Gardez au moins un serveur actif.'));
        }
        toggle.disabled = true;
        await api.setEnabled(s.id, toggle.checked);
        after();
      } });
      return h('div.server-row',
        h('label.check', toggle, h('span', h('strong', s.label),
          h('small', s.state === 'ok' && s.user ? t('Connecté en tant que {name}', { name: s.user }) : t(STATE[s.state])))),
        s.enabled ? h('button.btn.small', { type: 'button', onclick: async (e) => {
          e.currentTarget.disabled = true;
          const r = await api.test(s.id);
          toast(r.state === 'ok' ? t('{server} répond en {ms} ms.', { server: s.label, ms: r.ms })
            : r.state === 'auth' ? t('{server} répond, mais demande une connexion.', { server: s.label })
              : t('{server} ne répond pas. Vérifiez qu’il est démarré et joignable.', { server: s.label }));
          after();
        } }, t('Tester')) : null,
        s.state === 'ok' && s.user
          ? h('button.btn.small', { type: 'button', onclick: async () => {
            if (usable.length === 1) await push.disable().catch(() => {});
            await api.logout(s.id);
            after();
          } }, t('Se déconnecter')) : null);
    });

    const both = usable.length > 1 ? [
      h('label.field', h('span.field-label', t('Quand une série existe sur plusieurs serveurs')),
        h('div.select', h('select', { onchange: (e) => {
          const v = e.target.value;
          api.setDedupe(v !== 'all');
          if (v !== 'all') api.setPrimary(v);
          refresh();
        } },
        usable.map((s) => h('option', { value: s.id, selected: api.dedupe() && s.primary }, t('Garder celle de {server}', { server: s.label }))),
        h('option', { value: 'all', selected: !api.dedupe() }, t('Afficher les deux'))))),
    ] : [];

    return h('section.panel', h('h2', list.length > 1 ? t('Serveurs') : t('Serveur')), rows, both);
  }

  // ── Collecte : résumé seulement, le détail est sur son propre écran ──
  const collectors = api.collectorList().filter((k) => k.usable);
  const activeLabel = (n) => (n === 0 ? t('Aucun en cours') : n === 1 ? t('1 actif') : t('{n} actifs', { n }));
  const activeCount = h('small', activeLabel(api.activeTaskCount()));
  const paintCount = () => { activeCount.textContent = activeLabel(api.activeTaskCount()); };
  if (api.canTrackTasks()) {
    api.taskEvents.addEventListener('change', paintCount);
    api.refreshTasks().catch(() => {});
  }
  const collectPanel = collectors.length ? h('section.panel',
    h('h2', collectors.length > 1 ? t('Collecteurs') : t('Collecteur')),
    h('p.note', t('Un collecteur va chercher les chapitres chez leur source et les range sur le serveur.')),
    collectors.map((k) => h('div.server-row', h('span.check', h('span', h('strong', k.label),
      h('small', k.session ? t('Utilise la connexion à {server}', { server: k.session }) : t('Connecté')))))),
    api.canTrackTasks() ? h('a.rowlink', { href: '#/more/downloads' },
      h('span', h('strong', t('Téléchargements')), activeCount), icon('next', 20)) : null) : null;

  // ── Notifications ──
  const pushBox = h('div.field');
  async function paintPush() {
    if (!push.supported()) {
      fill(pushBox, h('p.note', t('Ce navigateur ne gère pas les notifications. Sur iPhone, ajoutez d’abord Scrollarr à l’écran d’accueil.')));
      return;
    }
    const [key, on] = await Promise.all([push.serverKey(), push.isEnabled()]);
    if (!key) {
      fill(pushBox, h('p.note', t('Le service de notifications n’est pas installé sur ce serveur. Les nouveautés restent signalées par le badge UP dans Ma liste.')));
      return;
    }
    const toggle = h('input', { type: 'checkbox', checked: on, onchange: async () => {
      toggle.disabled = true;
      try {
        if (toggle.checked) { await push.enable(); toast(t('Notifications activées')); }
        else { await push.disable(); toast(t('Notifications désactivées')); }
      } catch (e) {
        toast(e.message === 'denied'
          ? t('Notifications bloquées. Autorisez-les pour ce site dans les réglages du navigateur.')
          : t('Activation impossible. Vérifiez que le service de notifications fonctionne.'), { duration: 6000 });
      }
      paintPush();
    } });
    fill(pushBox, 
      h('label.check', toggle, h('span', t('M’avertir quand un chapitre arrive dans une série à laquelle je suis abonné'))),
      on ? h('button.btn.small', { type: 'button', onclick: () => push.sendTest().then(() => toast(t('Notification de test envoyée')), () => toast(t('L’envoi du test a échoué.'))) }, t('Envoyer un test')) : null);
  }
  paintPush();

  add(root, 
    topbar(t('Réglages'), { large: true }),
    serversPanel(),
    collectPanel,
    h('section.panel',
      h('h2', t('Profil')),
      h('p.note', profiles.list().length > 1
        ? t('Profil ouvert sur cet appareil : {name}.', { name: profiles.active().name })
        : t('Ajoutez un profil pour qu’une autre personne ait sa propre progression et ses propres abonnements.')),
      h('a.btn', { href: '#/profiles' }, profiles.list().length > 1 ? t('Changer de profil') : t('Gérer les profils'))),
    h('section.panel',
      h('h2', t('Affichage')),
      seg(t('Thème'), 'theme', [['auto', t('Comme l’appareil')], ['light', t('Clair')], ['dark', t('Sombre')]]),
      seg(t('Langue'), 'lang', [['auto', t('Comme l’appareil')], ['fr', 'Français'], ['en', 'English']], () => location.reload())),
    h('section.panel', h('h2', t('Notifications')), pushBox),
    h('section.panel',
      h('h2', t('Lecture hors ligne')),
      h('p.note', !downloads.supported() ? t(downloads.unsupportedText())
        : used ? t('{used} de chapitres téléchargés sur cet appareil.', { used: fmtBytes(used) }) : t('Aucun chapitre téléchargé sur cet appareil.')),
      h('button.btn', { type: 'button', onclick: () => go('/my/downloads') }, t('Gérer les téléchargements'))),
    h('section.panel',
      h('h2', t('À propos')),
      h('p.note', t('Scrollarr {v}, lecteur libre pour Suwayomi et Komga, sous licence MIT.', { v: APP_VERSION })),
      h('p.note', t('Les réglages du lecteur (espacement, fond, défilement automatique) se trouvent dans le lecteur lui-même.')),
      SOURCE_URL.length > 'https://github.com/'.length ? h('a.btn', { href: SOURCE_URL, target: '_blank', rel: 'noopener' }, t('Code source')) : null));
}
