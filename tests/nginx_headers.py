"""Security headers served by nginx/default.conf.template.

An add_header inside a location cancels the inheritance of the server-level
ones (nginx < 1.29.3 has no add_header_inherit), so every response must be
checked, not only the default one. The template is rendered like the official
image does (only ${VAR} placeholders replaced from the environment), nginx
runs as the current user on a local port in front of a throwaway upstream, and
headers are read with curl. Standard library only; needs `nginx` and `curl`.

    python3 tests/nginx_headers.py
"""
import http.server, os, pathlib, re, shutil, socket, subprocess, sys, tempfile, threading, time

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / 'nginx' / 'default.conf.template'
failed = False


def check(name, cond, extra=''):
    global failed
    failed |= not cond
    print(('PASS ' if cond else 'FAIL ') + name, extra, flush=True)


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def blocks(text):
    """(location line, body) for each `location` block (the template has no nested braces in them except `if`)."""
    out = []
    for m in re.finditer(r'^\s*(location\b[^{]*)\{', text, re.M):
        depth, i = 1, m.end()
        while depth:
            depth += {'{': 1, '}': -1}.get(text[i], 0)
            i += 1
        out.append((m.group(1).strip(), text[m.end():i - 1]))
    return out


def headers(url, *curl_args, multi=False):
    """(status, headers). With multi=True the headers map to the LIST of every value sent (to catch a duplicate)."""
    r = subprocess.run(['curl', '-s', '-D', '-', '-o', '/dev/null', '--max-time', '20', *curl_args, url], capture_output=True, text=True)
    lines = r.stdout.replace('\r', '').split('\n')
    status = int(lines[0].split()[1]) if lines and lines[0].startswith('HTTP') else 0
    pairs = [(k.lower(), v.strip()) for k, v in (l.split(':', 1) for l in lines[1:] if ':' in l)]
    if not multi:
        return status, dict(pairs)
    out = {}
    for k, v in pairs:
        out.setdefault(k, []).append(v)
    return status, out


