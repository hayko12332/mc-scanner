#!/usr/bin/env python3
"""Local server for MC Scanner: serves index.html and proxies live SAFER lookups.

SAFER blocks non-US IPs and browsers can't call it directly (no CORS), so the
page asks this server, which fetches SAFER through the machine's (VPN) connection.

Run:  python3 server.py     then open http://127.0.0.1:8765
"""
import html
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# Cloud hosts (Render etc.) pass PORT and need 0.0.0.0; locally we stay on 127.0.0.1:8765.
CLOUD = "PORT" in os.environ
HOST, PORT = ("0.0.0.0" if CLOUD else "127.0.0.1"), int(os.environ.get("PORT", 8765))
ROOT = Path(__file__).resolve().parent
SAFER_URL = ("https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot"
             "&query_param={param}&query_string={value}")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"

PAIR_RE = re.compile(r"<th[^>]*>((?:(?!<th).)*?)</th>\s*<td[^>]*>(.*?)</td>", re.I | re.S)
AS_OF_RE = re.compile(r"as of\s*(?:<[^>]+>\s*)*(\d\d/\d\d/\d{4})", re.I)


def clean(fragment):
    """HTML fragment -> plain text with <br> kept as newlines."""
    fragment = re.sub(r"<br\s*/?>", "\n", fragment, flags=re.I)
    text = html.unescape(re.sub(r"<[^>]+>", " ", fragment)).replace("\xa0", " ")
    lines = [re.sub(r"[ \t\r\f\v]+", " ", line).strip() for line in text.split("\n")]
    return "\n".join(line for line in lines if line)


def parse_snapshot(page):
    if "Record Not Found" in page or "Record Inactive" in page:
        return {"found": False}
    page = re.sub(r"<!--.*?-->", "", page, flags=re.S)
    fields = {}
    for label, value in PAIR_RE.findall(page):
        key = clean(label).rstrip(":").strip()
        if key and key not in fields:
            fields[key] = clean(value)

    auth_raw = fields.get("Operating Authority Status", "")
    auth_lines = [l for l in auth_raw.split("\n") if not l.startswith("For Licensing") and l != "click here."]
    status = auth_lines[0] if auth_lines else ""
    auth_for = [a.strip() for l in auth_lines[1:] for a in l.split(",") if a.strip()] if status.startswith("AUTHORIZED FOR") else []
    usdot_status = fields.get("USDOT Status", "").split("\n")[0]
    as_of = AS_OF_RE.search(page)
    return {
        "found": True,
        "asOf": as_of.group(1) if as_of else "",
        "entityType": fields.get("Entity Type", "").split("\n")[0],
        "usdotStatus": usdot_status,
        "oosDate": fields.get("Out of Service Date", ""),
        "authStatus": status,
        "authFor": auth_for,
        "authorized": status.startswith("AUTHORIZED FOR") and any(a.startswith("Motor Carrier") for a in auth_for)
                      and "OUT-OF-SERVICE" not in usdot_status,
        "broker": any(a.startswith("Broker") for a in auth_for),
        "dot": fields.get("USDOT Number", "").split("\n")[0],
        "mcNumbers": re.findall(r"MC-\d+", fields.get("MC/MX/FF Number(s)", "")),
        "legalName": fields.get("Legal Name", ""),
        "dba": fields.get("DBA Name", ""),
        "phone": fields.get("Phone", ""),
        "address": fields.get("Physical Address", "").replace("\n", ", "),
        "mailing": fields.get("Mailing Address", "").replace("\n", ", "),
        "mcs150Date": fields.get("MCS-150 Form Date", ""),
        "powerUnits": fields.get("Power Units", ""),
        "drivers": fields.get("Drivers", ""),
    }


def fetch_safer(value, param="MC_MX"):
    req = urllib.request.Request(SAFER_URL.format(param=param, value=value), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("latin-1")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        pass  # keep the console quiet; errors are reported in the page

    def send_body(self, code, body, content_type):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, code, obj):
        self.send_body(code, json.dumps(obj).encode(), "application/json")

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        if url.path == "/api/ping":
            return self.send_json(200, {"ok": True})
        if url.path == "/api/safer":
            mc = urllib.parse.parse_qs(url.query).get("mc", [""])[0]
            if not mc.isdigit():
                return self.send_json(400, {"error": "bad mc"})
            try:
                return self.send_json(200, parse_snapshot(fetch_safer(mc)))
            except urllib.error.HTTPError as e:
                hint = " (SAFER блокирует не-US IP — включите US VPN)" if e.code == 403 else ""
                return self.send_json(502, {"error": f"SAFER HTTP {e.code}{hint}"})
            except Exception as e:  # network errors, timeouts
                return self.send_json(502, {"error": f"SAFER: {e}"})
        if url.path == "/safer":
            # Full SAFER snapshot page fetched by this server, so the viewer's browser needs no VPN.
            dot = urllib.parse.parse_qs(url.query).get("dot", [""])[0]
            if not dot.isdigit():
                return self.send_error(400)
            try:
                page = fetch_safer(dot, "USDOT")
            except Exception as e:
                return self.send_body(502, f"SAFER error: {e}".encode(), "text/plain; charset=utf-8")
            page = re.sub(r"(<head[^>]*>)", r'\1<base href="https://safer.fmcsa.dot.gov/">', page, count=1, flags=re.I)
            return self.send_body(200, page.encode("latin-1", "replace"), "text/html; charset=iso-8859-1")
        if url.path not in ("/", "/index.html"):
            return self.send_error(404)
        self.path = "/index.html"
        return super().do_GET()


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    link = f"http://{HOST}:{PORT}"
    print(f"MC Scanner: {link}  (Ctrl+C — остановить)", flush=True)
    if not CLOUD and "--no-browser" not in sys.argv:
        webbrowser.open(link)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
