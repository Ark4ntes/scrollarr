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


def headers(url):
    r = subprocess.run(['curl', '-s', '-D', '-', '-o', '/dev/null', '--max-time', '20', url], capture_output=True, text=True)
    lines = r.stdout.replace('\r', '').split('\n')
    status = int(lines[0].split()[1]) if lines and lines[0].startswith('HTTP') else 0
    return status, {k.lower(): v.strip() for k, v in (l.split(':', 1) for l in lines[1:] if ':' in l)}


class Upstream(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.send_header('Content-Type', 'text/plain'); self.end_headers(); self.wfile.write(b'ok')
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
    up_port, port, dead_port = free_port(), free_port(), free_port()
    upstream = http.server.ThreadingHTTPServer(('127.0.0.1', up_port), Upstream)
    threading.Thread(target=upstream.serve_forever, daemon=True).start()

    tmp = pathlib.Path(tempfile.mkdtemp(prefix='scrollarr-nginx-'))
    proc = None
    try:
        env = {'KOMGA_URL': f'http://127.0.0.1:{up_port}', 'SUWAYOMI_URL': ''}   # Komga présent, Suwayomi absent
        rendered = re.sub(r'\$\{(\w+)\}', lambda m: env.get(m.group(1), m.group(0)), template)
        rendered = rendered.replace('listen 80;', f'listen 127.0.0.1:{port};')
        rendered = rendered.replace('/usr/share/nginx/html', str(ROOT / 'app'))
        rendered = re.sub(r'resolver [^;]+;', f'resolver 127.0.0.1:{dead_port};', rendered)   # pas de DNS Docker ici
        rendered = rendered.replace('http://notifier:8787', f'http://127.0.0.1:{dead_port}')   # notifier absent, sans attendre le DNS
        (tmp / 'site.conf').write_text(rendered)
        (tmp / 'nginx.conf').write_text(f"""daemon off; pid {tmp}/nginx.pid; error_log {tmp}/error.log;
events {{}}
http {{
  include /etc/nginx/mime.types; access_log off;
  client_body_temp_path {tmp}/b; proxy_temp_path {tmp}/p; fastcgi_temp_path {tmp}/f; uwsgi_temp_path {tmp}/u; scgi_temp_path {tmp}/s;
  include {tmp}/site.conf;
}}""")
        proc = subprocess.Popen([nginx, '-c', str(tmp / 'nginx.conf'), '-p', str(tmp)], stderr=subprocess.PIPE, text=True)
        for _ in range(50):
            try: socket.create_connection(('127.0.0.1', port), timeout=0.2).close(); break
            except OSError: time.sleep(0.1)
        else:
            check('nginx starts with the rendered template', False, (tmp / 'error.log').read_text()); return
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
    finally:
        if proc and proc.poll() is None:
            proc.terminate(); proc.wait(timeout=10)
        upstream.shutdown()
        shutil.rmtree(tmp, ignore_errors=True) if not os.environ.get("KEEP") else print(tmp)


try:
    main()
except Exception:
    import traceback; traceback.print_exc(); failed = True
print('SOME FAILED' if failed else 'ALL PASS')
sys.exit(1 if failed else 0)
