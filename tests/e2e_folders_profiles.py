"""READ-002 C3: a secondary profile keeps its progress on the folders service (capability chapter.progress.profiles).

  6. The REAL folders service next to the mock Suwayomi, one secondary profile, two devices:
     - progress made on device 1 in a folders series is seen on device 2 under the same profile, and NOT by the main
       profile nor by another secondary profile (checked in the app and on the service itself);
     - the same profile reading a Suwayomi series still goes through the profile documents stored on Suwayomi;
     - the home lists merge both kinds of server;
     - deleting the profile removes its progress on the service (and its documents on Suwayomi), and nothing else.
"""
import json, os, urllib.request
from _common import *   # ROOT, server, stop, check, shot, run, GQL, folders_fixture, folders_service

MOCK, SVC = 8457, 8467


def phone(b, errs, state=None):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='fr-FR', service_workers='block', storage_state=state)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errs.append(str(e)))
    return ctx, pg


def svc_get(path):
    """The service answered to directly (mode none), bypassing the app: what is really stored."""
    with urllib.request.urlopen(f'http://127.0.0.1:{SVC}{path}', timeout=5) as r:
        return json.load(r)


def stored(book, profile=None):
    return svc_get(f'/api/v1/books/{book}' + (f'?profile={profile}' if profile else '')).get('readProgress')


def go_to_page(pg, n):
    pg.evaluate("(n) => document.querySelectorAll('.pg')[n - 1].scrollIntoView({ block: 'center' })", n)
    pg.wait_for_function(f"document.querySelector('.r-count').textContent.startsWith('{n} /')", timeout=5000)
    pg.wait_for_timeout(2300)


def who(pg, name):
    pg.click(f'.profile-main >> text={name}'); pg.wait_for_selector('.hero', timeout=10000); pg.wait_for_timeout(900)


def cta(pg, href):
    pg.goto(href); pg.wait_for_selector('.eps .ep', timeout=10000); pg.wait_for_timeout(500)
    return pg.inner_text('.cta .btn')


