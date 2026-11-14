"""JOB-003: failed collector downloads are retried automatically, a bounded number of times.

Test-only shortcut: the backoff (1 min, 5 min, 30 min) is shortened through the localStorage key
`scrollarr.dev.retry`, set before the page loads (see docs/en/development.md). The mock Suwayomi fails
chapter 131 `DOWNLOAD_FAIL_TIMES` times; the operations it receives are read back to count the retries
(each retry is one Dequeue followed by one Enqueue, nothing else sends a Dequeue here).
"""
import json, urllib.request
from _common import server, stop, check, run

DEV = {'delays': [1500, 1500, 1500], 'jitterMs': 300, 'claimMs': 5000}


def device(b, dev=DEV, auto=True):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, locale='fr-FR')
    ctx.add_init_script(f"localStorage.setItem('scrollarr.dev.retry', {json.dumps(json.dumps(dev))});"
                        + ('' if auto else "localStorage.setItem('scrollarr.autoRetry', '0');"))
    return ctx.new_page()


def ops(port, name):
    return json.load(urllib.request.urlopen(f'http://localhost:{port}/suwayomi/__mock/requests')).count(name)


def open_downloads(pg, port):
    pg.goto(f'http://localhost:{port}/#/more'); pg.wait_for_selector('.rowlink'); pg.click('.rowlink'); pg.wait_for_selector('.collect')


def request_series(pg, port):
    pg.goto(f'http://localhost:{port}/#/series/s:5'); pg.wait_for_selector('.eps .ep')
    pg.click('.btn >> text=Télécharger'); pg.click('.action >> text=Faire télécharger toute la série par Suwayomi'); pg.wait_for_selector('.toast')


def stored(pg):
    return pg.evaluate("JSON.parse(localStorage.getItem('scrollarr.tasks') || '[]')")


def task131(pg):
    return next((t for t in stored(pg) if t['nativeId'] == '131'), None)


def failing_twice(b):
    port = 8443
    srv = server(port, SERVERS='suwayomi', DOWNLOAD_MS='800', DOWNLOAD_FAIL='131', DOWNLOAD_FAIL_TIMES='2')
    pg = device(b)
    open_downloads(pg, port); request_series(pg, port)
    pg.goto(f'http://localhost:{port}/#/more'); pg.wait_for_selector('.rowlink'); pg.click('.rowlink')
    pg.wait_for_selector('.task-retry[data-retry="scheduled"]', timeout=20000)
    check('1 a failure shows when the next try comes', 'nouvel essai dans 1 min' in pg.inner_text('.task[data-state="failed"]'), pg.inner_text('.task[data-state="failed"]'))
    check('1 the manual Retry button stays next to it', pg.locator('.task[data-state="failed"] .btn >> text=Relancer').count() == 1)
    pg.wait_for_function("document.querySelectorAll('.task[data-state=\"done\"]').length === 4", timeout=40000)
    check('1 failing twice: done without any click', pg.locator('.task[data-state="failed"]').count() == 0)
    pg.wait_for_timeout(3000)
    check('1 exactly two retries were sent', ops(port, 'Dequeue') == 2 and ops(port, 'Enqueue') == 3, (ops(port, 'Dequeue'), ops(port, 'Enqueue')))
    check('1 the count survives the retries', task131(pg)['autoRetries'] == 2 and task131(pg)['nextRetryAt'] is None, task131(pg))
    stop(srv)


def exhausted(b):
    port = 8444
    srv = server(port, SERVERS='suwayomi', DOWNLOAD_MS='800', DOWNLOAD_FAIL='131', DOWNLOAD_FAIL_TIMES='9')
    pg = device(b)
    open_downloads(pg, port); request_series(pg, port)
    pg.goto(f'http://localhost:{port}/#/more'); pg.wait_for_selector('.rowlink'); pg.click('.rowlink')
    pg.wait_for_selector('.task-retry[data-retry="exhausted"]', timeout=40000)
    check('2 exhausted text', 'nouvel essai automatique épuisé' in pg.inner_text('.task[data-state="failed"]'), pg.inner_text('.task[data-state="failed"]'))
    pg.wait_for_timeout(4000)
    check('2 maximum is three automatic retries, no more', ops(port, 'Dequeue') == 3 and pg.locator('.task[data-state="failed"]').count() == 1, ops(port, 'Dequeue'))
    pg.locator('.task[data-state="failed"] .btn >> text=Relancer').click()
    pg.wait_for_selector('.task-retry[data-retry="scheduled"]', timeout=20000)
    check('2 manual retry resets the counter: automatic retries are scheduled again', task131(pg)['autoRetries'] == 0 and ops(port, 'Dequeue') == 4, (task131(pg), ops(port, 'Dequeue')))
    stop(srv)


def setting_off(b):
    port = 8445
    srv = server(port, SERVERS='suwayomi', DOWNLOAD_MS='800', DOWNLOAD_FAIL='131', DOWNLOAD_FAIL_TIMES='1')
    pg = device(b)
    open_downloads(pg, port)
    check('3 the setting is on by default', pg.locator('input[data-auto-retry]').is_checked())
    pg.locator('input[data-auto-retry]').uncheck()
    request_series(pg, port)
    pg.goto(f'http://localhost:{port}/#/more'); pg.wait_for_selector('.rowlink'); pg.click('.rowlink')
    pg.wait_for_selector('.task[data-state="failed"]', timeout=20000)
    pg.wait_for_timeout(6000)
    check('3 setting off: nothing retried, nothing announced', ops(port, 'Dequeue') == 0 and pg.locator('.task[data-state="failed"]').count() == 1
          and pg.locator('.task-retry').count() == 0, ops(port, 'Dequeue'))
    pg.locator('input[data-auto-retry]').check()
    pg.wait_for_function("document.querySelectorAll('.task[data-state=\"done\"]').length === 4", timeout=30000)
    check('3 switched back on: the failure is retried', ops(port, 'Dequeue') == 1, ops(port, 'Dequeue'))
    stop(srv)


def two_devices(b):
    port = 8446
    srv = server(port, SERVERS='suwayomi', DOWNLOAD_MS='800', DOWNLOAD_FAIL='131', DOWNLOAD_FAIL_TIMES='2')
    dev = {'delays': [1500, 1500, 1500], 'jitterMs': 0, 'claimMs': 5000}  # no jitter: both devices are due at the same moment
    d1, d2 = device(b, dev), device(b, dev)
    open_downloads(d2, port)
    request_series(d1, port)
    d1.goto(f'http://localhost:{port}/#/more'); d1.wait_for_selector('.rowlink'); d1.click('.rowlink')
    d1.wait_for_function("document.querySelectorAll('.task[data-state=\"done\"]').length === 4", timeout=40000)
    d2.wait_for_function("document.querySelectorAll('.task[data-state=\"done\"]').length === 4", timeout=20000)
    d1.wait_for_timeout(4000)
    check('4 two devices open: each retry sent once, not twice', ops(port, 'Dequeue') == 2, ops(port, 'Dequeue'))
    check('4 both devices end with the same count', task131(d1)['autoRetries'] == 2 == task131(d2)['autoRetries'], (task131(d1), task131(d2)))
    stop(srv)


def scenario(b):
    failing_twice(b); exhausted(b); setting_off(b); two_devices(b)


run(scenario)
