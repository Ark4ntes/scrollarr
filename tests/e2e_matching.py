"""LIB-007: manual series matching ("these are the same series" / "these are not the same series").

Demo servers: Suwayomi (priority) and Komga. Suwayomi "Dojo Tanuki" (s:6) and Komga "Tokyo Minuit Express" (k:S002) have
different titles and are both listed; Suwayomi "Les Veilleurs de Brume" (s:1) and Komga "Les Veilleurs de Brume" (k:S001)
have the same title and are merged automatically. Four scenarios, each on its own demo server so that no decision leaks:
  1. group two series with different titles (library, home, search, sheets, reload, second device, undo, setting off,
     grouping from the lower-priority copy);
  2. declare two series with the same title different (same checks, undo, removal from Settings);
  3. a decision about a series that no longer exists: listed as orphaned, hides nothing, can be removed;
  4. no key-value store on any server (hasStore() false): decisions stay on the device, nothing is sent.
"""
import json
import re
from _common import server, stop, check, shot, run, GQL

W = {'width': 390, 'height': 844}
DOJO, TOKYO, VEILLEURS_S, VEILLEURS_K = 's:6', 'k:S002', 's:1', 'k:S001'


def device(b, base, init=None, no_store=False):
    """A new device (browser context) signed in to both servers."""
    ctx = b.new_context(viewport=W, is_mobile=True, has_touch=True, locale='fr-FR', service_workers='block' if no_store else 'allow')
    if init:
        ctx.add_init_script(init)
    if no_store:
        # Same app, readers that do not announce a key-value store: hasStore() is false, nothing else changes.
        def strip(route):
            res = route.fetch()
            route.fulfill(response=res, body=re.sub(r'CAP\.SETTINGS_STORE,?\s*', '', res.text()))
        ctx.route(re.compile(r'/js/connectors/readers/(komga|suwayomi)\.js'), strip)
    pg = ctx.new_page()
    pg.errors = []
    pg.on('pageerror', lambda e: pg.errors.append(str(e)))
    pg.base = base
    pg.goto(base + '/')
    pg.wait_for_selector('.login-form')
    pg.fill('input[name=username]', 'demo@scrollarr.local'); pg.fill('input[name=password]', 'demo'); pg.click('button[type=submit]')
    pg.wait_for_selector('.hero', timeout=8000); pg.wait_for_timeout(900)
    return ctx, pg


def library(pg, reload=False):
    pg.goto(pg.base + '/#/home')
    if reload:
        pg.reload(); pg.wait_for_selector('.hero'); pg.wait_for_timeout(500)
    pg.goto(pg.base + '/#/library'); pg.wait_for_selector('.grid .card'); pg.wait_for_timeout(1300)
    return pg.eval_on_selector_all('.grid .card-title', 'e => e.map(x => x.textContent)')


def home_rows(pg):
    pg.goto(pg.base + '/#/library'); pg.goto(pg.base + '/#/home'); pg.wait_for_selector('.hero'); pg.wait_for_timeout(1500)
    return {r[0]: r[1] for r in pg.eval_on_selector_all('.row', 'rows => rows.map(r => [r.querySelector("h2").textContent, [...r.querySelectorAll(".card-title")].map(x => x.textContent)])')}


def searched(pg, q):
    pg.goto(pg.base + '/#/search'); pg.wait_for_selector('input[type=search]')
    pg.fill('input[type=search]', q); pg.press('input[type=search]', 'Enter'); pg.wait_for_timeout(1200)
    return pg.eval_on_selector_all('.search-out .grid .card-title', 'e => e.map(x => x.textContent)')


def series_page(pg, sid):
    pg.keyboard.press('Escape')  # a sheet left open belongs to the previous step; navigating does not close it
    pg.goto(pg.base + '/#/home'); pg.goto(f'{pg.base}/#/series/{sid}'); pg.wait_for_selector('.eps .ep'); pg.wait_for_timeout(900)


def toast(pg):
    return pg.eval_on_selector_all('.toast span', 'e => e.map(x => x.textContent)')


def undo(pg):
    pg.locator('.toast button', has_text='Défaire').last.click(); pg.wait_for_timeout(900)  # the newest toast


def group_from(pg, sid, query, pick):
    """Series menu > "Regrouper avec une autre série…" > search > choose."""
    series_page(pg, sid)
    pg.click('button[aria-label="Autres actions"]'); pg.click('.action >> text=Regrouper avec une autre série…')
    pg.wait_for_selector('.sheet input[type=search]')
    pg.wait_for_timeout(700)
    first = pg.input_value('.sheet input[type=search]')
    rows = pg.eval_on_selector_all('.sheet .src-item', 'e => e.map(x => x.textContent)')
    pg.fill('.sheet input[type=search]', query); pg.wait_for_selector(f'.sheet .src-item >> text={pick}'); pg.wait_for_timeout(300)
    found = pg.eval_on_selector_all('.sheet .src-item', 'e => e.map(x => x.textContent)')
    return first, rows, found


