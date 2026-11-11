"""READ-002 T1: a reader that does not declare chapter.progress.write.

The reader is a test-only variant of the Suwayomi connector, injected by rewriting
js/connectors/index.js in the browser (nothing in the shipped code changes).
Control run: the same scenario with the unmodified connector must record progress.
"""
from _common import server, stop, check, run
B = 'http://localhost:8438'

# Suwayomi sans la capacité d'écriture de progression (lecteur de test, jamais livré).
STRIPPED = """
READERS[READERS.findIndex((r) => r.id === 'suwayomi')] = {
  id: 'suwayomi', path: 'suwayomi',
  create: (o) => { const c = createSuwayomi(o); return { ...c, capabilities: c.capabilities.filter((x) => x !== 'chapter.progress.write') }; },
};
"""


def device(b, strip):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, locale='fr-FR', service_workers='block')
    if strip:
        def patch(route):
            res = route.fetch()
            route.fulfill(response=res, body=res.text() + STRIPPED, headers={**res.headers, 'content-length': ''})
        ctx.route('**/js/connectors/index.js', patch)
    pg = ctx.new_page()
    writes = []
    pg.on('request', lambda r: writes.append(r.post_data) if r.method == 'POST' and '"operationName":"Progress"' in (r.post_data or '') else None)
    return pg, writes


def open_first_series(pg):
    pg.goto(B + '/#/home'); pg.goto(B + '/#/series/s:7'); pg.wait_for_selector('.eps .ep')


def read_first(pg):
    pg.click('.eps .ep-link >> nth=0'); pg.wait_for_selector('.pg.ok'); pg.wait_for_timeout(300)
    pg.evaluate('scrollTo(0, document.documentElement.scrollHeight)'); pg.wait_for_selector('.end-next > *'); pg.wait_for_timeout(2600)


def scenario(b):
    srv = server(8438, SERVERS='suwayomi')

    # Control: the unmodified connector offers and records reading state.
    pg, writes = device(b, strip=False)
    open_first_series(pg)
    check('control: series menu button present', pg.locator('.shero-bar .iconbtn').count() == 2, pg.locator('.shero-bar .iconbtn').count())
    pg.locator('.eps .ep').first.locator('.ep-more').click()
    check('control: chapter menu offers mark as read', pg.locator('.action >> text=Marquer comme lu').count() == 1)
    pg.keyboard.press('Escape'); pg.mouse.click(5, 5); pg.wait_for_timeout(300)
    read_first(pg)
    check('control: progress is sent to the server', len(writes) > 0, writes)

    # Reader without progress.write
    pg, writes = device(b, strip=True)
    open_first_series(pg)
    check('series page loads with the test reader', pg.locator('.eps .ep').count() > 0)
    check('no series menu (only the back button)', pg.locator('.shero-bar .iconbtn').count() == 1, pg.locator('.shero-bar .iconbtn').count())
    pg.locator('.eps .ep').first.locator('.ep-more').click(); pg.wait_for_selector('.action')
    acts = pg.eval_on_selector_all('.action', 'e=>e.map(x=>x.textContent)')
    check('chapter menu offers no read/unread action', not any('Marquer' in a for a in acts), acts)
    pg.mouse.click(5, 5); pg.wait_for_timeout(300)
    read_first(pg)
    check('reading works to the end of the chapter', pg.locator('.end-next > *').count() > 0)
    check('no progress request sent', writes == [], writes)
    check('nothing queued locally', pg.evaluate("localStorage.getItem('scrollarr.progressQueue')") in (None, '{}'))
    stop(srv)

run(scenario)
