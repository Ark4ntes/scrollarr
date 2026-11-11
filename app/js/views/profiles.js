// « Qui lit ? » : choix, création et gestion des profils.
import * as api from '../api.js';
import * as profiles from '../profiles.js';
import { h, add, fill, icon, sheet, actionSheet, toast } from '../ui.js';
import { t } from '../i18n.js';
import { back } from '../router.js';

/** Feuille avec un champ de nom ; appelle onSave(nom) à la validation. */
function nameSheet(title, initial, action, onSave) {
  sheet(title, (body, close) => {
    const input = h('input', { type: 'text', maxlength: '30', required: true, value: initial, autocomplete: 'off', 'aria-label': t('Nom du profil') });
    const submit = h('button.btn.primary.wide', { type: 'submit' }, action);
    add(body, h('form.login-form.sheet-form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!input.value.trim()) return;
        submit.disabled = true;
        try { await onSave(input.value); close(); }
        catch { submit.disabled = false; toast(t('Enregistrement impossible : le serveur ne répond pas.')); }
      },
    }, h('label', h('span', t('Nom du profil')), input), submit));
    setTimeout(() => input.focus(), 50);
  });
}

export async function profilesView(root) {
  // Sans serveur qui range les profils (installation « Dossiers » seule) : rien à gérer, aucune écriture tentée.
  if (!api.hasStore() && profiles.list().length <= 1) {
    add(root, h('div.who',
      h('header.who-head',
        h('button.iconbtn', { type: 'button', 'aria-label': t('Retour'), onclick: () => back('/more') }, icon('back')),
        h('h1', t('Qui lit ?'))),
      h('p.note', t('Gérer les profils sur ce serveur n’est pas possible : les profils et les abonnements ont besoin d’un serveur Suwayomi ou Komga.'))));
    return;
  }
  const listEl = h('ul.profiles');
  const choosing = profiles.needsChoice();

  function paint() {
    const current = choosing ? null : profiles.active().id;
    fill(listEl, profiles.list().map((p) => {
      const main = p.id === 'main';
      return h('li.profile' + (p.id === current ? '.on' : ''),
        h('button.profile-main', { type: 'button', onclick: () => (p.id === current ? back('/home') : profiles.choose(p.id)) },
          h('span.avatar', { 'aria-hidden': 'true' }, (p.name.trim()[0] || '?').toUpperCase()),
          h('span.profile-text',
            h('strong', p.name),
            h('small', main ? t('Historique du serveur') : t('Historique séparé')),
            p.id === current ? h('small.profile-on', t('Profil actif sur cet appareil')) : null)),
        h('button.iconbtn', { type: 'button', 'aria-label': t('Actions pour {title}', { title: p.name }), onclick: () => actionSheet(p.name, [
          { icon: 'settings', label: t('Renommer'), run: () => nameSheet(t('Renommer le profil'), p.name, t('Enregistrer'), async (name) => { await profiles.rename(p.id, name); paint(); }) },
          main ? null : { icon: 'trash', danger: true, label: t('Supprimer ce profil et son historique'), run: async () => {
            try { await profiles.remove(p.id); toast(t('Profil supprimé')); paint(); }
            catch { toast(t('Enregistrement impossible : le serveur ne répond pas.')); }
          } },
        ]) }, icon('more', 20)));
    }));
  }

  add(root, h('div.who',
    h('header.who-head',
      choosing ? null : h('button.iconbtn', { type: 'button', 'aria-label': t('Retour'), onclick: () => back('/more') }, icon('back')),
      h('h1', t('Qui lit ?'))),
    h('p.note', t('Chaque profil a sa progression et ses abonnements. Ce ne sont pas des comptes protégés : chacun peut ouvrir tous les profils.')),
    listEl,
    h('button.btn.wide', { type: 'button', onclick: () => nameSheet(t('Nouveau profil'), '', t('Créer le profil'), async (name) => { await profiles.create(name); paint(); }) },
      icon('plus', 18), t('Ajouter un profil'))));
  paint();
}