def decisions(pg):
    """Active decisions as this device keeps them."""
    return pg.evaluate("(() => { const d = JSON.parse(localStorage.getItem('scrollarr.matches') || 'null'); return d ? d.e.filter((x) => !x.del).map((x) => [x.k, x.a, x.b]) : []; })()")


def settings_line(pg):
    pg.keyboard.press('Escape')
    pg.goto(pg.base + '/#/home'); pg.goto(pg.base + '/#/more'); pg.wait_for_selector('.server-row'); pg.wait_for_timeout(500)
    return pg.inner_text('.matches')


def open_decisions(pg):
    pg.keyboard.press('Escape')
    pg.goto(pg.base + '/#/home'); pg.goto(pg.base + '/#/more'); pg.wait_for_selector('.server-row')
    pg.click('.matches button >> text=Voir les décisions'); pg.wait_for_selector('.sheet .copy')


def stored_on_server(pg):
    metas = pg.evaluate(GQL, ['Metas', {'prefix': 'scrollarr.matches'}])['data']['metas']['nodes']
    return [json.loads(m['value']) for m in metas if m['key'] == 'scrollarr.matches']


def scenario(b):
    # ── 1. group two series whose titles differ ──
    B = 'http://localhost:8487'
    srv = server(8487)
    ctx, a = device(b, B)
    titles = library(a)
    check('1 start: both series are listed (19 = 14 + 7 - 2 same-title copies)', len(titles) == 19 and 'Dojo Tanuki' in titles and 'Tokyo Minuit Express' in titles, titles)
    check('1 start: Tokyo is in the home rows', any('Tokyo Minuit Express' in v for v in home_rows(a).values()))
    series_page(a, DOJO)
    check('1 start: no "Aussi sur" line on a series with no copy', a.locator('.dup .textbtn').count() == 0 and a.locator('.dup').is_hidden())
    check('1 start: settings say there is no decision', 'Aucune décision manuelle' in settings_line(a), settings_line(a))

    first, rows, found = group_from(a, DOJO, 'Tokyo', 'Tokyo Minuit Express')
    check('1 sheet: search is prefilled with the current title', first == 'Dojo Tanuki', first)
    check('1 sheet: no result from the current server', all('Suwayomi' not in r for r in found) and any('Komga' in r for r in found), found)
    shot(a, 'lib007-group-sheet.png')
    a.click('.sheet .src-item >> text=Tokyo Minuit Express'); a.wait_for_timeout(1200)
    check('1 group: toast says which copy stays visible', any('« Dojo Tanuki » (Suwayomi) reste affichée' in x for x in toast(a)), toast(a))
    check('1 group: the series being viewed is the visible one, we stay on it', a.evaluate('location.hash') == f'#/series/{DOJO}', a.evaluate('location.hash'))
    check('1 group: one decision stored on the device', len(decisions(a)) == 1 and decisions(a)[0][0] == 'same', decisions(a))

    check('1 group: library lists only the priority one (18)', (lambda t: len(t) == 18 and 'Dojo Tanuki' in t and 'Tokyo Minuit Express' not in t)(library(a)))
    rows = home_rows(a)
    check('1 group: home rows (new chapters, new series, updates) no longer list the hidden copy', not any('Tokyo Minuit Express' in v for v in rows.values()), {k: len(v) for k, v in rows.items()})
    check('1 group: search finds neither the hidden copy…', 'Tokyo Minuit Express' not in searched(a, 'tokyo'))
    check('1 group: …but still the visible one', 'Dojo Tanuki' in searched(a, 'dojo'))
    series_page(a, DOJO)
    check('1 sheet: the line names the server of the hidden copy', a.inner_text('.dup .textbtn').strip() == 'Aussi sur Komga', a.inner_text('.dup'))
    a.click('.dup .textbtn'); a.wait_for_selector('.sheet .copy'); a.wait_for_timeout(500)
    sheet_text = a.inner_text('.sheet')
    check('1 sheet: lists the copy with title, server and the manual link', 'Tokyo Minuit Express' in sheet_text and 'Komga' in sheet_text and 'Regroupée à la main' in sheet_text, sheet_text)
    check('1 sheet: states that progress and chapters are not merged', 'ne sont pas fusionnés' in sheet_text)
    check('1 sheet: a way to open the copy and a way to separate', a.locator('.sheet a.btn[href="#/series/k:S002"]').count() == 1 and a.locator('.sheet button >> text=Ce n’est pas la même série').count() == 1)
    shot(a, 'lib007-also-sheet.png')
    a.keyboard.press('Escape')

    check('1 persist: still grouped after a reload', len(library(a, reload=True)) == 18)
    stored = stored_on_server(a)
    check('1 persist: the document is stored on the servers (one live decision)', len(stored) == 1 and len([x for x in stored[0]['e'] if not x.get('del')]) == 1, stored)
    check('1 persist: settings count it', '1 décision manuelle' in settings_line(a), settings_line(a))

    ctx2, d2 = device(b, B)
    check('1 second device: sees the grouping after its first load', len(library(d2)) == 18)
    check('1 second device: the same decision is stored there', len(decisions(d2)) == 1, decisions(d2))

    # a hidden copy opened directly
    series_page(d2, TOKYO)
    notice = d2.inner_text('.dup')
    check('1 hidden copy: notice says it is grouped with the visible series', 'regroupée avec « Dojo Tanuki » (Suwayomi)' in notice, notice)
    d2.click('.dup a.btn >> text=Voir « Dojo Tanuki »'); d2.wait_for_selector('.eps .ep'); d2.wait_for_timeout(500)
    check('1 hidden copy: the way back opens the visible series', d2.evaluate('location.hash') == f'#/series/{DOJO}', d2.evaluate('location.hash'))
    ctx2.close()

    # undo from the sheet, then undo of the undo
    series_page(a, DOJO)
    a.click('.dup .textbtn'); a.wait_for_selector('.sheet .copy'); a.click('.sheet button >> text=Ce n’est pas la même série'); a.wait_for_timeout(1500)
    check('1 separate: toast confirms', any('n’est plus regroupée' in x for x in toast(a)), toast(a))
    check('1 separate: no decision left, both listed again (19)', decisions(a) == [] and len(library(a)) == 19)
    check('1 separate: no title match here, so no "different" decision was added', 'Aucune décision manuelle' in settings_line(a))
    series_page(a, DOJO)
    check('1 separate: the "Aussi sur" line is gone', a.locator('.dup .textbtn').count() == 0)

    # undo of the grouping itself
    group_from(a, DOJO, 'Tokyo', 'Tokyo Minuit Express')
    a.click('.sheet .src-item >> text=Tokyo Minuit Express'); a.wait_for_timeout(1000)
    undo(a)
    check('1 undo: toast action takes the grouping back (19, no decision)', len(library(a)) == 19 and decisions(a) == [])

    # "Afficher les deux" turns everything off, decisions included
    group_from(a, DOJO, 'Tokyo', 'Tokyo Minuit Express')
    a.click('.sheet .src-item >> text=Tokyo Minuit Express'); a.wait_for_timeout(1200)
    check('1 setting: grouped again (18)', len(library(a)) == 18)
    a.goto(B + '/#/more'); a.wait_for_selector('.server-row'); a.select_option('.panel .select select', 'all'); a.wait_for_timeout(500)
    t_all = library(a)
    check('1 setting: "Afficher les deux" lists everything, decisions included (21)', len(t_all) == 21 and 'Tokyo Minuit Express' in t_all, len(t_all))
    series_page(a, DOJO)
    check('1 setting: no "Aussi sur" line while the setting is off', a.locator('.dup .textbtn').count() == 0)
    series_page(a, TOKYO)
    check('1 setting: no notice on the copy either', a.locator('.dup').is_hidden())
    a.goto(B + '/#/more'); a.wait_for_selector('.server-row'); a.select_option('.panel .select select', 'suwayomi'); a.wait_for_timeout(500)
    check('1 setting: back to "Garder celle de Suwayomi": grouped again (18)', len(library(a)) == 18)

    # grouping from the lower-priority copy navigates to the visible one
    open_decisions(a)
    a.click('.sheet .copy button >> text=Retirer'); a.wait_for_timeout(800); a.keyboard.press('Escape')
    check('1 settings: a decision is removed from the review sheet (19)', decisions(a) == [] and len(library(a)) == 19)
    first, rows, found = group_from(a, TOKYO, 'Dojo', 'Dojo Tanuki')
    check('1 lower copy: search is prefilled with the current title', first == 'Tokyo Minuit Express', first)
    a.click('.sheet .src-item >> text=Dojo Tanuki'); a.wait_for_timeout(1500)
    check('1 lower copy: navigates to the visible series', a.evaluate('location.hash') == f'#/series/{DOJO}', a.evaluate('location.hash'))
    check('1 lower copy: toast says the Suwayomi one stays', any('« Dojo Tanuki » (Suwayomi) reste affichée' in x for x in toast(a)), toast(a))
    check('1 lower copy: library 18, hidden copy listed in the sheet of the visible one', len(library(a)) == 18)
    series_page(a, DOJO)
    check('1 lower copy: "Aussi sur Komga" on the visible series', a.inner_text('.dup .textbtn').strip() == 'Aussi sur Komga')
    check('1 no page errors', not a.errors, a.errors)
    ctx.close(); stop(srv)

    # ── 2. two series with the same title are merged automatically: declare them different ──
    B = 'http://localhost:8488'
    srv = server(8488)
    ctx, a = device(b, B)
    titles = library(a)
    check('2 start: the same-title pair is listed once (19)', len(titles) == 19 and titles.count('Les Veilleurs de Brume') == 1, titles.count('Les Veilleurs de Brume'))
    series_page(a, VEILLEURS_S)
    check('2 start: the visible one says "Aussi sur Komga"', a.inner_text('.dup .textbtn').strip() == 'Aussi sur Komga', a.inner_text('.dup'))
    a.click('.dup .textbtn'); a.wait_for_selector('.sheet .copy'); a.wait_for_timeout(400)
    check('2 start: the copy is hidden because of its title', 'Même titre' in a.inner_text('.sheet .copy'), a.inner_text('.sheet .copy'))
    series_page(a, VEILLEURS_K)
    check('2 start: opening the Komga copy directly shows the notice', 'regroupée avec « Les Veilleurs de Brume » (Suwayomi)' in a.inner_text('.dup'), a.inner_text('.dup'))

    series_page(a, VEILLEURS_S)
    a.click('.dup .textbtn'); a.wait_for_selector('.sheet .copy'); a.click('.sheet button >> text=Ce n’est pas la même série'); a.wait_for_timeout(1500)
    check('2 different: one "different" decision', [d[0] for d in decisions(a)] == ['diff'], decisions(a))
    t = library(a)
    check('2 different: both listed (20), the second one comes from Komga', len(t) == 20 and t.count('Les Veilleurs de Brume') == 2, (len(t), t.count('Les Veilleurs de Brume')))
    rows = home_rows(a)
    check('2 different: home rows list the Komga copy too', sum(v.count('Les Veilleurs de Brume') for v in rows.values()) > 1 or any(v.count('Les Veilleurs de Brume') == 2 for v in rows.values()), {k: v.count('Les Veilleurs de Brume') for k, v in rows.items()})
    check('2 different: search lists both', searched(a, 'veilleurs').count('Les Veilleurs de Brume') == 2)
    series_page(a, VEILLEURS_S)
    check('2 different: no "Aussi sur" line any more', a.locator('.dup .textbtn').count() == 0)
    series_page(a, VEILLEURS_K)
    check('2 different: no notice on the Komga copy', a.locator('.dup').is_hidden())
    check('2 persist: survives a reload', library(a, reload=True).count('Les Veilleurs de Brume') == 2)
    check('2 persist: settings list a "different" decision', '1 décision manuelle' in settings_line(a), settings_line(a))
    ctx2, d2 = device(b, B)
    check('2 second device: follows (20)', len(library(d2)) == 20)
    ctx2.close()

    # undo of the "different" decision from its toast
    open_decisions(a)
    check('2 settings: the review sheet names the kind and both series', all(x in a.inner_text('.sheet') for x in ('Séries différentes', 'Suwayomi', 'Komga')), a.inner_text('.sheet'))
    a.click('.sheet .copy button >> text=Retirer'); a.wait_for_timeout(800)
    check('2 settings: removing the decision merges the pair again (19)', decisions(a) == [] and library(a).count('Les Veilleurs de Brume') == 1)
    undo(a)
    check('2 undo: the toast brings the "different" decision back (20)', [d[0] for d in decisions(a)] == ['diff'] and library(a).count('Les Veilleurs de Brume') == 2)
    # "Ce n'est pas la même série" then undo, from the sheet
    open_decisions(a)
    a.click('.sheet .copy button >> text=Retirer'); a.wait_for_timeout(500); a.keyboard.press('Escape')
    series_page(a, VEILLEURS_S); a.click('.dup .textbtn'); a.wait_for_selector('.sheet .copy'); a.click('.sheet button >> text=Ce n’est pas la même série'); a.wait_for_timeout(800)
    undo(a)
    check('2 undo: undoing "not the same series" restores the automatic merge (19, no decision)', len(library(a)) == 19 and decisions(a) == [])
    check('2 no page errors', not a.errors, a.errors)
    ctx.close(); stop(srv)

    # ── 3. a decision about a series that no longer exists ──
    B = 'http://localhost:8489'
    srv = server(8489)
    ghost = json.dumps({'v': 1, 'e': [
        {'k': 'same', 'a': ['komga', 'S002', 'Tokyo Minuit Express'], 'b': ['suwayomi', 'GONE-FOLDER', 'Ancien nom du dossier'], 'rev': 1, 'dev': 'old', 'at': 1000},
        {'k': 'same', 'a': ['komga', 'S004', 'Café Lune Rouge'], 'b': ['folders', 'GONE-2', 'Autre dossier'], 'rev': 1, 'dev': 'old', 'at': 2000},
    ]})
    ctx, a = device(b, B, init=f"if (!localStorage.getItem('scrollarr.matches')) localStorage.setItem('scrollarr.matches', {json.dumps(ghost)})")
    t = library(a)
    check('3 orphan: a missing higher-priority member hides nothing (Tokyo still listed, 19)', len(t) == 19 and 'Tokyo Minuit Express' in t, len(t))
    line = settings_line(a)
    check('3 orphan: settings count both decisions', '2 décisions manuelles' in line, line)
    open_decisions(a); a.wait_for_timeout(600)
    sheet_text = a.inner_text('.sheet')
    check('3 orphan: the sheet flags the missing series with the title kept at decision time', 'Ancien nom du dossier' in sheet_text and 'Introuvable chez ce serveur' in sheet_text, sheet_text)
    check('3 orphan: a server that is not in use is "not checked", not "missing"', 'Serveur non vérifié' in sheet_text and sheet_text.count('Introuvable chez ce serveur') == 1, sheet_text)
    check('3 orphan: the orphan row is marked', a.locator('.sheet .copy.orphan').count() == 1)
    a.locator('.sheet .copy.orphan button >> text=Retirer').click(); a.wait_for_timeout(800)
    check('3 orphan: removed, one decision left', len(decisions(a)) == 1 and a.locator('.sheet .copy').count() == 1, decisions(a))
    undo(a)
    check('3 orphan: undo brings it back', len(decisions(a)) == 2)
    a.locator('.sheet .copy button >> text=Retirer').first.click(); a.locator('.sheet .copy button >> text=Retirer').first.click(); a.wait_for_timeout(600)
    check('3 orphan: both removed, the sheet says so', len(decisions(a)) == 0 and 'Aucune décision manuelle' in a.inner_text('.sheet'))
    check('3 no page errors', not a.errors, a.errors)
    ctx.close(); stop(srv)

    # ── 4. no key-value store: decisions stay on the device ──
    B = 'http://localhost:8490'
    srv = server(8490)
    seen = []
    ctx, a = device(b, B, no_store=True)
    ctx.on('request', lambda r: seen.append((r.method, r.url, r.post_data or '')))
    ctx.on('response', lambda r: seen.append(('RESP', r.url, r.status)))
    check('4 no store: hasStore() is false', a.evaluate("import('/js/api.js').then((m) => m.hasStore())") is False)
    check('4 no store: library listed (19)', len(library(a)) == 19)
    group_from(a, DOJO, 'Tokyo', 'Tokyo Minuit Express')
    a.click('.sheet .src-item >> text=Tokyo Minuit Express'); a.wait_for_timeout(2500)
    check('4 no store: grouped (18)', len(library(a)) == 18)
    check('4 no store: still grouped after a reload', len(library(a, reload=True)) == 18 and len(decisions(a)) == 1)
    a.wait_for_timeout(2000)
    touched = [x for x in seen if x[0] != 'RESP' and 'scrollarr.matches' in x[2]]
    kv_writes = [x for x in seen if x[0] == 'PATCH' or (x[0] == 'POST' and 'SetMeta' in x[2] and 'scrollarr.matches' in x[2])]
    check('4 no store: nothing about the decisions was sent to a server', not touched and not kv_writes, (touched, kv_writes))
    check('4 no store: no failed request at all', not [x for x in seen if x[0] == 'RESP' and x[2] >= 400], [x for x in seen if x[0] == 'RESP' and x[2] >= 400])
    ctx2, d2 = device(b, B, no_store=True)
    check('4 no store: another device does not see it (19): per-device fallback', len(library(d2)) == 19)
    ctx2.close()
    check('4 no page errors', not a.errors, a.errors)
    ctx.close(); stop(srv)


run(scenario)
