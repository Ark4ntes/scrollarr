"""Shared helpers for the end-to-end scripts (Playwright sync API + demo servers)."""
import os, pathlib, shutil, signal, socket, subprocess, sys, tempfile, time, traceback
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS_DIR = os.environ.get('SHOTS_DIR')       # screenshots only when set
CHROME_PATH = os.environ.get('CHROME_PATH')   # default: Playwright's bundled Chromium
if SHOTS_DIR:
    os.makedirs(SHOTS_DIR, exist_ok=True)

GQL = ("async ([op,v]) => (await (await fetch('/suwayomi/api/graphql',{method:'POST',"
       "headers:{'Content-Type':'application/json'},body:JSON.stringify({operationName:op,variables:v})})).json())")

_procs = []
_failed = False


def server(port, **env):
    """Start the demo server on `port`; it is killed by cleanup() whatever happens."""
    e = dict(os.environ, PORT=str(port), **env)
    p = subprocess.Popen(['node', 'dev/mock-servers.mjs'], cwd=ROOT, env=e,
                         stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    _procs.append(p)
    deadline = time.time() + 15
    while time.time() < deadline:   # wait until the port accepts connections
        if p.poll() is not None:
            raise RuntimeError(f'demo server on port {port} exited early (code {p.returncode})')
        try:
            socket.create_connection(('127.0.0.1', port), timeout=0.3).close()
            break
        except OSError:
            time.sleep(0.1)
    else:
        raise RuntimeError(f'demo server on port {port} did not start')
    time.sleep(0.5)
    return p


def stop(p):
    p.kill()
    p.wait()


def terminate(p):
    """Graceful stop (SIGTERM): the folders service flushes its reading progress before exiting."""
    p.send_signal(signal.SIGTERM)
    p.wait(timeout=15)


def _wait_port(p, port, what):
    deadline = time.time() + 15
    while time.time() < deadline:
        if p.poll() is not None:
            raise RuntimeError(f'{what} on port {port} exited early (code {p.returncode})')
        try:
            socket.create_connection(('127.0.0.1', port), timeout=0.3).close()
            return
        except OSError:
            time.sleep(0.1)
    raise RuntimeError(f'{what} on port {port} did not start')


_tmpdirs = []


def folders_fixture(page='360x540'):
    """Generated library for the folders service (nothing binary in the repository). Returns the fixture root."""
    root = tempfile.mkdtemp(prefix='scrollarr-folders-')
    _tmpdirs.append(root)
    subprocess.run(['node', 'dev/make-folders-fixture.mjs', root, '--page', page], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    return root


FOLDERS_PASSWORD = 'mot-de-passe-de-test'


def folders_service(port, root, auth='none', **env):
    """Start the real folders service on the fixture; killed by cleanup() whatever happens.
    The same data folder can be reused after a stop to test a restart."""
    e = dict(os.environ, FOLDERS_AUTH=auth, FOLDERS_LIBRARIES_DIR=f'{root}/libraries', FOLDERS_DATA_DIR=f'{root}/data',
             FOLDERS_PORT=str(port), FOLDERS_TRUST_PROXY='1', FOLDERS_COOKIE_PATH='/folders/', **env)
    if auth == 'password':
        e.update(FOLDERS_USER='lecteur', FOLDERS_PASSWORD=FOLDERS_PASSWORD)
    p = subprocess.Popen(['node', 'folders/server.js'], cwd=ROOT, env=e, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    _procs.append(p)
    _wait_port(p, port, 'folders service')
    return p


def cleanup():
    for p in _procs:
        if p.poll() is None:
            p.kill()
        try:
            p.wait(timeout=5)
        except Exception:
            pass
    _procs.clear()
    for d in _tmpdirs:
        shutil.rmtree(d, ignore_errors=True)
    _tmpdirs.clear()


def check(name, cond, extra=''):
    global _failed
    cond = bool(cond)
    if not cond:
        _failed = True
    print(('PASS ' if cond else 'FAIL ') + name, extra, flush=True)
    return cond


def shot(pg, name):
    """Optional screenshot (only when SHOTS_DIR is set)."""
    if SHOTS_DIR:
        pg.screenshot(path=os.path.join(SHOTS_DIR, name))


def launch(p):
    kw = {'args': ['--no-sandbox']}
    if CHROME_PATH:
        kw['executable_path'] = CHROME_PATH
    return p.chromium.launch(**kw)


def run(scenario):
    """Run scenario(browser); always clean up; exit 1 on failed check or exception."""
    try:
        with sync_playwright() as p:
            b = launch(p)
            try:
                scenario(b)
            finally:
                b.close()
    except Exception:
        traceback.print_exc()
        globals()['_failed'] = True
    finally:
        cleanup()
    print('SOME FAILED' if _failed else 'ALL PASS', flush=True)
    sys.exit(1 if _failed else 0)
