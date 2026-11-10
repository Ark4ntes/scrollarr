"""Two devices under the same secondary profile must merge, not overwrite."""
from _common import server, stop, check, launch, run, GQL
B = 'http://localhost:8431'

def ctx_page(b):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, locale='fr-FR')
    pg = ctx.new_page(); return ctx, pg

def read_first(pg, sid):
    pg.goto(f'{B}/#/series/{sid}'); pg.wait_for_selector('.eps .ep'); pg.click('.eps .ep-link >> nth=0')
    pg.wait_for_selector('.pg.ok'); pg.wait_for_timeout(300)
    pg.evaluate('scrollTo(0, document.documentElement.scrollHeight)'); pg.wait_for_selector('.end-next > *'); pg.wait_for_timeout(2600)

def scenario(b):
    srv = server(8431, SERVERS='suwayomi')
    c1, a = ctx_page(b)
    a.goto(B + '/#/profiles'); a.wait_for_selector('.who'); a.click('text=Ajouter un profil'); a.fill('.sheet input', 'Duo'); a.click('.sheet button[type=submit]')
    a.wait_for_selector('.profile >> nth=1'); a.click('.profile-main >> text=Duo'); a.wait_for_selector('.hero')
    # second device opens the same profile BEFORE either reads anything
    c2, d = ctx_page(b)
    d.goto(B + '/'); d.wait_for_selector('.who'); d.click('.profile-main >> text=Duo'); d.wait_for_selector('.hero'); d.wait_for_timeout(500)
    read_first(a, 's:7')      # device 1 reads Neuf Vies ch.1
    read_first(d, 's:5')      # device 2 (stale view) reads La Fille du Phare ch.1
    # same series from both devices: device 2 marks chapter 1 of s:7 unread, device 1 state is older
    c3, n = ctx_page(b)
    n.goto(B + '/'); n.wait_for_selector('.who'); n.click('.profile-main >> text=Duo'); n.wait_for_selector('.hero'); n.wait_for_timeout(600)
    n.goto(B + '/#/my/recent'); n.wait_for_selector('.lines .line'); n.wait_for_timeout(300)
    titles = sorted(n.eval_on_selector_all('.line-title', 'e=>e.map(x=>x.textContent)'))
    check('both devices history kept', titles == ['La Fille du Phare', 'Neuf Vies'], titles)
    for sid in ('s:7', 's:5'):
        n.goto(f'{B}/#/series/{sid}'); n.wait_for_selector('.eps .ep'); n.wait_for_timeout(300)
        check(f'{sid}: chapter 1 read on a third device', n.locator('.ep.read').count() == 1, n.locator('.ep.read').count())
    # deletion must survive a later write from the stale device
    n.locator('.eps .ep').first.locator('.ep-more').click(); n.click('.action >> text=Marquer comme non lu'); n.wait_for_timeout(1500)
    read_first(a, 's:6')      # device 1 (still believes s:5 ch.1 is... unknown) writes its index again
    c4, m = ctx_page(b)
    m.goto(B + '/'); m.wait_for_selector('.who'); m.click('.profile-main >> text=Duo'); m.wait_for_selector('.hero'); m.wait_for_timeout(600)
    m.goto(B + '/#/series/s:5'); m.wait_for_selector('.eps .ep'); m.wait_for_timeout(300)
    check('unread mark survives another device writing', m.locator('.ep.read').count() == 0, m.locator('.ep.read').count())
    m.goto(B + '/#/my/recent'); m.wait_for_selector('.lines .line'); m.wait_for_timeout(300)
    titles = sorted(m.eval_on_selector_all('.line-title', 'e=>e.map(x=>x.textContent)'))
    check('history after unread + new read', titles == ['Dojo Tanuki', 'Neuf Vies'], titles)
    # settings: test button
    m.goto(B + '/#/more'); m.wait_for_selector('.server-row'); m.click('.server-row .btn >> text=Tester'); m.wait_for_selector('.toast'); 
    check('server test button reports latency', 'répond en' in m.inner_text('.toast'), m.inner_text('.toast'))
    stop(srv)

run(scenario)
