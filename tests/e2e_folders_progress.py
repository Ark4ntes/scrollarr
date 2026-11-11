"""READ-002 C2: reading progress and the folders-only UI, against the REAL folders service on a generated library.

  4. progress saved while reading, resumed after a page reload, after a restart of the service (graceful and
     hard kill) and after a network cut; mark read / unread; "in progress" and "recently read" on the home screen;
     reading-status filter of the library;
  5. folders only (no server with a key-value store): no profile management, subscriptions stay on the device
     (and the screen says so), a neutral empty state, and not a single failed or unexpected request.
"""
import json, os, urllib.request
from _common import *   # ROOT, server, stop, terminate, check, shot, run, folders_fixture, folders_service

MOCK, SVC = 8454, 8464


def phone(b, **kw):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='fr-FR', service_workers='block', **kw)
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    return ctx, pg, errs


def svc_get(port, path):
    """The service answered to directly (mode none), bypassing the app: what is really stored."""
    with urllib.request.urlopen(f'http://127.0.0.1:{port}{path}', timeout=5) as r:
        return json.load(r)


def ids(port):
    """{ series name: (series id, [chapter ids]) } as the service knows them."""
    out = {}
    for s in svc_get(port, '/api/v1/series?size=100')['content']:
        out[s['name']] = (s['id'], [b['id'] for b in svc_get(port, f"/api/v1/series/{s['id']}/books")['content']])
    return out


def put_progress(pg, book, body):
    """Progress written like the app does (headers the service requires on every write)."""
    return pg.evaluate("async ([id, body]) => (await fetch('/folders/api/v1/books/' + id + '/progress', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify(body) })).status", [book, body])


def go_to_page(pg, n):
    """Brings page n (from 1) to the middle of the screen, then waits for the debounced save (1.5 s) to leave."""
    pg.evaluate("(n) => document.querySelectorAll('.pg')[n - 1].scrollIntoView({ block: 'center' })", n)
    pg.wait_for_function(f"document.querySelector('.r-count').textContent.startsWith('{n} /')", timeout=5000)
    pg.wait_for_timeout(2300)


def open_reader(pg, B, book):
    pg.goto(B + f'/#/read/f:{book}'); pg.wait_for_selector('.pg.ok', timeout=15000); pg.wait_for_timeout(600)


