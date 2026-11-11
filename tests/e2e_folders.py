"""READ-002 C1: the folders reader, end to end, against the REAL folders service on a generated library.

The service runs for real (node folders/server.js on a fixture built by dev/make-folders-fixture.mjs);
the demo server (dev/mock-servers.mjs) serves the app and relays /folders/ to it, like nginx does.

  1. folders only, mode none: library > series > chapter > read to the end, cover and pages displayed,
     offline download then reading with the service stopped;
  2. folders only, mode password: login required, wrong password refused, session survives a reload;
  3. folders next to the mock Suwayomi: merged library, folders come last in priority,
     profiles and subscriptions still go through Suwayomi.
"""
import shutil
from _common import *   # ROOT, server, stop, check, shot, run, GQL, folders_fixture, folders_service, FOLDERS_PASSWORD

MOCK, SVC = 8451, 8461


def phone(b, **kw):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='fr-FR', **kw)
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    return ctx, pg, errs


def images_ok(pg, selector):
    """Every matching <img> is decoded (naturalWidth > 0)."""
    return pg.evaluate("(s) => { const l = [...document.querySelectorAll(s)]; return l.length > 0 && l.every((i) => i.complete && i.naturalWidth > 0); }", selector)


def read_to_the_end(pg):
    pg.wait_for_selector('.pg.ok', timeout=15000); pg.wait_for_timeout(400)
    for _ in range(12):
        pg.evaluate('scrollTo(0, document.documentElement.scrollHeight)'); pg.wait_for_timeout(250)
    pg.wait_for_selector('.end-next > *', timeout=8000)


def none_mode(b):
    fx = folders_fixture()
    svc = folders_service(SVC, fx, 'none')
    server(MOCK, SERVERS='folders', FOLDERS=f'http://127.0.0.1:{SVC}')
    B = f'http://localhost:{MOCK}'
    ctx, pg, errs = phone(b)

    pg.goto(B + '/'); pg.wait_for_selector('.hero', timeout=15000); pg.wait_for_timeout(1500)   # service worker in place
    check('1 no login screen in mode none', 'login' not in pg.evaluate('location.hash'), pg.evaluate('location.hash'))
    rows = pg.eval_on_selector_all('.row-head h2', 'e=>e.map(x=>x.textContent)')
    check('1 home: only "Mises à jour récentes" is fed (no news rows)', rows == ['Mises à jour récentes'], rows)
    check('1 home: hero is the latest arrival', 'Dernière arrivée' in pg.inner_text('.hero'), pg.inner_text('.hero')[:60])
    check('1 home: cover images displayed', images_ok(pg, '.card-img img'))

    pg.click('a.tab[data-tab=library]'); pg.wait_for_selector('.grid .card'); pg.wait_for_timeout(600)
    check('1 library: 7 series', pg.locator('.grid .card').count() == 7, pg.locator('.grid .card').count())
    chips = pg.eval_on_selector_all('.chips .chip', 'e=>e.map(x=>x.textContent)')
    check('1 library: two libraries offered as filters', chips == ['Tout', 'Autre', 'Scans'], chips)
    check('1 library: the reading-status filter is offered (the reader tracks reading), next to the sort', pg.locator('.filters select').count() == 2, pg.locator('.filters select').count())
    check('1 library: covers displayed', images_ok(pg, '.grid .card-img img'))
    shot(pg, '70-folders-library.png')
    pg.click('.chips .chip >> text=Autre'); pg.wait_for_timeout(700)
    check('1 library filter: one series in "Autre"', pg.locator('.grid .card').count() == 1, pg.locator('.grid .card').count())
    pg.click('.chips .chip >> text=Tout'); pg.wait_for_selector('.grid .card'); pg.wait_for_timeout(500)

    pg.click('.grid .card >> text=Alpha Quest'); pg.wait_for_selector('.eps .ep'); pg.wait_for_timeout(500)
    check('1 series: 3 chapters in reading order', pg.eval_on_selector_all('.ep-no', 'e=>e.map(x=>x.textContent)') == ['#1', '#2', '#10'],
          pg.eval_on_selector_all('.ep-no', 'e=>e.map(x=>x.textContent)'))
    check('1 series: header cover displayed', images_ok(pg, '.shero-cover img'))
    shot(pg, '71-folders-series.png')
    pg.click('.eps .ep-link >> nth=0')
    read_to_the_end(pg)
    check('1 reader: 3 pages displayed', pg.locator('.pg.ok').count() == 3, pg.locator('.pg.ok').count())
    check('1 reader: pages are decoded images', images_ok(pg, '.pg img'))
    shot(pg, '72-folders-reader.png')
    bid = pg.evaluate('location.hash').split('/')[-1]
    check('1 reader: chapter id carries the reader code', bid.startswith('f:'), bid)
    check('1 reader: end card offers the next chapter', 'Chapitre' in pg.inner_text('.end-next') or pg.locator('.nextcard').count() == 1, pg.inner_text('.end-next')[:60])
    pg.click('.nextcard'); pg.wait_for_selector('.pg.ok', timeout=8000)
    check('1 reader: next chapter opens', pg.evaluate('location.hash').split('/')[-1] != bid)

    # Hors ligne : téléchargement, puis lecture service arrêté.
    pg.goto(B + '/#/series/' + bid.split('.')[0]); pg.wait_for_selector('.eps .ep')
    pg.click('.sactions .btn >> text=Télécharger'); pg.wait_for_selector('.sheet'); pg.click('.action >> text=Toute la série')
    pg.wait_for_function("document.querySelectorAll('.dl.done').length === 3", timeout=30000)
    check('1 offline: three chapters downloaded', True)
    stop(svc)
    pg.wait_for_timeout(300)
    href = pg.evaluate("document.querySelector('.ep a').getAttribute('href')")
    pg.goto(B + '/#/my/downloads'); pg.goto(B + '/' + href); pg.reload()
    pg.wait_for_selector('.pg.ok', timeout=20000); pg.wait_for_timeout(500)
    check('1 offline: downloaded chapter reads with the service stopped', pg.locator('.pg.ok').count() == 3 and images_ok(pg, '.pg img'), pg.locator('.pg.ok').count())
    check('1 offline: banner says the server is unreachable', pg.locator('#offline-banner:not([hidden])').count() == 1)
    # Service worker : rien de ce que renvoie le service n'entre dans le cache de la coquille ; la couverture est resservie hors ligne.
    shell = pg.evaluate("async () => { const out = []; for (const n of await caches.keys()) if (n.startsWith('scrollarr-shell')) out.push(...(await (await caches.open(n)).keys()).map((r) => r.url)); return out; }")
    check('1 service worker: the shell cache holds the app but nothing from /folders/', len(shell) > 10 and not [u for u in shell if '/folders/' in u], len(shell))
    pg.goto(B + '/#/series/' + bid.split('.')[0]); pg.wait_for_selector('.eps .ep', timeout=15000); pg.wait_for_timeout(500)
    check('1 offline: the series page (rebuilt from the downloads) shows its cover from the cache', images_ok(pg, '.shero-cover img'))
    check('1 no script error', not errs, errs)
    ctx.close()


