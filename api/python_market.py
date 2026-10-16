"""Vercel Python Function; also runnable locally with python -m api.python_market."""
import gzip
import hmac
import json
import logging
import math
import os
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from services import yfinance_service

# Vercel's deployment filesystem is read-only; only cache transient Yahoo metadata in /tmp.
yfinance_service.yf.set_tz_cache_location(os.path.join(tempfile.gettempdir(), "atlas-yfinance"))

MAX_BODY_BYTES = 4_000_000


def json_safe(value):
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


class handler(BaseHTTPRequestHandler):
    def send_json(self, data, status=200, headers=None):
        body = json.dumps(json_safe(data), separators=(",", ":"), allow_nan=False).encode("utf-8")
        compressed = "gzip" in self.headers.get("Accept-Encoding", "").lower() and len(body) > 1024
        if compressed:
            body = gzip.compress(body)
        if len(body) > MAX_BODY_BYTES:
            body = b'{"error":"Market-data response is too large. Request fewer tickers at once."}'
            status = 413
            compressed = False
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Vary", "Accept-Encoding")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        if compressed:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        expected = os.environ.get("YFINANCE_API_TOKEN", "").strip()
        if not expected:
            self.send_json({"error": "Market service authentication is not configured."}, 503)
            return False
        scheme, separator, token = self.headers.get("Authorization", "").partition(" ")
        if scheme.lower() != "bearer" or not separator or not hmac.compare_digest(token.encode("utf-8"), expected.encode("utf-8")):
            self.send_json({"error": "Unauthorized."}, 401, {"WWW-Authenticate": 'Bearer realm="market-service"'})
            return False
        return True

    def do_GET(self):
        if urlsplit(self.path).path.rstrip("/") != "/api/python_market":
            self.send_json({"error": "Not found."}, 404)
            return
        if not self.authorized():
            return
        self.send_json({"status": "ok", "service": "yfinance"})

    def do_POST(self):
        if urlsplit(self.path).path.rstrip("/") != "/api/python_market":
            self.send_json({"error": "Not found."}, 404)
            return
        if not self.authorized():
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0:
                raise ValueError("A JSON request body is required.")
            if length > MAX_BODY_BYTES:
                self.send_json({"error": "Request body is too large."}, 413)
                return
            payload = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError):
            self.send_json({"error": "A valid JSON request body is required."}, 400)
            return
        try:
            data = yfinance_service.dispatch(payload)
        except yfinance_service.MarketRequestError as error:
            self.send_json({"error": str(error)}, 400)
            return
        except Exception:
            logging.exception("Market-data request failed")
            self.send_json({"error": "Yahoo Finance data is temporarily unavailable. Please try again."}, 502)
            return
        self.send_json(data, 422 if data.get("error") else 200)


if __name__ == "__main__":
    host = os.environ.get("YFINANCE_HOST", "127.0.0.1")
    port = int(os.environ.get("YFINANCE_PORT", "8000"))
    server = ThreadingHTTPServer((host, port), handler)
    print(f"yfinance HTTP service: http://{host}:{port}/api/python_market", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