def progress_flow(b):
    fx = folders_fixture()
    svc = folders_service(SVC, fx, 'none')
    server(MOCK, SERVERS='folders', FOLDERS=f'http://127.0.0.1:{SVC}')
    B = f'http://localhost:{MOCK}'
    ctx, pg, errs = phone(b)
    pg.goto(B + '/'); pg.wait_for_selector('.hero', timeout=15000)
    S = ids(SVC)
    beta_sid, beta = S['Beta Folders']
    alpha_sid, alpha = S['Alpha Quest']
    gamma_sid, gamma = S['Gamma Tomes']
    stored = lambda book: svc_get(SVC, f'/api/v1/books/{book}').get('readProgress')

    # ── Enregistrer, reprendre après rechargement ──
    open_reader(pg, B, beta[0])
    check('4 a chapter nobody read has no progress', stored(beta[0]) is None)
    go_to_page(pg, 2)
    check('4 the page is saved on the service', (stored(beta[0]) or {}).get('page') == 2, stored(beta[0]))
    pg.reload(); pg.wait_for_selector('.pg.ok', timeout=15000); pg.wait_for_timeout(900)
    check('4 reload: the reader resumes at page 2', pg.inner_text('.r-count').startswith('2 /'), pg.inner_text('.r-count'))

    # ── Redémarrage du service : arrêt normal (SIGTERM, la progression est écrite à l'arrêt) ──
    terminate(svc)
    svc = folders_service(SVC, fx, 'none')
    check('4 restart (SIGTERM): the progress is still there', (stored(beta[0]) or {}).get('page') == 2, stored(beta[0]))
    pg.reload(); pg.wait_for_selector('.pg.ok', timeout=15000); pg.wait_for_timeout(900)
    check('4 restart (SIGTERM): the reader resumes at page 2', pg.inner_text('.r-count').startswith('2 /'), pg.inner_text('.r-count'))

    # ── Arrêt brutal (SIGKILL) : la progression écrite depuis plus que le délai de regroupement (3 s) est là ──
    # (un autre chapitre : la dernière page marquerait le chapitre comme terminé, et il se rouvrirait à la page 1)
    open_reader(pg, B, beta[2])
    go_to_page(pg, 2)
    pg.wait_for_timeout(3500)
    stop(svc)
    svc = folders_service(SVC, fx, 'none')
    check('4 restart (SIGKILL after the write delay): page 2 is there', (stored(beta[2]) or {}).get('page') == 2, stored(beta[2]))
    pg.reload(); pg.wait_for_selector('.pg.ok', timeout=15000); pg.wait_for_timeout(900)
    check('4 restart (SIGKILL): the reader resumes at page 2', pg.inner_text('.r-count').startswith('2 /'), pg.inner_text('.r-count'))

    # ── Coupure réseau : la progression est mise en file puis renvoyée au retour ──
    open_reader(pg, B, beta[1])
    ctx.set_offline(True)
    go_to_page(pg, 3)
    queue = pg.evaluate("JSON.parse(localStorage.getItem('scrollarr.progressQueue') || '{}')")
    check('4 network cut: the page is queued on the device', f'f:{beta[1]}' in queue and queue[f'f:{beta[1]}']['page'] == 3, queue)
    check('4 network cut: nothing reached the service', stored(beta[1]) is None)
    ctx.set_offline(False)
    pg.wait_for_function("Object.keys(JSON.parse(localStorage.getItem('scrollarr.progressQueue') || '{}')).length === 0", timeout=20000)
    check('4 network back: the queue is sent', (stored(beta[1]) or {}).get('page') == 3, stored(beta[1]))
    # Service en panne (le proxy répond 502), puis de retour.
    pg.evaluate("fetch('/__mock/outage?mode=deny', { method: 'POST' })")
    go_to_page(pg, 2)
    check('4 service refused: progress stays queued', f'f:{beta[1]}' in pg.evaluate("JSON.parse(localStorage.getItem('scrollarr.progressQueue') || '{}')"))
    pg.evaluate("fetch('/__mock/outage?mode=off', { method: 'POST' })")
    pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    pg.wait_for_function("Object.keys(JSON.parse(localStorage.getItem('scrollarr.progressQueue') || '{}')).length === 0", timeout=40000)
    check('4 service back: page 2 arrived', (stored(beta[1]) or {}).get('page') == 2, stored(beta[1]))

    # ── Fin de chapitre : terminé ; marquer lu / non lu ──
    open_reader(pg, B, alpha[0])
    for _ in range(12):
        pg.evaluate('scrollTo(0, document.documentElement.scrollHeight)'); pg.wait_for_timeout(250)
    pg.wait_for_selector('.end-next > *'); pg.wait_for_timeout(2600)
    p = stored(alpha[0])
    check('4 end of chapter: completed, with the page count learnt from the archive', p and p['completed'] is True and p['page'] == 3, p)
    check('4 the archive page count is now known by the service', svc_get(SVC, f'/api/v1/books/{alpha[0]}')['media']['pagesCount'] == 3)
    pg.goto(B + f'/#/series/f:{alpha_sid}'); pg.wait_for_selector('.eps .ep'); pg.wait_for_timeout(400)
    check('4 series page: one chapter read', pg.locator('.ep.read').count() == 1, pg.locator('.ep.read').count())
    pg.click('.shero-bar .iconbtn >> nth=1'); pg.wait_for_selector('.sheet')
    pg.click('.action >> text=Marquer toute la série comme lue'); pg.wait_for_function("document.querySelectorAll('.ep.read').length === 3", timeout=8000)
    s = svc_get(SVC, f'/api/v1/series/{alpha_sid}')
    check('4 mark series read: all chapters read on the service', (s['booksReadCount'], s['booksUnreadCount']) == (3, 0), s)
    pg.locator('.eps .ep').first.locator('.ep-more').click(); pg.wait_for_selector('.sheet')
    pg.click('.action >> text=Marquer comme non lu'); pg.wait_for_function("document.querySelectorAll('.ep.read').length === 2", timeout=8000)
    check('4 mark chapter unread', stored(alpha[0]) is None and (stored(alpha[1]) or {}).get('completed') is True)
    pg.click('.shero-bar .iconbtn >> nth=1'); pg.wait_for_selector('.sheet')
    pg.click('.action >> text=Remettre toute la série à non lue'); pg.wait_for_function("document.querySelectorAll('.ep.read').length === 0", timeout=8000)
    check('4 mark series unread: nothing left on the service', all(stored(x) is None for x in alpha))
    check('4 the CTA starts again', 'Commencer' in pg.inner_text('.cta .btn'), pg.inner_text('.cta .btn'))

    # ── Accueil : « Reprendre », « Récents », filtre de la bibliothèque ──
    check('4 setup: three series in progress', all(put_progress(pg, book, {'page': 2}) == 204 for book in (alpha[0], gamma[0], beta[2])))
    put_progress(pg, beta[0], {'completed': True})   # un chapitre terminé : « récents » seulement
    pg.goto(B + '/#/library'); pg.goto(B + '/#/home'); pg.reload(); pg.wait_for_selector('.hero', timeout=15000); pg.wait_for_timeout(1000)
    check('4 home: the hero resumes the latest chapter', 'Vous en étiez là' in pg.inner_text('.hero') and 'Reprendre' in pg.inner_text('.hero'), pg.inner_text('.hero')[:80])
    rows = pg.eval_on_selector_all('.row-head h2', 'e=>e.map(x=>x.textContent)')
    check('4 home: "Reprendre" holds the other chapters in progress', rows[:1] == ['Reprendre'] and pg.locator('.resume').count() == 2, (rows, pg.locator('.resume').count()))
    check('4 home: no "Reprendre" card says "not started yet" (an archive never reopened has no page total)', 'Pas encore commencé' not in ' '.join(pg.eval_on_selector_all('.resume', 'e=>e.map(x=>x.innerText)')))
    shot(pg, '75-folders-home-progress.png')
    pg.goto(B + '/#/my/recent'); pg.wait_for_selector('.lines .line'); pg.wait_for_timeout(500)
    lines = pg.eval_on_selector_all('.line', 'e=>e.map(x=>x.innerText.replace(/\\n/g," | "))')
    check('4 recently read: four chapters in progress and the finished one', len(lines) == 5 and 'terminé' in ' '.join(lines), lines)
    check('4 recently read: only unfinished chapters offer "Reprendre"', pg.locator('.line .btn.small').count() == 4, pg.locator('.line .btn.small').count())
    pg.goto(B + '/#/library'); pg.wait_for_selector('.grid .card'); pg.wait_for_timeout(500)
    check('4 library: the reading-status filter is offered (this reader tracks reading)', pg.locator('.filters select').count() == 2, pg.locator('.filters select').count())
    pg.select_option('.filters select >> nth=1', 'IN_PROGRESS'); pg.wait_for_timeout(900)
    names = pg.eval_on_selector_all('.grid .card-title', 'e=>e.map(x=>x.textContent)')
    check('4 library filter "En cours"', sorted(names) == ['Alpha Quest', 'Beta Folders', 'Gamma Tomes'], names)
    pg.select_option('.filters select >> nth=1', 'UNREAD'); pg.wait_for_timeout(900)
    check('4 library filter "Non commencées"', pg.locator('.grid .card').count() == 4, pg.locator('.grid .card').count())
    pg.select_option('.filters select >> nth=1', 'READ'); pg.wait_for_timeout(900)
    check('4 library filter "Terminées": none yet', pg.locator('.grid .card').count() == 0 and 'Aucune série' in pg.inner_text('#view'))
    check('4 no script error', not errs, errs)
    ctx.close()