def password_mode(b):
    fx = folders_fixture()
    folders_service(SVC + 1, fx, 'password')
    server(MOCK + 1, SERVERS='folders', FOLDERS=f'http://127.0.0.1:{SVC + 1}')
    B = f'http://localhost:{MOCK + 1}'
    ctx, pg, errs = phone(b, service_workers='block')

    pg.goto(B + '/'); pg.wait_for_selector('.login .server', timeout=15000)
    check('2 login screen shown, one card named Dossiers', pg.inner_text('.server h2') == 'Dossiers', pg.inner_text('.server h2'))
    check('2 username label is "Identifiant"', 'Identifiant' in pg.inner_text('.login-form'))
    shot(pg, '73-folders-login.png')
    check('2 service refuses unauthenticated calls', pg.evaluate("fetch('/folders/api/v1/libraries').then((r) => r.status)") == 401)

    pg.fill('input[name=username]', 'lecteur'); pg.fill('input[name=password]', 'mauvais-mot-de-passe-xx'); pg.click('.login-form button[type=submit]')
    pg.wait_for_selector('.form-error:not([hidden])', timeout=8000)
    check('2 wrong password refused', 'incorrect' in pg.inner_text('.form-error'), pg.inner_text('.form-error'))
    check('2 still on the login screen', pg.locator('.login').count() == 1)

    pg.fill('input[name=password]', FOLDERS_PASSWORD); pg.click('.login-form button[type=submit]')
    pg.wait_for_selector('.hero', timeout=15000); pg.wait_for_timeout(600)
    check('2 right password opens the app', pg.locator('.login').count() == 0)
    check('2 covers are displayed (the session cookie also authenticates images)', images_ok(pg, '.card-img img'))
    cookie = [c for c in ctx.cookies() if c['name'] == 'folders_session']
    check('2 session cookie: HttpOnly, SameSite=Strict, scoped to /folders/',
          len(cookie) == 1 and cookie[0]['httpOnly'] and cookie[0]['sameSite'] == 'Strict' and cookie[0]['path'] == '/folders/', cookie)

    pg.reload(); pg.wait_for_selector('.hero', timeout=15000)
    check('2 session survives a reload', pg.locator('.login').count() == 0)
    pg.goto(B + '/#/more'); pg.wait_for_selector('.server-row'); pg.wait_for_timeout(400)
    check('2 settings: signed in as the shared user', 'lecteur' in pg.inner_text('.server-row'), pg.inner_text('.server-row'))
    pg.click('.server-row .btn >> text=Se déconnecter'); pg.wait_for_selector('.login .server', timeout=10000)
    check('2 sign out brings the login card back', pg.locator('.login-form').count() == 1)
    check('2 signed out: the service refuses again', pg.evaluate("fetch('/folders/api/v1/libraries').then((r) => r.status)") == 401)
    check('2 no script error', not errs, errs)
    ctx.close()


