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
    pg.goto(B + '/#/more'); pg.wait_for_selector('.tasks')
    check('empty state before any request', 'Aucune tâche' in pg.inner_text('.tasks'), pg.inner_text('.tasks'))

    pg.goto(B + '/#/series/s:5'); pg.wait_for_selector('.eps .ep')
    pg.click('.btn >> text=Télécharger'); pg.click('.action >> text=Garder toute la série sur le serveur'); pg.wait_for_selector('.toast')
    pg.goto(B + '/#/more'); pg.wait_for_selector('.task >> nth=3')
    r = rows(pg)
    check('four tasks, one running and three queued', [x['state'] for x in r] == ['running', 'queued', 'queued', 'queued'], r)
    check('tasks name the series and the chapter', all('La Fille du Phare' in x['title'] for x in r), [x['title'] for x in r])
    check('running task shows a progress bar', r[0]['bar'] and '%' in r[0]['meta'], r[0])
    check('active tasks can be cancelled', all(x['cancel'] for x in r))
    shot(pg, 'tasks-running.png')

    pg.locator('.task').nth(3).locator('.btn').click(); pg.wait_for_selector('.task[data-state="cancelled"]')
    check('cancelled task is closed', sum(x['state'] == 'cancelled' for x in rows(pg)) == 1, rows(pg))

    pg.wait_for_selector('.task[data-state="failed"]', timeout=15000)
    pg.wait_for_function("document.querySelectorAll('.task[data-state=\"done\"]').length === 2", timeout=20000)
    r = rows(pg)
    check('final states: two done, one failed, one cancelled',
          sorted(x['state'] for x in r) == ['cancelled', 'done', 'done', 'failed'], r)
    failed = next(x for x in r if x['state'] == 'failed')
    check('failed task shows its error and attempts', failed['error'] and '3 tentatives' in failed['meta'], failed)
    shot(pg, 'tasks-finished.png')

    t = {x['nativeId']: x for x in stored(pg)}
    check('model: every task has the common fields', all(set(x) >= {'id', 'collector', 'nativeId', 'seriesId', 'chapterId', 'state', 'progress',
          'createdAt', 'startedAt', 'finishedAt', 'error', 'attempts', 'cancellable'} for x in t.values()), list(t.values())[:1])
    check('model: identifiers carry the reader prefix', t['130']['seriesId'] == 's:5' and t['130']['chapterId'] == 's:5.130', t['130'])
    check('model: a finished download has start and end dates', t['130']['startedAt'] and t['130']['finishedAt'] >= t['130']['startedAt'], t['130'])
    check('model: the cancelled task never started', t['133']['state'] == 'cancelled' and t['133']['startedAt'] is None and t['133']['finishedAt'], t['133'])
    check('model: failure keeps attempts', t['131']['state'] == 'failed' and t['131']['attempts'] == 3, t['131'])

    pg.reload(); pg.wait_for_selector('.task >> nth=3')
    check('history survives a reload', sorted(x['state'] for x in rows(pg)) == ['cancelled', 'done', 'done', 'failed'], rows(pg))
    pg.goto(B + '/#/series/s:5'); pg.wait_for_selector('.eps .ep'); pg.wait_for_timeout(400)
    pg.click('.btn >> text=Télécharger')
    hint = pg.locator('.action', has_text='Garder toute la série sur le serveur').inner_text()
    check('series page: two chapters still missing on the server', '2' in hint, hint)
    stop(srv)

    # Komga only: no collector, no panel
    srv = server(8434, SERVERS='komga')
    pg2 = b.new_context(viewport={'width': 390, 'height': 844}, locale='fr-FR').new_page()
    pg2.goto('http://localhost:8434/'); pg2.wait_for_selector('input[name=user], .hero, form')
    pg2.goto('http://localhost:8434/#/more'); pg2.wait_for_timeout(1200)
    check('no tasks panel without a collector', pg2.locator('.tasks').count() == 0)
    stop(srv)


run(scenario)
