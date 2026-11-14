"""QA-005: push notifications on the app side, with the REAL notifier behind the demo server (PUSH_DRY_RUN=1).

Headless Chromium cannot register with a push service (pushManager.subscribe fails with "AbortError: Registration
failed - permission denied": no FCM here), so PushManager.subscribe/getSubscription are replaced by a stub in the page
(init script, test only, nothing changes in the app). Everything else is real: the permission, the panel, the requests
to /notify/*, the notifier and what it stores, the service worker and its notifications.

What a headless browser cannot do, and what is checked instead:
  - real delivery through FCM/Mozilla/Apple, and iOS/Safari: not covered here (see tests/README.md);
  - a click on a notification of the operating system: the click handler is run in the real service worker with a
    synthetic NotificationEvent (WindowClient.focus / Clients.openWindow, which the browser reserves for real clicks,
    are replaced by recorders); its logic is also covered by tests/unit_sw_push.mjs.
Ports 8481-8486, 8499 (nothing listens there on purpose).
"""
import base64, json, os, time, urllib.request
from _common import server, notifier_service, check, shot, run

NO_SERVICE, MAIN, NOTIFIER, DENIED, NOTIFIER_DENIED, DEAD = 8481, 8482, 8483, 8484, 8485, 8499
B = f'http://localhost:{MAIN}'
P256DH = base64.urlsafe_b64encode(b'\x04' + os.urandom(64)).decode().rstrip('=')
AUTH = base64.urlsafe_b64encode(os.urandom(16)).decode().rstrip('=')

# Test double of the push registration (the only thing headless Chromium cannot do). The subscription lives in
# localStorage so that it survives a reload, like a real one.
STUB = """(() => {
  const KEY = '__stubSub';
  const make = (endpoint) => ({
    endpoint, expirationTime: null,
    toJSON() { return { endpoint, expirationTime: null, keys: { p256dh: '%s', auth: '%s' } }; },
    async unsubscribe() { localStorage.removeItem(KEY); localStorage.setItem('__stubUnsub', String(Number(localStorage.getItem('__stubUnsub') || 0) + 1)); return true; },
  });
  const current = () => { const e = localStorage.getItem(KEY); return e ? make(e) : null; };
  PushManager.prototype.getSubscription = async () => current();
  PushManager.prototype.subscribe = async (opts) => {
    localStorage.setItem('__stubOpts', JSON.stringify({ userVisibleOnly: opts.userVisibleOnly, key: Array.from(new Uint8Array(opts.applicationServerKey)) }));
    localStorage.setItem(KEY, 'https://push.example.test/' + Math.random().toString(36).slice(2));
    return current();
  };
})();""" % (P256DH, AUTH)

PANEL = '.panel:has(h2:text-is("Notifications"))'
TOGGLE = PANEL + ' input[type=checkbox]'
TEST_BTN = PANEL + ' button:has-text("Envoyer un test")'


def until(fn, timeout=15, step=0.2):
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(step)
    return fn()


def pushes(log):
    out = []
    for line in open(log, encoding='utf8'):
        if line.startswith('PUSH '):
            _, user, rest = line.rstrip('\n').split(' ', 2)
            out.append((user, json.loads(rest)))
    return out


def subscriptions(data):
    try:
        return json.load(open(os.path.join(data, 'subscriptions.json')))
    except Exception:
        return {}


def http(method, url):
    return json.load(urllib.request.urlopen(urllib.request.Request(url, method=method), timeout=5))


def watch(pg):
    """Every request of the page to /notify/, in order: [method, path, body, status] (status filled when the response arrives)."""
    seen, by_request = [], {}
    def on_request(r):
        if '/notify/' in r.url:
            entry = [r.method, r.url.split('/notify')[1], r.post_data, None]
            seen.append(entry); by_request[r] = entry
    def on_response(r):
        if r.request in by_request:
            by_request[r.request][3] = r.status
    pg.on('request', on_request)
    pg.on('response', on_response)
    return seen


def toast(pg, text, timeout=6000):
    pg.wait_for_selector(f'.toast:has-text("{text}")', timeout=timeout)
    return True