def with_suwayomi(b):
    fx = folders_fixture()
    # Un dossier de la bibliothèque porte le titre d'une série du faux Suwayomi : il doit être masqué (priorité en dernier).
    dup = f'{fx}/libraries/Scans/Le Jardin des Automates/Chapitre 1'
    shutil.copytree(f'{fx}/libraries/Scans/Beta Folders/Chapitre 1', dup)
    folders_service(SVC + 2, fx, 'none')
    server(MOCK + 2, SERVERS='suwayomi,folders', FOLDERS=f'http://127.0.0.1:{SVC + 2}')
    B = f'http://localhost:{MOCK + 2}'
    ctx, pg, errs = phone(b, service_workers='block')
    calls = []
    pg.on('request', lambda r: calls.append((r.method, r.url)))

    pg.goto(B + '/'); pg.wait_for_selector('.hero', timeout=15000)
    pg.click('a.tab[data-tab=library]'); pg.wait_for_selector('.grid .card'); pg.wait_for_timeout(1200)
    hrefs = pg.eval_on_selector_all('.grid .card', 'e=>e.map(x=>x.getAttribute("href"))')
    titles = pg.eval_on_selector_all('.grid .card-title', 'e=>e.map(x=>x.textContent)')
    suwa = [h for h in hrefs if h.startswith('#/series/s:')]
    fold = [h for h in hrefs if h.startswith('#/series/f:')]
    check('3 merged library: Suwayomi and folders series together', len(suwa) == 7 and len(fold) == 7, (len(suwa), len(fold)))
    check('3 same title on both: only Suwayomi kept (folders last in priority)', titles.count('Le Jardin des Automates') == 1
          and any(h.startswith('#/series/s:') for h, t in zip(hrefs, titles) if t == 'Le Jardin des Automates'), titles)
    shot(pg, '74-folders-merged-library.png')
    pg.evaluate("localStorage.setItem('scrollarr.dedupe', '0')"); pg.reload(); pg.click('a.tab[data-tab=library]'); pg.wait_for_selector('.grid .card'); pg.wait_for_timeout(1200)
    titles = pg.eval_on_selector_all('.grid .card-title', 'e=>e.map(x=>x.textContent)')
    check('3 "show both": the folders copy appears too', titles.count('Le Jardin des Automates') == 2, titles.count('Le Jardin des Automates'))
    pg.evaluate("localStorage.removeItem('scrollarr.dedupe')")

    # Lecture d'un chapitre Dossiers à côté de Suwayomi.
    pg.goto(B + '/#/library'); pg.wait_for_selector('.grid .card')
    pg.click('.grid .card >> text=Beta Folders'); pg.wait_for_selector('.eps .ep')
    check('3 series page names the server of origin', 'Dossiers' in pg.inner_text('.facts'), pg.inner_text('.facts'))
    pg.click('.eps .ep-link >> nth=0'); pg.wait_for_selector('.pg.ok', timeout=15000)
    check('3 a folders chapter reads next to Suwayomi', images_ok(pg, '.pg img'))

    # Abonnements et profils : toujours par Suwayomi, jamais par le service Dossiers.
    pg.goto(B + '/#/series/' + fold[0][len('#/series/'):]); pg.wait_for_selector('.eps .ep')
    pg.click('.sactions .btn >> nth=0'); pg.wait_for_timeout(1500)
    meta = pg.evaluate(GQL, ['Metas', {'prefix': 'scrollarr.favorites'}])['data']['metas']['nodes']
    check('3 a subscription to a folders series is stored by Suwayomi', len(meta) == 1 and 'f:' in meta[0]['value'], meta)
    pg.goto(B + '/#/profiles'); pg.wait_for_selector('.who')
    check('3 profile management is available', pg.locator('.who >> text=Ajouter un profil').count() == 1)
    pg.click('.who >> text=Ajouter un profil'); pg.wait_for_selector('.sheet input'); pg.fill('.sheet input', 'Léa'); pg.click('.sheet button[type=submit]')
    pg.wait_for_selector('.profiles .profile >> nth=1', timeout=8000)
    check('3 a profile can be created (stored on Suwayomi)', pg.locator('.profiles .profile').count() == 2)
    docs = pg.evaluate(GQL, ['Metas', {'prefix': 'scrollarr.profiles'}])['data']['metas']['nodes']
    check('3 the profile list is in Suwayomi storage', len(docs) >= 1 and 'Léa' in docs[0]['value'])
    writes = [c for c in calls if '/folders/' in c[1] and c[0] != 'GET']
    check('3 no write request ever reaches the folders service', writes == [], writes)
    check('3 no script error', not errs, errs)
    ctx.close()


def scenario(b):
    none_mode(b)
    password_mode(b)
    with_suwayomi(b)


run(scenario)
