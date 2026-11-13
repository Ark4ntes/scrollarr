"""COL-002: search the sources of Suwayomi from the Search screen, add a series, open it.

The demo Suwayomi has six sources (see dev/mock-suwayomi.mjs): MangaFixe (fr, fast), ScanDemo (en), SourceLente (fr, slow),
SourceCassée (fr, always fails), AdultesDemo (fr, flagged 18+ by the server), Multilingue (all), plus the local source
that must never be offered. Nothing may be requested from the sources before the explicit action.
"""
import json
import urllib.request
from _common import server, stop, check, shot, run

B = 'http://localhost:8441'
SEARCH_OPS = ('Sources', 'SourceSearch', 'AddToLibrary', 'FetchChapters')


def seen(port=8441):
    """Operations the demo Suwayomi really received, in order."""
    return json.load(urllib.request.urlopen(f'http://localhost:{port}/suwayomi/__mock/requests'))


def outage(pg, mode):
    pg.evaluate("(m) => fetch('/__mock/outage?mode=' + m, { method: 'POST' })", mode)


def groups(pg):
    return pg.eval_on_selector_all('.remote .src', 'e => e.map((x) => [x.dataset.source, x.dataset.state])')


def search_for(pg, text):
    pg.fill('input[type=search]', text)
    pg.press('input[type=search]', 'Enter')


