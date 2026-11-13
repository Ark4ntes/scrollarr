"""JOB-001: the history of collector tasks is shared between devices through the servers' store.

Two devices (two browser contexts) on one demo Suwayomi that downloads a chapter every 1.2 s;
chapter 131 fails. Only device 1 is open while the downloads run.
"""
from _common import server, stop, check, run
B = 'http://localhost:8436'


def device(b):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, locale='fr-FR')
    return ctx.new_page()


def states(pg):
    return sorted(pg.evaluate("[...document.querySelectorAll('.task')].map((e) => e.dataset.state)"))


def open_downloads(pg):
    pg.goto(B + '/#/more'); pg.reload(); pg.wait_for_selector('.rowlink'); pg.click('.rowlink'); pg.wait_for_selector('.collect')


def local(pg):
    return pg.evaluate("(() => { try { return JSON.parse(localStorage.getItem('scrollarr.tasks') || '[]').map((t) => t.state).sort(); } catch { return []; } })()")


def scenario(b):
    srv = server(8436, SERVERS='suwayomi', DOWNLOAD_MS='1200', DOWNLOAD_FAIL='131')
    d1, d2 = device(b), device(b)

    # Device 2 has never been opened ; device 1 asks for the whole series and watches it finish.
    d1.goto(B + '/#/series/s:5'); d1.wait_for_selector('.eps .ep')
    d1.click('.btn >> text=Télécharger'); d1.click('.action >> text=Faire télécharger toute la série par Suwayomi'); d1.wait_for_selector('.toast')
    d1.goto(B + '/#/more'); d1.wait_for_selector('.rowlink'); d1.click('.rowlink'); d1.wait_for_selector('.task')
    d1.wait_for_function("document.querySelectorAll('.task[data-state=\"done\"]').length === 3 && document.querySelector('.task[data-state=\"failed\"]')", timeout=30000)
    check('device 1: three done, one failed', states(d1) == ['done', 'done', 'done', 'failed'], states(d1))
    d1.wait_for_timeout(2500)  # debounced write to the server

    # 1. a download finished while only device 1 was open shows in device 2's history
    check('device 2: nothing known before opening', local(d2) == [], local(d2))
    open_downloads(d2)
    d2.wait_for_function("document.querySelectorAll('.task').length === 4", timeout=15000)
    check('device 2 sees the history of device 1', states(d2) == ['done', 'done', 'done', 'failed'], states(d2))

    # 2. a failed task retried on device 2 shows as done on both
    d2.locator('.task[data-state="failed"] .btn').click()
    d2.wait_for_function("document.querySelectorAll('.task[data-state=\"done\"]').length === 4", timeout=25000)
    d2.wait_for_timeout(2500)
    open_downloads(d1)
    d1.wait_for_function("document.querySelectorAll('.task[data-state=\"done\"]').length === 4", timeout=15000)
    check('retried on device 2: done on device 1 too', states(d1) == ['done'] * 4, states(d1))
    check('device 1 stores it locally as well', local(d1) == ['done'] * 4, local(d1))

    # 3. a history cleared on device 2 does not come back from device 1, which still has the entries
    d1.goto(B + '/#/home')  # device 1 keeps its four entries in its storage
    d2.click('.btn >> text=Effacer l’historique'); d2.wait_for_selector('.collect .empty')
    d2.wait_for_timeout(2500)
    check('device 1 still has the entries before it syncs', local(d1) == ['done'] * 4, local(d1))
    open_downloads(d1)
    d1.wait_for_selector('.collect .empty', timeout=15000)
    check('device 1: history cleared by device 2', states(d1) == [] and local(d1) == [], local(d1))
    open_downloads(d2)
    d2.wait_for_timeout(2000)
    check('device 2: stays empty after device 1 synced', states(d2) == [] and local(d2) == [], local(d2))
    stop(srv)


run(scenario)
