"""TASK-001: tasks of a collector, followed in the common model.

The demo Suwayomi downloads one chapter every 3 s; chapter 131 fails.
Four chapters of one series are requested: one finishes, one fails, one is
cancelled from the app, one is left to finish.
"""
from _common import server, stop, check, shot, run
B = 'http://localhost:8433'


def rows(pg):
    return pg.evaluate("""() => [...document.querySelectorAll('.task')].map((e) => ({
      state: e.dataset.state, title: e.querySelector('.task-title').textContent,
      meta: e.querySelector('.task-meta').textContent, cancel: !!e.querySelector('.btn'),
      bar: !!e.querySelector('progress'), error: e.querySelector('.task-error')?.textContent || null }))""")


def stored(pg):
    return pg.evaluate("JSON.parse(localStorage.getItem('scrollarr.tasks') || '[]')")


def scenario(b):
    srv = server(8433, SERVERS='suwayomi', DOWNLOAD_MS='3000', DOWNLOAD_FAIL='131')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, locale='fr-FR')
    pg = ctx.new_page()

    # Settings only carry a summary; the detail lives on its own screen
    pg.goto(B + '/#/more'); pg.wait_for_selector('.rowlink')
    check('settings: collector listed', 'Suwayomi' in pg.inner_text('.panel:has(.rowlink)'), pg.inner_text('.panel:has(.rowlink)'))
    check('settings: downloads entry, nothing running', 'Aucun en cours' in pg.inner_text('.rowlink'), pg.inner_text('.rowlink'))
    check('settings: no task list inline', pg.locator('.task').count() == 0)
    check('main navigation unchanged', pg.locator('#tabbar .tab').count() == 4, pg.locator('#tabbar .tab').count())
    pg.click('.rowlink'); pg.wait_for_selector('.collect')
    check('downloads screen: empty state', 'Aucun téléchargement' in pg.inner_text('.collect'), pg.inner_text('.collect'))
    check('downloads screen: back button', pg.locator('.topbar .iconbtn[aria-label=Retour]').count() == 1)

    pg.goto(B + '/#/series/s:5'); pg.wait_for_selector('.eps .ep')
    pg.click('.btn >> text=Télécharger'); pg.click('.action >> text=Faire télécharger toute la série par Suwayomi'); pg.wait_for_selector('.toast')
    pg.goto(B + '/#/more'); pg.wait_for_selector('.rowlink'); pg.wait_for_function("document.querySelector('.rowlink').textContent.includes('4 actifs')")
    check('settings: active count', True); pg.locator('.rowlink').scroll_into_view_if_needed(); pg.wait_for_timeout(300); shot(pg, 'settings-collect.png')
    pg.click('.rowlink'); pg.wait_for_selector('.task >> nth=3')
    r = rows(pg)
    check('four tasks, one running and three queued', [x['state'] for x in r] == ['running', 'queued', 'queued', 'queued'], r)
    groups = pg.eval_on_selector_all('.collect .panel', 'e => e.map((x) => x.dataset.group)')
    check('grouped: running, then queue', groups == ['running', 'queued'], groups)
    check('tasks name the series and the chapter', all('La Fille du Phare' in x['title'] for x in r), [x['title'] for x in r])
    check('running task shows a progress bar', r[0]['bar'] and '%' in r[0]['meta'], r[0])
    check('active tasks can be cancelled', all(x['cancel'] for x in r))
    pg.wait_for_timeout(400); shot(pg, 'tasks-running.png')

    pg.locator('.task').nth(3).locator('.btn').click(); pg.wait_for_selector('.task[data-state="cancelled"]')
    check('cancelled task is closed', sum(x['state'] == 'cancelled' for x in rows(pg)) == 1, rows(pg))

    pg.wait_for_selector('.task[data-state="failed"]', timeout=15000)
    pg.wait_for_function("document.querySelectorAll('.task[data-state=\"done\"]').length === 2", timeout=20000)
    r = rows(pg)
    check('final states: two done, one failed, one cancelled',
          sorted(x['state'] for x in r) == ['cancelled', 'done', 'done', 'failed'], r)
    groups = pg.eval_on_selector_all('.collect .panel', 'e => e.map((x) => x.dataset.group)')
    check('grouped: errors, then history', groups == ['failed', 'history'], groups)
    failed = next(x for x in r if x['state'] == 'failed')
    check('failed task shows its error and attempts', failed['error'] and '3 tentatives' in failed['meta'], failed)
    check('failed and cancelled tasks can be retried, finished ones cannot',
          [x['cancel'] for x in r if x['state'] in ('failed', 'cancelled')] == [True, True] and not any(x['cancel'] for x in r if x['state'] == 'done'), r)
    pg.wait_for_timeout(400); shot(pg, 'tasks-finished.png')

    t = {x['nativeId']: x for x in stored(pg)}
    check('model: every task has the common fields', all(set(x) >= {'id', 'collector', 'nativeId', 'seriesId', 'chapterId', 'state', 'progress',
          'createdAt', 'startedAt', 'finishedAt', 'error', 'attempts', 'cancellable'} for x in t.values()), list(t.values())[:1])
    check('model: identifiers carry the reader prefix', t['130']['seriesId'] == 's:5' and t['130']['chapterId'] == 's:5.130', t['130'])
    check('model: a finished download has start and end dates', t['130']['startedAt'] and t['130']['finishedAt'] >= t['130']['startedAt'], t['130'])
    check('model: the cancelled task never started', t['133']['state'] == 'cancelled' and t['133']['startedAt'] is None and t['133']['finishedAt'], t['133'])
    check('model: failure keeps attempts', t['131']['state'] == 'failed' and t['131']['attempts'] == 3, t['131'])

    pg.reload(); pg.wait_for_selector('.task >> nth=3')
    check('history survives a reload', sorted(x['state'] for x in rows(pg)) == ['cancelled', 'done', 'done', 'failed'], rows(pg))

    # retry the failed one and the cancelled one
    pg.locator('.task[data-state="failed"] .btn').click()
    pg.wait_for_function("!document.querySelector('.task[data-state=\"failed\"]')", timeout=8000)
    pg.locator('.task[data-state="cancelled"] .btn').click()
    pg.wait_for_function("document.querySelectorAll('.task[data-state=\"done\"]').length === 4", timeout=25000)
    check('retry: failed and cancelled downloads end up done', sorted(x['state'] for x in rows(pg)) == ['done'] * 4, rows(pg))
    pg.click('.btn >> text=Effacer l’historique'); pg.wait_for_selector('.collect .empty')
    check('history can be cleared', pg.locator('.task').count() == 0 and stored(pg) == [], stored(pg))
    pg.click('.topbar .iconbtn[aria-label=Retour]'); pg.wait_for_selector('.rowlink')
    check('back button returns to settings', pg.evaluate('location.hash') == '#/more', pg.evaluate('location.hash'))

    pg.goto(B + '/#/series/s:5'); pg.wait_for_selector('.eps .ep'); pg.wait_for_timeout(400)
    check('series page: every chapter is now on the server', pg.locator('.sactions .btn >> text=Télécharger').count() == 1)

    # Plain HTTP on a LAN address: the browser refuses offline storage, and the app must say so
    import subprocess
    ip = subprocess.run(['hostname', '-I'], capture_output=True, text=True).stdout.split()[0]
    lan = f'http://{ip}:8433'
    pl = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, locale='fr-FR').new_page()
    pl.goto(lan + '/#/series/s:6'); pl.wait_for_selector('.eps .ep')
    check('http: not a secure context', pl.evaluate('window.isSecureContext') is False)
    pl.click('.btn >> text=Télécharger'); pl.wait_for_selector('.sheet')
    sheet = pl.inner_text('.sheet')
    check('http: download menu explains why offline is unavailable', 'HTTPS' in sheet and 'Les 5 prochains chapitres' not in sheet, sheet)
    check('http: server download still offered, named after the collector', 'Faire télécharger toute la série par Suwayomi' in sheet and 'seulement quand le serveur est joignable' in sheet, sheet)
    pl.wait_for_timeout(500); shot(pl, 'download-menu-http.png')
    pl.goto(lan + '/#/home'); pl.goto(lan + '/#/my/downloads'); pl.wait_for_selector('.empty')
    check('http: downloads list explains it too', 'HTTPS' in pl.inner_text('.empty'), pl.inner_text('.empty'))
    pg.goto(B + '/#/home'); pg.reload(); pg.goto(B + '/#/series/s:6'); pg.wait_for_selector('.eps .ep'); pg.click('.sactions .btn >> text=Télécharger'); pg.wait_for_selector('.sheet')
    sheet = pg.inner_text('.sheet')
    check('https or localhost: both kinds of download, each labelled', 'Sur cet appareil' in sheet and 'Les 5 prochains chapitres' in sheet and 'Sur le serveur' in sheet, sheet)
    pg.wait_for_timeout(500); shot(pg, 'download-menu.png')
    stop(srv)

    # Komga only: no collector, no panel
    srv = server(8434, SERVERS='komga')
    pg2 = b.new_context(viewport={'width': 390, 'height': 844}, locale='fr-FR').new_page()
    pg2.goto('http://localhost:8434/'); pg2.wait_for_selector('input[name=user], .hero, form')
    pg2.goto('http://localhost:8434/#/more'); pg2.wait_for_timeout(1200)
    check('no collector panel without a collector', pg2.locator('.rowlink').count() == 0)
    stop(srv)


run(scenario)
