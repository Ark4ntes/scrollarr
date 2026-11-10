"""SYNC-002: several devices on one secondary profile.

1. two devices change the same chapter without having seen each other (same revision);
2. a device whose clock is two days late makes the latest change;
3. a change made while a slow write is in flight is not lost;
4. subscriptions from two devices are merged entry by entry.
"""
import json
from _common import server, stop, check, run
B = 'http://localhost:8432'
LATE_CLOCK = "(() => { const real = Date.now.bind(Date); Date.now = () => real() - 2 * 86400 * 1000; })()"


def device(b, join=True, clock=None):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, locale='fr-FR')
    if clock:
        ctx.add_init_script(clock)
    pg = ctx.new_page()
    if join:
        pg.goto(B + '/'); pg.wait_for_selector('.who'); pg.click('.profile-main >> text=Duo')
        pg.wait_for_selector('.hero'); pg.wait_for_timeout(600)
    return pg


def series(pg, sid):
    pg.goto(B + '/#/home'); pg.goto(f'{B}/#/series/{sid}'); pg.wait_for_selector('.eps .ep'); pg.wait_for_timeout(300)


def read_first(pg, sid):
    series(pg, sid); pg.click('.eps .ep-link >> nth=0')
    pg.wait_for_selector('.pg.ok'); pg.wait_for_timeout(300)
    pg.evaluate('scrollTo(0, document.documentElement.scrollHeight)'); pg.wait_for_selector('.end-next > *'); pg.wait_for_timeout(2600)


def menu(pg, nth, label, wait=1500):
    pg.locator('.eps .ep').nth(nth).locator('.ep-more').click(); pg.click(f'.action >> text={label}'); pg.wait_for_timeout(wait)


def entry(pg, key, chapter):
    """Stored progress of one chapter as this device knows it: [page, done, date, deleted, revision, device]."""
    return pg.evaluate("""([key, ch]) => {
      const k = Object.keys(localStorage).find((x) => x.startsWith('scrollarr.pmirror.'));
      const docs = JSON.parse(localStorage.getItem(k)).docs;
      return Object.values(docs).map((d) => d.series[key]?.[ch]).find(Boolean) || null;
    }""", [key, chapter])


def reload(pg):
    pg.goto(B + '/#/home'); pg.reload(); pg.wait_for_selector('.hero'); pg.wait_for_timeout(800)


def first_chapter(pg, key):
    return pg.evaluate("""(key) => {
      const k = Object.keys(localStorage).find((x) => x.startsWith('scrollarr.pmirror.'));
      const docs = JSON.parse(localStorage.getItem(k)).docs;
      return Object.values(docs).flatMap((d) => Object.keys(d.series[key] || {}))[0];
    }""", key)


def scenario(b):
    srv = server(8432, SERVERS='suwayomi')
    a = device(b, join=False)
    a.goto(B + '/#/profiles'); a.wait_for_selector('.who'); a.click('text=Ajouter un profil'); a.fill('.sheet input', 'Duo'); a.click('.sheet button[type=submit]')
    a.wait_for_selector('.profile >> nth=1'); a.click('.profile-main >> text=Duo'); a.wait_for_selector('.hero')

    # ── 2. clocks ──
    read_first(a, 's:7')
    late = device(b, clock=LATE_CLOCK)                 # sees the read chapter, then marks it unread
    series(late, 's:7')
    check('late-clock device sees the chapter as read', late.locator('.ep.read').count() == 1)
    menu(late, 0, 'Marquer comme non lu')
    ch = first_chapter(late, '7')
    ea, el = entry(a, '7', ch), entry(late, '7', ch)
    check('the later change carries an older date', el[2] < ea[2], (ea, el))
    check('…and a higher revision', el[4] > ea[4], (ea, el))
    fresh = device(b); series(fresh, 's:7')
    check('clock skew: the later change wins', fresh.locator('.ep.read').count() == 0, fresh.locator('.ep.read').count())
    reload(a); series(a, 's:7')
    check('clock skew: the first device follows', a.locator('.ep.read').count() == 0)

    # ── 1. same revision ──
    # Both devices start from the same known state and cannot see each other's write.
    # The one with the lower identifier writes last, with the later date: only the
    # identifier may decide, not the date and not the order of arrival.
    hi = device(b, clock="localStorage.setItem('scrollarr.device', 'zzzzhigh')")
    lo = device(b, clock="localStorage.setItem('scrollarr.device', 'aaaa0low')")
    def hold(route):
        if 'SetMeta' in (route.request.post_data or ''):
            route.abort()
        else:
            route.continue_()
    for d in (hi, lo):
        d.route('**/suwayomi/api/graphql', hold); series(d, 's:5')
    menu(hi, 0, 'Marquer comme lu', wait=1300)
    menu(lo, 0, 'Marquer comme lu', wait=600)
    ch = first_chapter(hi, '5')
    th, tl = entry(hi, '5', ch), entry(lo, '5', ch)
    check('tie: same revision on both devices', th[4] == tl[4] == 1 and th[5] == 'zzzzhigh' and tl[5] == 'aaaa0low', (th, tl))
    check('tie: the losing device wrote later', tl[2] > th[2], (th, tl))
    for d in (hi, lo):
        d.unroute('**/suwayomi/api/graphql')
    reload(hi); hi.wait_for_timeout(1200); reload(lo); lo.wait_for_timeout(1200); reload(hi)
    fresh = device(b)
    views = [entry(x, '5', ch) for x in (hi, lo, fresh)]
    check('tie: every device ends on the same entry', views[0] == views[1] == views[2], views)
    check('tie: decided by the device identifier', views[2] == th, (views[2], th))

    # ── 3. change during a slow write ──
    slow = device(b)
    def delay(route):
        if 'SetMeta' in (route.request.post_data or ''):
            slow.wait_for_timeout(2500)
        route.continue_()
    slow.route('**/suwayomi/api/graphql', delay)
    series(slow, 's:6')
    menu(slow, 0, 'Marquer comme lu', wait=700)        # write starts, held back 2.5 s
    menu(slow, 1, 'Marquer comme lu', wait=200)        # second change lands while it is in flight
    slow.wait_for_timeout(14000)
    pending = slow.evaluate("JSON.parse(localStorage.getItem(Object.keys(localStorage).find((x) => x.startsWith('scrollarr.pmirror.')))).dirty")
    check('nothing left to send', pending == [], pending)
    fresh = device(b); series(fresh, 's:6')
    check('change made during a write reaches the server', fresh.locator('.ep.read').count() == 2, fresh.locator('.ep.read').count())

    # ── 4. subscriptions ──
    g, h = device(b), device(b)
    def subs(pg):
        pg.goto(B + '/#/home'); pg.goto(B + '/#/my/subscriptions'); pg.wait_for_timeout(900)
        return sorted(pg.eval_on_selector_all('.grid .card-title', 'e=>e.map(x=>x.textContent)'))
    def toggle(pg, sid):
        series(pg, sid); pg.click('.btn >> text=/Abonn|abonner/'); pg.wait_for_timeout(1600)
    toggle(g, 's:5'); toggle(h, 's:6')
    fresh = device(b)
    both = subs(fresh)
    check('subscriptions from two devices are both kept', len(both) == 2, both)
    toggle(g, 's:5')                                    # g unsubscribes
    toggle(h, 's:7')                                    # h never saw that, and writes its list
    fresh = device(b)
    after = subs(fresh)
    check('unsubscribing survives a write from another device', len(after) == 2 and after != both, (both, after))
    reload(g)
    check('first device receives the other subscriptions', subs(g) == after, subs(g))
    stop(srv)


run(scenario)