def scenario(b):
    srv = server(8441, SERVERS='suwayomi', SOURCE_SLOW_MS='2000')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, locale='fr-FR')
    browser_ops = []
    ctx.on('request', lambda r: browser_ops.append(json.loads(r.post_data)['operationName']) if r.method == 'POST' and r.url.endswith('/suwayomi/api/graphql') and r.post_data else None)
    pg = ctx.new_page()
    pg.goto(B + '/#/search'); pg.wait_for_selector('input[type=search]')
    pg.wait_for_timeout(1200)

    # ── Nothing is sent to the sources until the user asks ──
    search_for(pg, 'lune'); pg.wait_for_selector('.grid .card')
    pg.wait_for_selector('.remote .remote-actions')
    check('library results first: the local series matching the title', 'Café Lune Rouge' in pg.inner_text('.grid'), pg.inner_text('.grid'))
    check('the explicit action is below the library results',
          pg.evaluate("document.querySelector('.grid').compareDocumentPosition(document.querySelector('.remote')) & Node.DOCUMENT_POSITION_FOLLOWING") > 0)
    check('the action names the collector', 'Chercher chez les sources de Suwayomi' in pg.inner_text('.remote-actions .btn.primary'), pg.inner_text('.remote-actions'))
    check('the action says nothing starts by itself', 'ne part que si vous la lancez' in pg.inner_text('.remote'), pg.inner_text('.remote'))
    pg.wait_for_timeout(1500)
    check('browser: no source operation before the action', not [o for o in browser_ops if o in SEARCH_OPS], browser_ops)
    check('server: no source operation before the action (not even the list of sources)', not [o for o in seen() if o in SEARCH_OPS], seen())
    check('no source group is displayed', pg.locator('.remote .src').count() == 0)
    check('main navigation unchanged, no new tab', pg.locator('#tabbar .tab').count() == 4, pg.locator('#tabbar .tab').count())
    shot(pg, 'search-before.png')

    # ── The search: default selection, several sources, one slow, one failing ──
    pg.click('.remote-actions .btn.primary')
    pg.wait_for_selector('.remote .src')
    check('while searching the button is disabled', pg.locator('.remote-actions .btn.primary[disabled]').count() == 1)
    pg.wait_for_selector('.src[data-source="1001"][data-state="done"]')
    check('default selection: interface language and multilingual sources, no 18+, no English, no local source',
          sorted(x[0] for x in groups(pg)) == ['1001', '1003', '1004', '1006'], groups(pg))
    slow = dict(groups(pg))['1003']
    check('a slow source does not hold back the others: its group is still waiting or searching', slow in ('run', 'wait'), groups(pg))
    pg.wait_for_selector('.src[data-source="1004"][data-state="error"]')
    check('the failing source shows an error of its own', 'refusé la recherche' in pg.inner_text('.src[data-source="1004"]'), pg.inner_text('.src[data-source="1004"]'))
    check('the failing source does not make the server look down', pg.locator('#offline-banner:not([hidden])').count() == 0)
    check('other sources have their results', 'Lune d’Acier' in pg.inner_text('.src[data-source="1001"]') and 'Lune Polyglotte' in pg.inner_text('.src[data-source="1006"]'))
    pg.wait_for_selector('.src[data-source="1003"][data-state="done"]', timeout=15000)
    check('the slow source answers in the end', 'Lune Lente' in pg.inner_text('.src[data-source="1003"]'))
    pg.wait_for_function("!document.querySelector('.remote-actions .btn.primary[disabled]')")
    check('every request went to one explicit action: four sources searched, once each',
          sorted(o for o in seen() if o == 'SourceSearch') == ['SourceSearch'] * 4, seen())
    head = pg.inner_text('.src[data-source="1001"] .src-head')
    check('a group shows the source, its language', 'MangaFixe' in head and 'FR' in head, head)
    check('the multilingual source says so', 'Toutes langues' in pg.inner_text('.src[data-source="1006"] .src-head'))
    check('another page of results exists: said, not fetched', 'précisez le titre' in pg.inner_text('.src[data-source="1001"]'))
    pg.wait_for_function("[...document.querySelectorAll('.src-cover img')].every((i) => i.complete && (i.naturalWidth > 0 || i.classList.contains('missing')))")
    check('covers come through the same-origin proxy and load',
          pg.evaluate("[...document.querySelectorAll('.src-cover img')].filter((i) => i.getAttribute('src')?.startsWith('/suwayomi/api/v1/manga/') && i.naturalWidth > 0).length") >= 4)
    check('a button now offers another search', 'Chercher de nouveau' in pg.inner_text('.remote-actions .btn.primary'))
    pg.locator('.src[data-source="1001"]').scroll_into_view_if_needed(); pg.wait_for_timeout(300)
    shot(pg, 'search-sources-results.png')
    pg.locator('.src[data-source="1004"]').scroll_into_view_if_needed(); pg.wait_for_timeout(300)
    shot(pg, 'search-sources-failure.png')

    # ── Already in the library: opens the series ──
    inlib = pg.locator('.src[data-source="1001"] .src-item.in')
    check('a result already in the library says so', inlib.count() == 1 and 'Dans la bibliothèque' in inlib.inner_text(), inlib.inner_text())
    check('a result outside the library offers "Ajouter", not a link', pg.locator('.src[data-source="1001"] .src-item:not(.in) .btn', has_text='Ajouter').count() == 2)
    searches = lambda: [o for o in seen() if o in SEARCH_OPS].__len__()
    ops_before = searches()
    inlib.click(); pg.wait_for_selector('.eps .ep')
    check('already in the library: opens the existing series page', pg.evaluate('location.hash') == '#/series/s:2', pg.evaluate('location.hash'))
    pg.go_back(); pg.wait_for_selector('.remote .src')
    check('coming back shows the sources results again, without hitting the sources again',
          len(groups(pg)) == 4 and searches() == ops_before, (groups(pg), searches(), ops_before))

    # ── Add: opens the series page, which then appears in the library, and survives a reload ──
    lib_before = pg.evaluate("fetch('/suwayomi/api/graphql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operationName:'Library'})}).then(r=>r.json()).then(j=>j.data.mangas.nodes.length)")
    pg.locator('.src[data-source="1001"] .src-item:not(.in)', has_text='Lune d’Acier').locator('.btn').click()
    pg.wait_for_selector('.eps .ep')
    check('add: opens the new series page', pg.evaluate('location.hash') == '#/series/s:100', pg.evaluate('location.hash'))
    check('add: the series page lists the chapters fetched from the source', pg.locator('.eps .ep').count() == 12, pg.locator('.eps .ep').count())
    check('add: the title is the one of the result', 'Lune d’Acier' in pg.inner_text('.shero h1'), pg.inner_text('.shero h1'))
    log = seen()
    check('add: operations are the add then the chapter list, once each, in order',
          log.count('AddToLibrary') == 1 and log.count('FetchChapters') == 1 and log.index('FetchChapters') == log.index('AddToLibrary') + 1, log[-5:])
    pg.click('.sactions .btn >> text=Télécharger'); pg.wait_for_selector('.sheet')
    sheet = pg.inner_text('.sheet')
    check('add: the existing download menu applies, including the server download', 'Faire télécharger toute la série par Suwayomi' in sheet and 'Les 5 prochains chapitres' in sheet, sheet)
    pg.keyboard.press('Escape')
    pg.goto(B + '/#/library'); pg.wait_for_selector('.grid .card')
    check('add: the series appears in the library', 'Lune d’Acier' in pg.inner_text('.grid'))
    lib_after = pg.evaluate("fetch('/suwayomi/api/graphql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operationName:'Library'})}).then(r=>r.json()).then(j=>j.data.mangas.nodes.length)")
    check('add: exactly one series more on the server', lib_after == lib_before + 1, (lib_before, lib_after))
    pg.reload(); pg.wait_for_selector('.grid .card')
    check('add: still in the library after a reload', 'Lune d’Acier' in pg.inner_text('.grid'))
    pg.goto(B + '/#/series/s:100'); pg.reload(); pg.wait_for_selector('.eps .ep')
    check('add: the series page survives a reload', pg.locator('.eps .ep').count() == 12)
    pg.goto(B + '/#/search'); search_for(pg, 'lune'); pg.wait_for_selector('.remote .remote-actions')
    pg.click('.remote-actions .btn.primary'); pg.wait_for_selector('.src[data-source="1001"][data-state="done"]')
    check('searching again: the added series now says it is in the library and links to its page',
          pg.locator('.src[data-source="1001"] a.src-item.in[href="#/series/s:100"]').count() == 1)

    # ── Choosing the sources, remembered on the device ──
    pg.click('.remote-actions .textbtn'); pg.wait_for_selector('.sheet .src-pick')
    names = pg.eval_on_selector_all('.sheet .src-pick strong', 'e => e.map((x) => x.textContent)')
    check('the chooser lists the installed sources, not the local one', sorted(names) == ['AdultesDemo', 'MangaFixe', 'Multilingue', 'ScanDemo', 'SourceCassée', 'SourceLente'], names)
    ticked = pg.eval_on_selector_all('.sheet .src-pick', 'e => e.filter((x) => x.querySelector("input").checked).map((x) => x.querySelector("strong").textContent)')
    check('the chooser ticks the default selection', sorted(ticked) == ['MangaFixe', 'Multilingue', 'SourceCassée', 'SourceLente'], ticked)
    adult = pg.locator('.sheet .src-pick', has_text='AdultesDemo')
    check('the 18+ flag of the server is shown, and the source is not ticked', '18+' in adult.inner_text() and not adult.locator('input').is_checked(), adult.inner_text())
    check('the language is shown', 'EN' in pg.locator('.sheet .src-pick', has_text='ScanDemo').inner_text())
    pg.locator('.sheet .src-pick', has_text='Multilingue').locator('input').uncheck()
    pg.locator('.sheet .src-pick', has_text='ScanDemo').locator('input').check()
    pg.wait_for_timeout(300); shot(pg, 'search-source-selection.png')
    check('the button shows how many sources are chosen once the list is known', '(4 sur 6)' in pg.inner_text('.remote-actions .textbtn'), pg.inner_text('.remote-actions .textbtn'))
    pg.keyboard.press('Escape')
    chosen = pg.evaluate("JSON.parse(localStorage.getItem('scrollarr.searchSources'))")
    check('the choice is stored on the device, per collector', {k: sorted(v) for k, v in chosen.items()} == {'suwayomi': ['1001', '1002', '1003', '1004']}, chosen)
    pg.reload(); pg.wait_for_selector('input[type=search]')
    search_for(pg, 'moon'); pg.wait_for_selector('.remote .remote-actions')
    pg.click('.remote-actions .btn.primary'); pg.wait_for_selector('.remote .src'); pg.wait_for_function("!document.querySelector('.remote-actions .btn.primary[disabled]')", timeout=15000)
    check('after a reload, the remembered sources are the ones searched', sorted(x[0] for x in groups(pg)) == ['1001', '1002', '1003', '1004'], groups(pg))
    check('the English source answers', 'Steel Moon' in pg.inner_text('.src[data-source="1002"]') and 'Moonlit Garden' in pg.inner_text('.src[data-source="1002"]'), pg.inner_text('.src[data-source="1002"]'))
    pg.click('.remote-actions .textbtn'); pg.wait_for_selector('.sheet .src-pick')
    check('the chooser reflects the remembered choice', pg.locator('.sheet .src-pick', has_text='ScanDemo').locator('input').is_checked()
          and not pg.locator('.sheet .src-pick', has_text='Multilingue').locator('input').is_checked())
    pg.click('.sheet .btn >> text=Aucune'); pg.wait_for_timeout(200)
    pg.keyboard.press('Escape')
    check('"Aucune" is remembered too', pg.evaluate("JSON.parse(localStorage.getItem('scrollarr.searchSources')).suwayomi") == [])
    ops = len(seen())
    pg.click('.remote-actions .btn.primary'); pg.wait_for_selector('.remote .remote-body .note')
    check('nothing chosen: said clearly, no search sent', 'Aucune source choisie' in pg.inner_text('.remote-body') and 'SourceSearch' not in seen()[ops:], pg.inner_text('.remote-body'))
    pg.click('.remote-actions .textbtn'); pg.wait_for_selector('.sheet .src-pick'); pg.click('.sheet .btn >> text=Réinitialiser'); pg.wait_for_timeout(200)
    check('"Réinitialiser" returns to the default selection and forgets the choice',
          pg.evaluate("JSON.parse(localStorage.getItem('scrollarr.searchSources')).suwayomi") is None
          and pg.locator('.sheet .src-pick', has_text='Multilingue').locator('input').is_checked())
    pg.keyboard.press('Escape')

    # ── Nothing in the library matches: the action is still there ──
    search_for(pg, 'lune de papier xyz'); pg.wait_for_selector('.empty')
    check('no library result: the empty state is followed by the same action', pg.locator('.remote .remote-actions .btn.primary').count() == 1)
    search_for(pg, 'zzzz'); pg.wait_for_selector('.empty')
    pg.click('.remote-actions .btn.primary'); pg.wait_for_selector('.remote .src'); pg.wait_for_function("!document.querySelector('.remote-actions .btn.primary[disabled]')", timeout=15000)
    check('a title nobody has: each working source says it found nothing', sorted(g for g in groups(pg) if g[1] == 'done') == [['1001', 'done'], ['1003', 'done'], ['1006', 'done']]
          and 'Aucun résultat' in pg.inner_text('.src[data-source="1001"]'), groups(pg))
    check('the failing source still reports its own error', dict(groups(pg)).get('1004') == 'error', groups(pg))

    # ── Offline ──
    search_for(pg, 'lune'); pg.wait_for_selector('.remote .remote-actions')
    ctx.set_offline(True)
    pg.wait_for_selector('.remote-offline')
    check('offline: the action is replaced by an explanation', 'Hors ligne' in pg.inner_text('.remote') and pg.locator('.remote .btn').count() == 0, pg.inner_text('.remote'))
    shot(pg, 'search-offline.png')
    ctx.set_offline(False)
    pg.wait_for_selector('.remote-actions .btn.primary')
    check('back online: the action is offered again', pg.locator('.remote-offline').count() == 0)

    # The server stops answering while a result is on screen: adding fails cleanly, nothing is queued
    pg.click('.remote-actions .btn.primary'); pg.wait_for_selector('.src[data-source="1001"][data-state="done"]')
    adds = [o for o in seen() if o in ('AddToLibrary', 'FetchChapters')]
    outage(pg, 'deny')
    pg.locator('.src[data-source="1001"] .src-item:not(.in)', has_text='Lune de Papier').locator('.btn').click()
    pg.wait_for_selector('.toast', timeout=15000)
    check('server unreachable while adding: stays on the search screen with a message', pg.evaluate('location.hash') == '#/search' and pg.locator('.toast').count() >= 1, pg.inner_text('#toasts'))
    check('server unreachable: the button is available again, nothing was added', pg.locator('.src[data-source="1001"] .src-item:not(.in) .btn:not([disabled])', has_text='Ajouter').count() >= 1)
    outage(pg, 'off')
    pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); pg.wait_for_timeout(2500)
    check('no add was queued: once the server answers again, no add was ever received',
          [o for o in seen() if o in ('AddToLibrary', 'FetchChapters')] == adds, seen()[-4:])

    # Server refusing access from the start of the search screen: the action is not offered
    outage(pg, 'deny')
    pg.goto(B + '/#/home'); pg.reload(); pg.wait_for_timeout(1500)
    pg.goto(B + '/#/search'); pg.wait_for_selector('input[type=search]')
    search_for(pg, 'lune'); pg.wait_for_selector('.remote')
    pg.wait_for_selector('.remote-offline', timeout=15000)
    check('server refusing access: explanation and no action', pg.locator('.remote .btn').count() == 0 and 'Hors ligne' in pg.inner_text('.remote'))
    outage(pg, 'off')
    stop(srv)

    # ── Komga only: nothing about sources anywhere ──
    srv = server(8442, SERVERS='komga')
    pg2 = b.new_context(viewport={'width': 390, 'height': 844}, locale='fr-FR').new_page()
    pg2.goto('http://localhost:8442/'); pg2.wait_for_selector('.login-form', timeout=8000)
    pg2.fill('input[name=username]', 'demo@scrollarr.local'); pg2.fill('input[name=password]', 'demo'); pg2.click('button[type=submit]')
    pg2.wait_for_selector('.hero', timeout=8000)
    pg2.goto('http://localhost:8442/#/search'); pg2.wait_for_selector('input[type=search]')
    search_for(pg2, 'veilleurs'); pg2.wait_for_selector('.grid .card'); pg2.wait_for_timeout(500)
    check('Komga only: library results, no action to search the sources', pg2.locator('.remote').count() == 0 and 'sources' not in pg2.inner_text('#view').lower(), pg2.inner_text('#view'))
    search_for(pg2, 'zzzz'); pg2.wait_for_selector('.empty'); pg2.wait_for_timeout(300)
    check('Komga only: an empty search says nothing about sources either', pg2.locator('.remote').count() == 0)
    shot(pg2, 'search-komga-only.png')
    stop(srv)


run(scenario)