def stored_notifications(pg):
    return pg.evaluate("""navigator.serviceWorker.ready.then((r) => r.getNotifications()).then((l) => l.map((n) => (
      { title: n.title, body: n.body, tag: n.tag, path: n.data && n.data.path, icon: n.icon, badge: n.badge })))""")


def scenario(b):
    # ───────────── 1. No notifier on this server ─────────────
    server(NO_SERVICE, SERVERS='suwayomi')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, locale='fr-FR')
    ctx.grant_permissions(['notifications'], origin=f'http://localhost:{NO_SERVICE}')
    pg = ctx.new_page()
    seen = watch(pg)
    pg.goto(f'http://localhost:{NO_SERVICE}/#/more'); pg.wait_for_selector(PANEL + ' .note')
    text = pg.inner_text(PANEL)
    check('absent service: the panel says it is not installed', 'Le service de notifications n’est pas installé sur ce serveur' in text, text)
    check('absent service: no switch, no test button', pg.locator(PANEL + ' input').count() == 0 and pg.locator(PANEL + ' button').count() == 0)
    check('absent service: the app only asked for the key (one GET), nothing else', [(m, p) for m, p, _, _ in seen] == [('GET', '/vapid')] and seen[0][3] == 404, seen)
    shot(pg, 'push-absent.png')
    pg.evaluate("localStorage.setItem('scrollarr.push', '1')")  # stale flag from an older install: no effect without the service
    pg.reload(); pg.wait_for_selector(PANEL + ' .note')
    check('absent service: a stale "enabled" flag changes nothing', pg.locator(PANEL + ' input').count() == 0)
    ctx.close()

    # Browser without push (iPhone outside the home-screen app)
    nopush = b.new_context(viewport={'width': 390, 'height': 844}, locale='fr-FR')
    nopush.add_init_script('delete window.PushManager;')
    pn = nopush.new_page(); seen = watch(pn)
    pn.goto(f'http://localhost:{NO_SERVICE}/#/more'); pn.wait_for_selector(PANEL + ' .note')
    text = pn.inner_text(PANEL)
    check('unsupported browser: explains it, mentions the home screen on iPhone', 'Ce navigateur ne gère pas les notifications' in text and 'écran d’accueil' in text, text)
    check('unsupported browser: no request to the notifier at all', seen == [], seen)
    nopush.close()

    # ───────────── 2. Notifier present ─────────────
    srv = server(MAIN, SERVERS='suwayomi', NOTIFIER=f'http://127.0.0.1:{NOTIFIER}')
    notif, data, log = notifier_service(NOTIFIER, suwayomi_port=MAIN)
    key = http('GET', f'{B}/notify/vapid')['publicKey']
    vapid_bytes = list(base64.urlsafe_b64decode(key + '=' * (-len(key) % 4)))

    # 2a. permission refused by the browser
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, locale='fr-FR')
    ctx.add_init_script(STUB)
    pg = ctx.new_page(); seen = watch(pg)
    pg.goto(B + '/#/more'); pg.wait_for_selector(TOGGLE)
    check('present service: switch off, no test button', not pg.is_checked(TOGGLE) and pg.locator(TEST_BTN).count() == 0)
    label = pg.inner_text(PANEL)
    check('present service: the switch is described', 'M’avertir quand un chapitre arrive dans une série à laquelle je suis abonné' in label, label)
    shot(pg, 'push-present.png')
    check('permission not asked yet', pg.evaluate('Notification.permission') == 'default')
    pg.click(TOGGLE)
    check('refused permission: the app explains how to unblock', toast(pg, 'Notifications bloquées'))
    until(lambda: pg.locator(TOGGLE).count() and not pg.is_checked(TOGGLE))
    check('refused permission: switch back off, nothing sent to the notifier', not [s for s in seen if s[0] == 'POST'], seen)
    check('refused permission: no subscription, no flag', pg.evaluate("[localStorage.getItem('__stubSub'), localStorage.getItem('scrollarr.push')]") == [None, None])
    ctx.close()

    # 2b. permission granted: enable, favorites follow, test, real chapter, disable
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, locale='fr-FR')
    ctx.grant_permissions(['notifications'], origin=B)
    ctx.add_init_script(STUB)
    pg = ctx.new_page(); seen = watch(pg)
    pg.goto(B + '/#/more'); pg.wait_for_selector(TOGGLE)
    pg.evaluate('navigator.serviceWorker.ready.then(() => true)')
    pg.click(TOGGLE)
    check('enable: confirmation toast', toast(pg, 'Notifications activées'))
    pg.wait_for_selector(TEST_BTN)
    check('enable: switch on and test button offered', pg.is_checked(TOGGLE) and pg.locator(TEST_BTN).count() == 1)
    posts = [s for s in seen if s[0] == 'POST']
    check('enable: one POST /subscribe, answered 200', [(s[1], s[3]) for s in posts] == [('/subscribe', 200)], posts)
    body = json.loads(posts[0][2])
    stub_endpoint = pg.evaluate("localStorage.getItem('__stubSub')")
    check('enable: body carries the subscription (endpoint and keys), the favorites list and the language',
          body['subscription']['endpoint'] == stub_endpoint and body['subscription']['keys'] == {'p256dh': P256DH, 'auth': AUTH}
          and body['favorites'] == [] and body['lang'] == 'fr', body)
    opts = json.loads(pg.evaluate("localStorage.getItem('__stubOpts')"))
    check('enable: subscribed with the notifier VAPID key, user-visible', opts == {'userVisibleOnly': True, 'key': vapid_bytes}, opts)
    check('enable: the flag is kept and the notifier knows one device', pg.evaluate("localStorage.getItem('scrollarr.push')") == '1' and http('GET', f'{B}/notify/health')['subscriptions'] == 1)
    check('enable: the notifier stored it for the session user, English default replaced by fr',
          [(v['userId'], v['lang'], v['favorites']) for v in subscriptions(data).values()] == [('suwayomi', 'fr', [])], subscriptions(data))
    shot(pg, 'push-enabled.png')

    pg.reload(); pg.wait_for_selector(TOGGLE); pg.wait_for_selector(TEST_BTN)
    check('reload: the panel still shows it enabled', pg.is_checked(TOGGLE))

    # favorites follow the subscription
    n_posts = len([s for s in seen if s[1] == '/subscribe'])
    pg.goto(B + '/#/series/s:1'); pg.wait_for_selector('.eps .ep')
    pg.click('button:has-text("S’abonner")')
    until(lambda: subscriptions(data) and list(subscriptions(data).values())[0]['favorites'] == ['s:1'])
    check('favorites: following a series sends the new list to the notifier', list(subscriptions(data).values())[0]['favorites'] == ['s:1'], subscriptions(data))
    pg.goto(B + '/#/series/s:2'); pg.wait_for_selector('.eps .ep'); pg.click('button:has-text("S’abonner")')
    until(lambda: sorted(list(subscriptions(data).values())[0]['favorites']) == ['s:1', 's:2'])
    pg.click('button:has-text("Abonné")')
    until(lambda: list(subscriptions(data).values())[0]['favorites'] == ['s:1'])
    check('favorites: stopping to follow removes it from the list', list(subscriptions(data).values())[0]['favorites'] == ['s:1'], subscriptions(data))
    until(lambda: len([s for s in seen if s[1] == '/subscribe']) - n_posts == 3)
    check('favorites: one POST per change, never for an unchanged list', len([s for s in seen if s[1] == '/subscribe']) - n_posts == 3, [json.loads(s[2])['favorites'] for s in seen if s[1] == '/subscribe'])

    # test button
    pg.goto(B + '/#/more'); pg.wait_for_selector(TEST_BTN)
    pg.click(TEST_BTN)
    check('test button: confirmation toast', toast(pg, 'Notification de test envoyée'))
    got = until(lambda: [p for p in pushes(log) if p[1]['tag'] == 'test'])
    check('test button: the notifier sends the test message to this device', got == [('suwayomi', {'title': 'Scrollarr', 'body': 'Les notifications fonctionnent.', 'tag': 'test', 'path': '/my/subscriptions'})], got)
    post = [s for s in seen if s[1] == '/test'][0]
    check('test button: POST /test carries the device endpoint', json.loads(post[2]) == {'endpoint': stub_endpoint} and post[3] == 200, post)

    # a real chapter: from the notifier's log to the real service worker
    until(lambda: os.path.exists(os.path.join(data, 'seen.json')))
    time.sleep(0.5)
    http('POST', f'{B}/suwayomi/__mock/add-chapter?manga=1')
    chapter = until(lambda: [p for p in pushes(log) if p[1]['tag'] == 'series-s:1'], timeout=15)
    check('chapter: the notifier announces it once, with the payload the worker expects',
          len(chapter) == 1 and chapter[0][1] == {'title': 'Les Veilleurs de Brume', 'body': 'Nouveau chapitre : Chapitre 39', 'tag': 'series-s:1', 'path': '/series/s:1'}, chapter)

    cdp = ctx.new_cdp_session(pg)
    regs = []
    cdp.on('ServiceWorker.workerRegistrationUpdated', lambda e: regs.extend(e['registrations']))
    cdp.send('ServiceWorker.enable')
    # The registrations are only reported when something changes: ask the browser to check the script again.
    pg.evaluate("navigator.serviceWorker.getRegistration().then((r) => r.update())")
    until(lambda: regs)
    reg_id = next((r['registrationId'] for r in regs if r['scopeURL'].startswith(B)), None)
    check('service worker: registration found through the DevTools protocol', reg_id is not None, regs)

    def deliver(raw):
        cdp.send('ServiceWorker.deliverPushMessage', {'origin': B, 'registrationId': reg_id, 'data': raw})

    deliver(json.dumps(chapter[0][1]))
    shown = until(lambda: stored_notifications(pg))
    check('push: the worker shows the notification (title, body, tag)', [(n['title'], n['body'], n['tag']) for n in shown] == [('Les Veilleurs de Brume', 'Nouveau chapitre : Chapitre 39', 'series-s:1')], shown)
    check('push: it keeps the path for the click and has an icon and a badge', shown and shown[0]['path'] == '/series/s:1' and shown[0]['icon'].endswith('/icons/icon-192.png') and shown[0]['badge'].endswith('/icons/badge-96.png'), shown)
    deliver(json.dumps({**chapter[0][1], 'body': '2 nouveaux chapitres'}))
    time.sleep(1)
    again = stored_notifications(pg)
    check('push: a second message of the same series replaces the first (same tag, one entry)', [(n['body'], n['tag']) for n in again] == [('2 nouveaux chapitres', 'series-s:1')], again)
    deliver('ceci n’est pas du JSON')
    until(lambda: len(stored_notifications(pg)) == 2)
    junk = [n for n in stored_notifications(pg) if n['tag'] == '']
    check('push: an unreadable message still shows a notification (title Scrollarr, goes home)', len(junk) == 1 and junk[0]['title'] == 'Scrollarr' and junk[0]['path'] == '/home', stored_notifications(pg))

    # click: the real handler, in the real worker, with a synthetic event (focus and openWindow are the browser's to grant)
    worker = next(w for w in ctx.service_workers if w.url.endswith('/sw.js'))
    CLICK = """async (tag) => {
      const [n] = await self.registration.getNotifications({ tag });
      WindowClient.prototype.focus = async function () { self.__focused = (self.__focused || 0) + 1; return this; };
      Clients.prototype.openWindow = async function (url) { self.__opened = url; return null; };
      self.__focused = 0; self.__opened = null;
      const e = new NotificationEvent('notificationclick', { notification: n });
      const waits = []; e.waitUntil = (p) => waits.push(p);
      self.dispatchEvent(e); await Promise.all(waits);
      return { focused: self.__focused, opened: self.__opened, left: (await self.registration.getNotifications({ tag })).length };
    }"""
    pg.goto(B + '/#/home'); pg.wait_for_selector('#tabbar')
    res = worker.evaluate(CLICK, 'series-s:1')
    pg.wait_for_function("location.hash === '#/series/s:1'")
    check('click: the open window is focused and the app navigates to the series', res['focused'] == 1 and res['opened'] is None and pg.evaluate('location.hash') == '#/series/s:1', res)
    check('click: the notification is closed', res['left'] == 0, res)
    pg.wait_for_selector('.eps .ep')
    check('click: the series page is the one announced', 'Les Veilleurs de Brume' in pg.inner_text('body'))
    pg.goto(B + '/#/home')
    res = worker.evaluate(CLICK, '')   # the unreadable message: path /home
    pg.wait_for_function("location.hash === '#/home'")
    check('click: a notification without a path goes home', pg.evaluate('location.hash') == '#/home' and res['focused'] == 1, res)
    deliver(json.dumps({'title': 'Scrollarr', 'body': 'x', 'tag': 'test', 'path': '/my/subscriptions'}))
    until(lambda: any(n['tag'] == 'test' for n in stored_notifications(pg)))
    res = worker.evaluate(CLICK, 'test')
    pg.wait_for_function("location.hash === '#/my/subscriptions'")
    check('click: the test notification opens the subscriptions list', res['focused'] == 1 and pg.evaluate('location.hash') == '#/my/subscriptions', res)
    # no window of the app left: the worker opens one (recorded, not performed)
    deliver(json.dumps(chapter[0][1]))
    until(lambda: worker.evaluate("self.registration.getNotifications({ tag: 'series-s:1' }).then((l) => l.length)") == 1)
    pg.close()
    res = worker.evaluate(CLICK, 'series-s:1')
    check('click: no open window, the worker opens the application at the path', res['opened'] == '/#/series/s:1' and res['focused'] == 0, res)

    # disable
    pg = ctx.new_page(); seen = watch(pg)
    pg.goto(B + '/#/more'); pg.wait_for_selector(TOGGLE); pg.wait_for_selector(TEST_BTN)
    pg.click(TOGGLE)
    check('disable: confirmation toast', toast(pg, 'Notifications désactivées'))
    until(lambda: pg.locator(TOGGLE).count() and not pg.is_checked(TOGGLE))
    post = [s for s in seen if s[1] == '/unsubscribe']
    check('disable: POST /unsubscribe with the device endpoint, 200', len(post) == 1 and json.loads(post[0][2]) == {'endpoint': stub_endpoint} and post[0][3] == 200, post)
    check('disable: browser subscription dropped, flag removed, notifier forgot the device',
          pg.evaluate("[localStorage.getItem('__stubSub'), localStorage.getItem('scrollarr.push'), localStorage.getItem('__stubUnsub')]") == [None, None, '1'] and http('GET', f'{B}/notify/health')['subscriptions'] == 0)
    check('disable: test button gone', pg.locator(TEST_BTN).count() == 0)
    before = len(pushes(log))
    http('POST', f'{B}/suwayomi/__mock/add-chapter?manga=1')
    time.sleep(7)
    check('disable: no notification for a later chapter', len(pushes(log)) == before, pushes(log)[before:])

    # the notifier goes away while the panel is open
    pg.click(TOGGLE); pg.wait_for_selector(TEST_BTN)
    notif.kill(); notif.wait()
    pg.click(TEST_BTN)
    check('notifier down: the test button reports the failure', toast(pg, 'L’envoi du test a échoué'))
    pg.reload(); pg.wait_for_selector(PANEL + ' .note')
    check('notifier down: the panel falls back to "not installed"', 'pas installé' in pg.inner_text(PANEL), pg.inner_text(PANEL))
    ctx.close()

    # ───────────── 3. The notifier refuses this session ─────────────
    server(DENIED, SERVERS='suwayomi', NOTIFIER=f'http://127.0.0.1:{NOTIFIER_DENIED}')
    # watches a Suwayomi that does not answer: it cannot vouch for anyone, but still publishes its key
    notifier_service(NOTIFIER_DENIED, SUWAYOMI_URL=f'http://127.0.0.1:{DEAD}/suwayomi')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, locale='fr-FR')
    ctx.grant_permissions(['notifications'], origin=f'http://localhost:{DENIED}')
    ctx.add_init_script(STUB)
    pg = ctx.new_page(); seen = watch(pg)
    pg.goto(f'http://localhost:{DENIED}/#/more'); pg.wait_for_selector(TOGGLE)
    pg.click(TOGGLE)
    check('refused by the notifier (401): the app says activation failed', toast(pg, 'Activation impossible'))
    until(lambda: pg.locator(TOGGLE).count() and not pg.is_checked(TOGGLE))
    sub = [s for s in seen if s[1] == '/subscribe']
    check('refused by the notifier: one POST answered 401, switch off, no flag kept', len(sub) == 1 and sub[0][3] == 401 and pg.evaluate("localStorage.getItem('scrollarr.push')") is None, seen)
    ctx.close()


run(scenario)