def scenario(b):
    fx = folders_fixture()
    svc = folders_service(SVC, fx, 'none', FOLDERS_PROGRESS_FLUSH_SECONDS='0')
    server(MOCK, SERVERS='suwayomi,folders', FOLDERS=f'http://127.0.0.1:{SVC}')
    B = f'http://localhost:{MOCK}'
    errs = []
    series = {s['name']: (s['id'], [c['id'] for c in svc_get(f"/api/v1/series/{s['id']}/books")['content']]) for s in svc_get('/api/v1/series?size=100')['content']}
    beta_sid, beta = series['Beta Folders']
    gamma_sid, gamma = series['Gamma Tomes']
    BETA = f'{B}/#/series/f:{beta_sid}'

    # ── Appareil 1 : création du profil, lecture dans une série Dossiers et dans une série Suwayomi ──
    ctx1, pg = phone(b, errs)
    pg.goto(B + '/'); pg.wait_for_selector('.hero', timeout=15000)
    pg.goto(B + '/#/more'); pg.wait_for_selector('.panel')
    check('6 with Suwayomi next to Folders, profile management is offered', pg.locator('a[href="#/profiles"]').count() == 1)
    pg.click('text=Gérer les profils'); pg.wait_for_selector('.who')
    pg.click('text=Ajouter un profil'); pg.wait_for_selector('.sheet input'); pg.fill('.sheet input', 'Léa'); pg.click('.sheet button[type=submit]')
    pg.wait_for_selector('.profile >> nth=1'); pg.wait_for_timeout(400)
    pg.click('.profile-main >> text=Léa'); pg.wait_for_selector('.hero', timeout=10000); pg.wait_for_timeout(900)
    lea = pg.evaluate("localStorage.getItem('scrollarr.profile')")
    check('6 device 1: the secondary profile is open', lea and lea != 'main', lea)

    check('6 device 1 (Léa): the folders series starts from scratch', 'Commencer' in cta(pg, BETA))
    pg.goto(f'{B}/#/read/f:{beta[0]}'); pg.wait_for_selector('.pg.ok', timeout=15000); pg.wait_for_timeout(600)
    go_to_page(pg, 2)
    check('6 the service stores it under the profile', (stored(beta[0], lea) or {}).get('page') == 2, stored(beta[0], lea))
    check('6 the main profile has nothing on the service', stored(beta[0]) is None, stored(beta[0]))
    check('6 another profile has nothing on the service', stored(beta[0], 'autre') is None)
    check('6 the folders directory holds a folder for the profile', os.path.isdir(f'{fx}/data/progress/{lea}'))
    queue = pg.evaluate("localStorage.getItem('scrollarr.progressQueue')")
    check('6 nothing left in the offline queue', queue in (None, '{}'), queue)
    docs = [m['key'] for m in pg.evaluate(GQL, ['Metas', {'prefix': 'scrollarr.p.'}])['data']['metas']['nodes']]
    check('6 the folders progress is NOT written as a profile document on Suwayomi', not any(f'.s.{beta_sid}' in k or 'f-' in k for k in docs), docs)

    # Même profil, série Suwayomi : toujours la surcouche (documents rangés sur Suwayomi).
    pg.goto(B + '/#/series/s:7'); pg.wait_for_selector('.eps .ep'); pg.click('.cta .btn')
    pg.wait_for_selector('.pg.ok', timeout=8000); pg.wait_for_timeout(400)
    pg.evaluate('scrollTo(0, document.documentElement.scrollHeight)'); pg.wait_for_selector('.end-next > *'); pg.wait_for_timeout(1500)
    docs = [m['key'] for m in pg.evaluate(GQL, ['Metas', {'prefix': 'scrollarr.p.'}])['data']['metas']['nodes']]
    check('6 a Suwayomi series still goes through the profile documents', any(k.endswith('.idx') for k in docs) and any('.s.7' in k for k in docs), docs)
    chs = pg.evaluate(GQL, ['Chapters', {'mangaId': 7}])['data']['chapters']['nodes']
    check('6 Suwayomi history itself is untouched', not any(c['isRead'] or c['lastPageRead'] > 0 for c in chs))
    pg.goto(B + '/#/home'); pg.wait_for_selector('.hero'); pg.wait_for_timeout(900)
    shot(pg, '79-folders-profile-home.png')
    ctx1.close()

    # ── Appareil 2 : même profil, sans aucune copie locale ──
    ctx2, pg = phone(b, errs)
    pg.goto(B + '/'); pg.wait_for_selector('.who', timeout=10000)
    who(pg, 'Léa')
    check('6 device 2 (Léa): the folders chapter resumes where device 1 stopped', 'Reprendre' in cta(pg, BETA), pg.inner_text('.cta .btn'))
    check('6 device 2 (Léa): the series counters follow', pg.locator('.ep').count() == 3)
    pg.goto(B + '/#/library'); pg.wait_for_selector('.grid .card'); pg.wait_for_timeout(1200)
    pg.select_option('.filters select >> nth=1', 'IN_PROGRESS'); pg.wait_for_timeout(1500)
    names = pg.eval_on_selector_all('.grid .card-title', 'e=>e.map(x=>x.textContent)')
    check('6 device 2 (Léa): "in progress" filter holds the folders series and the Suwayomi one', 'Beta Folders' in names and 'Neuf Vies' in names, names)
    check('6 device 2 (Léa): and only them', len(names) == 2, names)
    pg.goto(B + '/#/my/recent'); pg.wait_for_selector('.lines .line'); pg.wait_for_timeout(600)
    lines = pg.eval_on_selector_all('.line', 'e=>e.map(x=>x.innerText.replace(/\\n/g," | "))')
    check('6 device 2 (Léa): recently read merges both servers', any('Beta Folders' in l for l in lines) and any('Neuf Vies' in l for l in lines), lines)
    shot(pg, '80-folders-profile-recent.png')
    pg.goto(B + '/#/series/s:7'); pg.wait_for_selector('.eps .ep'); pg.wait_for_timeout(500)
    check('6 device 2 (Léa): the Suwayomi series follows through the overlay', pg.locator('.ep.read').count() == 1 and 'chapitre 2' in pg.inner_text('.cta .btn'), pg.inner_text('.cta .btn'))
    # Une page de plus, depuis cet appareil : le service la range sous le profil, et l'appareil 1 la verrait.
    pg.goto(f'{B}/#/read/f:{beta[1]}'); pg.wait_for_selector('.pg.ok', timeout=15000); pg.wait_for_timeout(600)
    go_to_page(pg, 2)
    check('6 device 2 writes under the same profile', (stored(beta[1], lea) or {}).get('page') == 2 and stored(beta[1]) is None)

    # ── Profil principal : ne voit rien de tout cela ──
    pg.goto(B + '/#/profiles'); pg.wait_for_selector('.who'); pg.click('.profile-main >> text=Principal'); pg.wait_for_selector('.hero', timeout=10000); pg.wait_for_timeout(900)
    check('6 main profile: the folders series starts from scratch', 'Commencer' in cta(pg, BETA), pg.inner_text('.cta .btn'))
    pg.goto(B + '/#/my/recent'); pg.wait_for_selector('.lines, .empty', timeout=8000); pg.wait_for_timeout(600)
    check('6 main profile: recently read has no folders chapter', 'Beta Folders' not in pg.inner_text('#view'), pg.inner_text('#view')[:200])

    # ── Un autre profil secondaire ──
    pg.goto(B + '/#/profiles'); pg.wait_for_selector('.who')
    pg.click('text=Ajouter un profil'); pg.wait_for_selector('.sheet input'); pg.fill('.sheet input', 'Max'); pg.click('.sheet button[type=submit]')
    pg.wait_for_selector('.profile >> nth=2'); pg.wait_for_timeout(400)
    pg.click('.profile-main >> text=Max'); pg.wait_for_selector('.hero', timeout=10000); pg.wait_for_timeout(900)
    max_id = pg.evaluate("localStorage.getItem('scrollarr.profile')")
    check('6 the other secondary profile has its own id', max_id not in (None, 'main', lea), max_id)
    check('6 other profile: the folders series starts from scratch', 'Commencer' in cta(pg, BETA), pg.inner_text('.cta .btn'))
    pg.goto(f'{B}/#/read/f:{gamma[0]}'); pg.wait_for_selector('.pg.ok', timeout=15000); pg.wait_for_timeout(600)
    go_to_page(pg, 2)
    check('6 other profile writes under its own id', (stored(gamma[0], max_id) or {}).get('page') == 2 and stored(gamma[0], lea) is None and stored(gamma[0]) is None)

    # ── Suppression du profil Léa : sa progression disparaît du service, pas celle des autres ──
    pg.goto(B + '/#/profiles'); pg.wait_for_selector('.who'); pg.click('.profile-main >> text=Principal'); pg.wait_for_selector('.hero', timeout=10000); pg.wait_for_timeout(900)
    pg.goto(B + '/#/profiles'); pg.wait_for_selector('.who'); pg.wait_for_timeout(300)
    pg.click('.profile:has-text("Léa") .iconbtn'); pg.wait_for_selector('.sheet')
    pg.click('.action >> text=Supprimer ce profil'); pg.wait_for_function("document.querySelectorAll('.profile').length === 2", timeout=10000); pg.wait_for_timeout(1500)
    check('6 deleting the profile: its progress is gone on the service', stored(beta[0], lea) is None and stored(beta[1], lea) is None, (stored(beta[0], lea), stored(beta[1], lea)))
    check('6 deleting the profile: its folder is gone', not os.path.exists(f'{fx}/data/progress/{lea}'))
    check('6 deleting the profile: the other profile keeps its progress', (stored(gamma[0], max_id) or {}).get('page') == 2)
    docs = [m['key'] for m in pg.evaluate(GQL, ['Metas', {'prefix': f'scrollarr.p.{lea}.'}])['data']['metas']['nodes']]
    check('6 deleting the profile: its documents are gone on Suwayomi', docs == [], docs)
    pending = pg.evaluate("localStorage.getItem('scrollarr.forgetProfile')")
    check('6 nothing is left to retry', pending in (None, '{}'), pending)
    shot(pg, '81-folders-profiles-after-delete.png')

    # ── Service arrêté pendant la suppression : l'oubli est réessayé au retour ──
    pg.click('.profile:has-text("Max") .iconbtn'); pg.wait_for_selector('.sheet')
    stop(svc)   # seul le service Dossiers est arrêté : Suwayomi, qui range la liste des profils, répond
    pg.click('.action >> text=Supprimer ce profil'); pg.wait_for_function("document.querySelectorAll('.profile').length === 1", timeout=10000); pg.wait_for_timeout(800)
    pending = pg.evaluate("localStorage.getItem('scrollarr.forgetProfile')")
    check('6 service down during the deletion: the forgetting is kept to retry', max_id in (pending or ''), pending)
    svc = folders_service(SVC, fx, 'none', FOLDERS_PROGRESS_FLUSH_SECONDS='0')
    pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    pg.wait_for_function("(localStorage.getItem('scrollarr.forgetProfile') || '{}') === '{}'", timeout=40000)
    check('6 service back: the progress of the deleted profile is forgotten', stored(gamma[0], max_id) is None)
    check('6 the main history is intact', stored(beta[0]) is None and stored(gamma[0]) is None)
    check('6 no script error', not errs, errs)
    ctx2.close()


run(scenario)