def folders_only_ui(b):
    fx = folders_fixture()
    folders_service(SVC + 1, fx, 'none')
    server(MOCK + 1, SERVERS='folders', FOLDERS=f'http://127.0.0.1:{SVC + 1}')
    B = f'http://localhost:{MOCK + 1}'
    ctx, pg, errs = phone(b)
    bad, writes = [], []
    # Normaux et écartés : la route « précédent » d'un premier chapitre (404), le service de notifications absent du relais,
    # et une sauvegarde de progression « keepalive » que le navigateur annule en quittant la page (le service la reçoit).
    expected = lambda url: url.endswith('/notify/vapid') or url.endswith('/previous') or url.endswith('/next')
    pg.on('response', lambda r: bad.append((r.status, r.url)) if r.status >= 400 and not expected(r.url) else None)
    pg.on('requestfailed', lambda r: bad.append(('failed', r.url, r.failure)) if not (r.url.endswith('/progress') and r.failure and 'ABORT' in r.failure.upper()) else None)
    pg.on('request', lambda r: writes.append((r.method, r.url)) if r.method != 'GET' else None)
    S = ids(SVC + 1)

    pg.goto(B + '/'); pg.wait_for_selector('.hero', timeout=15000)
    pg.goto(B + '/#/more'); pg.wait_for_selector('.panel'); pg.wait_for_timeout(500)
    text = pg.inner_text('#view')
    check('5 settings: no profile management link', pg.locator('a[href="#/profiles"]').count() == 0)
    check('5 settings: the profile panel explains why', 'Les profils ne sont pas disponibles' in text, text[:300])
    check('5 settings: subscriptions stay on this device', 'abonnements restent sur cet appareil' in text)
    shot(pg, '76-folders-settings.png')
    pg.goto(B + '/#/profiles'); pg.wait_for_selector('.who'); pg.wait_for_timeout(300)
    check('5 profiles screen (direct address): an explanation, no way to add or rename', 'pas possible' in pg.inner_text('.who')
          and pg.locator('.who >> text=Ajouter un profil').count() == 0 and pg.locator('.profile').count() == 0, pg.inner_text('.who')[:200])

    alpha_sid = S['Alpha Quest'][0]
    pg.goto(B + f'/#/series/f:{alpha_sid}'); pg.wait_for_selector('.eps .ep')
    pg.click('.sactions .btn >> nth=0'); pg.wait_for_timeout(1500)
    subs = pg.evaluate("JSON.parse(localStorage.getItem('scrollarr.favorites') || '{}')")
    check('5 a subscription is kept on the device', 'f:' + alpha_sid in json.dumps(subs), subs)
    pg.reload(); pg.wait_for_selector('.eps .ep')
    check('5 the subscription survives a reload', 'Abonné' in pg.inner_text('.sactions'), pg.inner_text('.sactions'))
    pg.goto(B + '/#/my/subscriptions'); pg.wait_for_selector('.my-body .card, .my-body .note', timeout=10000); pg.wait_for_timeout(600)
    check('5 subscriptions tab: the notice and the series', 'restent sur cet appareil' in pg.inner_text('.my-body') and pg.locator('.my-body .card').count() == 1, pg.inner_text('.my-body')[:200])
    shot(pg, '77-folders-subscriptions.png')

    pg.goto(B + '/#/read/f:' + S['Beta Folders'][1][0]); pg.wait_for_selector('.pg.ok', timeout=15000)
    go_to_page(pg, 2)
    pg.goto(B + '/#/home'); pg.wait_for_selector('.hero'); pg.wait_for_timeout(1500)
    check('5 no request failed, none answered with an error', bad == [], bad)
    odd = [w for w in writes if not ('/folders/api/v1/books/' in w[1] and w[1].endswith('/progress') and w[0] == 'PATCH')]
    check('5 the only write requests are progress saves to the folders service', writes and not odd, (writes, odd))
    check('5 no script error', not errs, errs)
    ctx.close()

    # État vide : une bibliothèque montée mais sans aucune série.
    empty = folders_fixture()
    for name in os.listdir(f'{empty}/libraries'):
        os.rename(f'{empty}/libraries/{name}', f'{empty}/spare-{name}')
    os.makedirs(f'{empty}/libraries/Vide')
    folders_service(SVC + 2, empty, 'none')
    server(MOCK + 2, SERVERS='folders', FOLDERS=f'http://127.0.0.1:{SVC + 2}')
    ctx, pg, errs = phone(b)
    pg.goto(f'http://localhost:{MOCK + 2}/'); pg.wait_for_selector('.empty', timeout=15000)
    text = pg.inner_text('.empty')
    check('5 empty library: the home screen says so', 'La bibliothèque est vide' in text, text)
    check('5 empty library: no mention of Komga', 'Komga' not in text, text)
    check('5 empty library: tells to add series on the server', 'serveur' in text, text)
    shot(pg, '78-folders-empty.png')
    ctx.close()


def scenario(b):
    progress_flow(b)
    folders_only_ui(b)


run(scenario)