class Upstream(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.send_header('Content-Type', 'text/plain'); self.end_headers(); self.wfile.write(b'ok')
    def log_message(self, *a): pass


PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108020000009077' '53de0000000c49444154789c63f8cfc000000301010018dd8db00000000049454e44ae426082')


class FoldersUpstream(http.server.BaseHTTPRequestHandler):
    """Stands in for the folders service: it sends its own nosniff and CSP like the real one (http.js)."""
    seen = []

    def reply(self, status, ctype, body):
        type(self).seen.append((self.command, self.path, self.headers.get('Host'), self.headers.get('X-Forwarded-For'), self.headers.get('Cookie')))
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Security-Policy', "default-src 'none'; sandbox")
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith('/api/v1/books/') and '/pages/' in self.path: self.reply(200, 'image/png', PNG)
        elif self.path.startswith('/api/v1/session'): self.reply(401, 'application/json', b'{"error":"unauthorized"}')
        else: self.reply(200, 'application/json', b'{"ok":true}')

    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length') or 0))
        self.reply(200, 'application/json', b'{"ok":true}')
    do_PATCH = do_PUT = do_DELETE = do_POST
    def log_message(self, *a): pass


def main():
    template = TEMPLATE.read_text()
    # Les trois en-têtes attendus sont ceux du niveau « server » du modèle.
    server_level = re.sub(r'location\b[^{]*\{.*?\n    \}', '', template, flags=re.S)
    expected = dict((m[0].lower(), m[1]) for m in re.findall(r'add_header ([\w-]+) "([^"]*)" always;', server_level)
                    if m[0].lower() != 'cache-control')
    check('template: three security headers at server level', len(expected) == 3, sorted(expected))

    # Structure : tout location qui définit add_header doit répéter les trois en-têtes.
    for loc, body in blocks(template):
        if 'add_header' in body:
            missing = [h for h in expected if h not in body.lower()]
            check(f'template: "{loc}" repeats the security headers', not missing, missing)

    nginx = shutil.which('nginx') or '/usr/sbin/nginx'
    if not os.path.exists(nginx) or not shutil.which('curl'):
        check('nginx and curl are installed', False); return
    up_port, fo_port, port, dead_port = free_port(), free_port(), free_port(), free_port()
    upstream = http.server.ThreadingHTTPServer(('127.0.0.1', up_port), Upstream)
    threading.Thread(target=upstream.serve_forever, daemon=True).start()
    folders = http.server.ThreadingHTTPServer(('127.0.0.1', fo_port), FoldersUpstream)
    threading.Thread(target=folders.serve_forever, daemon=True).start()

    tmp = pathlib.Path(tempfile.mkdtemp(prefix='scrollarr-nginx-'))
    procs = []

    def start_nginx(name, env, listen):
        """Render the template like the official image does and run nginx on `listen` (a local port)."""
        rendered = re.sub(r'\$\{(\w+)\}', lambda m: env.get(m.group(1), m.group(0)), template)
        rendered = rendered.replace('listen 80;', f'listen 127.0.0.1:{listen};')
        rendered = rendered.replace('/usr/share/nginx/html', str(ROOT / 'app'))
        rendered = re.sub(r'resolver [^;]+;', f'resolver 127.0.0.1:{dead_port};', rendered)   # pas de DNS Docker ici
        rendered = rendered.replace('http://notifier:8787', f'http://127.0.0.1:{dead_port}')   # notifier absent, sans attendre le DNS
        d = tmp / name
        d.mkdir()
        (d / 'site.conf').write_text(rendered)
        (d / 'nginx.conf').write_text(f"""daemon off; pid {d}/nginx.pid; error_log {d}/error.log;
events {{}}
http {{
  include /etc/nginx/mime.types; access_log off;
  client_body_temp_path {d}/b; proxy_temp_path {d}/p; fastcgi_temp_path {d}/f; uwsgi_temp_path {d}/u; scgi_temp_path {d}/s;
  include {d}/site.conf;
}}""")
        proc = subprocess.Popen([nginx, '-c', str(d / 'nginx.conf'), '-p', str(d)], stderr=subprocess.PIPE, text=True)
        procs.append(proc)
        for _ in range(50):
            try: socket.create_connection(('127.0.0.1', listen), timeout=0.2).close(); return True
            except OSError: time.sleep(0.1)
        check(f'nginx starts with the rendered template ({name})', False, (d / 'error.log').read_text())
        return False

    try:
        # Komga et Dossiers présents, Suwayomi absent.
        env = {'KOMGA_URL': f'http://127.0.0.1:{up_port}', 'SUWAYOMI_URL': '', 'FOLDERS_URL': f'http://127.0.0.1:{fo_port}'}
        if not start_nginx('main', env, port): return
        check('nginx starts with the rendered template', True)

        cases = [
            ('/', 200), ('/index.html', 200), ('/icons/icon-192.png', 200), ('/servers.json', 200),
            ('/komga/api/v1/ping', 200),      # proxy vers le faux amont
            ('/suwayomi/api/graphql', 404),   # serveur non configuré
            ('/notify/health', 404),          # notifier absent (error_page)
            ('/notify-unavailable', 404),
        ]
        base = f'http://127.0.0.1:{port}'
        for path, status in cases:
            got, h = headers(base + path)
            check(f'{path}: status {status}', got == status, got)
            for name, value in expected.items():
                check(f'{path}: {name}', h.get(name) == value, h.get(name))
        _, h = headers(base + '/servers.json')
        check('/servers.json: still no-store', h.get('cache-control') == 'no-store', h.get('cache-control'))
        body = subprocess.run(['curl', '-s', base + '/servers.json'], capture_output=True, text=True).stdout
        check('/servers.json lists the folders service when configured', body == '{"komga":true,"suwayomi":false,"folders":true}', body)

        # ── /folders/ : JSON, image, 401, écriture, puis service arrêté ──
        folder_cases = [
            ('/folders/api/v1/libraries', 200, 'JSON'),
            ('/folders/api/v1/books/abc/pages/1', 200, 'image'),
            ('/folders/api/v1/session', 401, '401 answered by the service'),
        ]
        for path, status, label in folder_cases:
            got, h = headers(base + path, multi=True)
            check(f'{path} ({label}): status {status}', got == status, got)
            for name, value in expected.items():
                check(f'{path} ({label}): {name}', value in h.get(name, []), h.get(name))
            check(f'{path} ({label}): X-Content-Type-Options sent once', len(h.get('x-content-type-options', [])) == 1, h.get('x-content-type-options'))
            check(f"{path} ({label}): the service's own CSP and CORP still reach the browser",
                  "default-src 'none'; sandbox" in h.get('content-security-policy', []) and h.get('cross-origin-resource-policy') == ['same-origin'], h)
        got, h = headers(base + '/folders/api/v1/session', multi=True)
        check('a 401 from the service carries no WWW-Authenticate (no native login dialog)', 'www-authenticate' not in h)
        FoldersUpstream.seen.clear()
        got, h = headers(base + '/folders/api/v1/books/x/progress', '-X', 'PATCH', '-H', 'Content-Type: application/json',
                         '-H', 'X-Requested-With: XMLHttpRequest', '-H', 'Cookie: folders_session=abc', '-d', '{}', multi=True)
        check('/folders/ write request: relayed with its method', got == 200 and FoldersUpstream.seen and FoldersUpstream.seen[-1][0] == 'PATCH', (got, FoldersUpstream.seen))
        for name, value in expected.items():
            check(f'/folders/ write request: {name}', value in h.get(name, []), h.get(name))
        seen = FoldersUpstream.seen[-1] if FoldersUpstream.seen else None
        check('/folders/: Host kept as sent by the browser (the service compares it with Origin)', seen and seen[2] == f'127.0.0.1:{port}', seen)
        check('/folders/: X-Forwarded-For carries the client address', seen and seen[3] == '127.0.0.1', seen)
        check('/folders/: the session cookie is forwarded', seen and seen[4] == 'folders_session=abc', seen)
        got, _ = headers(base + '/folders/')
        check('/folders/ (root path) is relayed too', got == 200, got)

        folders.shutdown(); folders.server_close()
        for path in ('/folders/api/v1/libraries', '/folders/api/v1/books/abc/pages/1'):
            got, h = headers(base + path)
            check(f'{path} (service stopped): 502, which the app reads as "server unreachable"', got == 502, got)
            for name, value in expected.items():
                check(f'{path} (service stopped): {name}', h.get(name) == value, h.get(name))

        # ── Dossiers non configuré : variable vide ──
        port2 = free_port()
        if not start_nginx('nofolders', {'KOMGA_URL': '', 'SUWAYOMI_URL': '', 'FOLDERS_URL': ''}, port2): return
        base2 = f'http://127.0.0.1:{port2}'
        got, h = headers(base2 + '/folders/api/v1/libraries')
        check('FOLDERS_URL empty: /folders/ answers 404', got == 404, got)
        for name, value in expected.items():
            check(f'FOLDERS_URL empty, /folders/: {name}', h.get(name) == value, h.get(name))
        body = subprocess.run(['curl', '-s', base2 + '/servers.json'], capture_output=True, text=True).stdout
        check('FOLDERS_URL empty: /servers.json says folders false', body == '{"komga":false,"suwayomi":false,"folders":false}', body)
    finally:
        for proc in procs:
            if proc.poll() is None:
                proc.terminate(); proc.wait(timeout=10)
        upstream.shutdown()
        shutil.rmtree(tmp, ignore_errors=True) if not os.environ.get("KEEP") else print(tmp)


try:
    main()
except Exception:
    import traceback; traceback.print_exc(); failed = True
print('SOME FAILED' if failed else 'ALL PASS')
sys.exit(1 if failed else 0)
