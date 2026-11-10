"""OFF-001: a downloaded chapter opens quickly when the server cannot be reached.

Three situations: the server never answers (away from home), a proxy in
front refuses access with an HTML 403, and the device has no network.
"""
import time
from _common import server, stop, check, run
B = 'http://localhost:8435'


def outage(pg, mode):
    pg.evaluate("(m) => fetch('/__mock/outage?mode=' + m, { method: 'POST' })", mode)


def open_time(pg, href, cold):
    """Seconds until the first page of the chapter is displayed."""
    if cold:
        pg.goto(B + '/#/my/downloads'); t = time.time(); pg.goto(B + '/' + href); pg.reload()
    else:
        pg.goto(B + '/#/my/downloads'); pg.wait_for_timeout(300); t = time.time(); pg.goto(B + '/' + href)
    pg.wait_for_selector('.pg.ok', timeout=60000)
    return time.time() - t


def scenario(b):
    srv = server(8435, SERVERS='suwayomi')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, locale='fr-FR')
    pg = ctx.new_page()
    pg.goto(B + '/#/series/s:2'); pg.wait_for_selector('.eps .ep'); pg.wait_for_timeout(1500)   # service worker in place
    pg.click('.sactions .btn >> text=Télécharger'); pg.wait_for_selector('.sheet'); pg.click('.action >> text=Les 5 prochains chapitres')
    pg.wait_for_function("document.querySelectorAll('.dl.done').length === 5", timeout=30000)
    href = pg.evaluate("document.querySelector('.ep:has(.dl.done) a').getAttribute('href')")
    other = pg.evaluate("document.querySelector('.ep:not(:has(.dl.done)) a').getAttribute('href')")

    base = open_time(pg, href, cold=False)
    check('server reachable: chapter opens', base < 4, f'{base:.1f} s')

    for mode, label in (('hang', 'server never answers'), ('deny', 'proxy refuses access')):
        outage(pg, mode)
        cold = open_time(pg, href, cold=True)
        check(f'{label}: cold start opens the downloaded chapter in under 9 s', cold < 9, f'{cold:.1f} s')
        check(f'{label}: offline banner shown', pg.locator('#offline-banner:not([hidden])').count() == 1)
        warm = open_time(pg, href, cold=False)
        check(f'{label}: next opening is immediate', warm < 2.5, f'{warm:.1f} s')
        pg.goto(B + '/#/my/downloads'); pg.wait_for_selector('.dl-series, .my-body'); pg.wait_for_timeout(300)
        check(f'{label}: downloads list still shown', 'Chapitre' in pg.inner_text('#view'), pg.inner_text('#view')[:80])
        outage(pg, 'off')
        pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); pg.wait_for_timeout(2500)
        check(f'{label}: back to normal once the server answers', pg.locator('#offline-banner:not([hidden])').count() == 0)
        pg.goto(B + '/#/home'); pg.goto(B + '/' + other); pg.wait_for_selector('.pg.ok', timeout=15000)
        check(f'{label}: a chapter that is not downloaded opens again', True)

    ctx.set_offline(True)
    cold = open_time(pg, href, cold=True)
    check('no network: cold start opens the downloaded chapter in under 4 s', cold < 4, f'{cold:.1f} s')
    ctx.set_offline(False)
    stop(srv)


run(scenario)
