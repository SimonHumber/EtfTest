import gzip
import io
import json
import os
import unittest
from email.message import Message
from unittest.mock import Mock, patch

from api.python_market import handler
from services import yfinance_service as service

TEST_TOKEN = "unit-test-market-secret-not-a-production-credential"


def request(payload=None, method="POST", path="/api/python_market", headers=None):
    body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
    function = handler.__new__(handler)
    function.path = path
    function.headers = Message()
    function.headers["Content-Length"] = str(len(body))
    function.headers["Authorization"] = f"Bearer {TEST_TOKEN}"
    for key, value in (headers or {}).items():
        if value is None:
            if key in function.headers:
                del function.headers[key]
            continue
        if key in function.headers:
            function.headers.replace_header(key, value)
        else:
            function.headers[key] = value
    function.rfile = io.BytesIO(body)
    function.wfile = io.BytesIO()
    function.send_response = Mock()
    function.send_header = Mock()
    function.end_headers = Mock()
    getattr(function, f"do_{method}")()
    response_headers = dict(call.args for call in function.send_header.call_args_list)
    response_body = function.wfile.getvalue()
    if response_headers.get("Content-Encoding") == "gzip":
        response_body = gzip.decompress(response_body)
    return function.send_response.call_args.args[0], json.loads(response_body), response_headers


class MarketHTTPTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ, {"YFINANCE_API_TOKEN": TEST_TOKEN})
        environment.start()
        self.addCleanup(environment.stop)

    def test_unauthenticated_and_forged_requests_cannot_reach_market_operations(self):
        invalid_headers = [
            {"Authorization": None},
            {"Authorization": "Bearer wrong-token"},
            {"Authorization": f"Basic {TEST_TOKEN}"},
            {"Authorization": f"Bearer {TEST_TOKEN}-suffix"},
            {"Authorization": None, "Origin": "https://atlas.example", "Referer": "https://atlas.example/research"},
        ]
        with patch.object(service, "dispatch") as dispatch:
            for headers in invalid_headers:
                for method in ("GET", "POST"):
                    with self.subTest(headers=headers, method=method):
                        status, data, response_headers = request({"action": "rates", "token": TEST_TOKEN}, method=method, headers=headers)
                        self.assertEqual(status, 401)
                        self.assertEqual(data, {"error": "Unauthorized."})
                        self.assertIn("Bearer", response_headers["WWW-Authenticate"])
            dispatch.assert_not_called()

    def test_missing_server_secret_fails_closed(self):
        with patch.dict(os.environ, {"YFINANCE_API_TOKEN": ""}), patch.object(service, "dispatch") as dispatch:
            for method in ("GET", "POST"):
                self.assertEqual(request({"action": "rates"}, method=method)[0], 503)
            dispatch.assert_not_called()

    def test_valid_token_is_accepted_with_case_insensitive_bearer_scheme(self):
        with patch.object(service, "risk_free_rates", return_value={"points": []}) as rates:
            self.assertEqual(request({"action": "rates"}, headers={"Authorization": f"bEaReR {TEST_TOKEN}"})[0], 200)
            rates.assert_called_once()

    def test_environment_token_ignores_surrounding_whitespace(self):
        with patch.dict(os.environ, {"YFINANCE_API_TOKEN": f"  {TEST_TOKEN}\n"}):
            self.assertEqual(request(method="GET")[0], 200)

    def test_health_and_unknown_paths_do_not_fetch_yahoo(self):
        with patch.object(service, "dispatch") as dispatch:
            status, data, _ = request(method="GET")
            self.assertEqual(status, 200)
            self.assertEqual(data["status"], "ok")
            self.assertEqual(request(method="GET", path="/unknown")[0], 404)
            self.assertEqual(request({}, path="/unknown")[0], 404)
            dispatch.assert_not_called()

    def test_lookup_and_history_use_normalized_symbols(self):
        for action in ("lookup", "history"):
            with self.subTest(action=action), patch.object(service, action, return_value={"symbol": "^GSPC"}) as operation:
                status, data, _ = request({"action": action, "symbol": " ^gspc "})
                self.assertEqual(status, 200)
                self.assertEqual(data["symbol"], "^GSPC")
                operation.assert_called_once_with("^GSPC")

    def test_search_and_rates_are_dispatched_over_http(self):
        with patch.object(service, "search", return_value={"results": [{"symbol": "VOO"}]}) as search:
            status, data, _ = request({"action": "search", "query": " voo "})
            self.assertEqual(status, 200)
            self.assertEqual(data["results"][0]["symbol"], "VOO")
            search.assert_called_once_with("voo")
        with patch.object(service, "risk_free_rates", return_value={"symbol": "^IRX", "points": [{"date": "2024-01-01", "rate": .04}]}):
            self.assertEqual(request({"action": "rates"})[1]["points"][0]["rate"], .04)

    def test_backtest_validation_and_payload(self):
        portfolios = [{"holdings": [{"symbol": "VOO", "weight": 100}]}]
        with patch.object(service, "backtest", return_value={"priceHistory": []}) as backtest:
            self.assertEqual(request({"action": "backtest", "portfolios": portfolios})[0], 200)
            backtest.assert_called_once_with({"portfolios": portfolios})
        for portfolios in (None, [], [None], [{}], [{"holdings": [None]}], [{"holdings": [{"symbol": 123}]}]):
            with self.subTest(portfolios=portfolios):
                self.assertEqual(request({"action": "backtest", "portfolios": portfolios})[0], 400)

    def test_invalid_json_actions_and_parameters_fail_before_fetching(self):
        for payload in (b"{", [], None, {}, {"action": "unknown"}, {"action": "lookup"}, {"action": "history", "symbol": 123}, {"action": "search", "query": []}):
            with self.subTest(payload=payload):
                self.assertEqual(request(payload)[0], 400)
        with patch.object(service, "search") as search:
            self.assertEqual(request({"action": "search", "query": " "})[1], {"results": []})
            search.assert_not_called()
        self.assertEqual(request({}, headers={"Content-Length": "-1"})[0], 400)
        self.assertEqual(request({}, headers={"Content-Length": "4000001"})[0], 413)

    def test_provider_errors_are_separate_from_bad_requests(self):
        with patch.object(service, "lookup", return_value={"error": "No data found"}):
            self.assertEqual(request({"action": "lookup", "symbol": "UNKNOWN"})[0], 422)
        with patch.object(service, "lookup", side_effect=ValueError("Internal provider details")), self.assertLogs(level="ERROR"):
            status, data, _ = request({"action": "lookup", "symbol": "VOO"})
            self.assertEqual(status, 502)
            self.assertNotIn("Internal provider details", data["error"])

    def test_nonfinite_numbers_are_null_and_zero_is_preserved(self):
        with patch.object(service, "lookup", return_value={"price": 0, "pe": float("nan"), "values": [float("inf"), float("-inf")]}):
            status, data, _ = request({"action": "lookup", "symbol": "TEST"})
            self.assertEqual(status, 200)
            self.assertEqual(data, {"price": 0, "pe": None, "values": [None, None]})

    def test_gzip_preserves_full_history(self):
        points = [{"date": str(i), "close": i / 1000000} for i in range(1000)]
        with patch.object(service, "history", return_value={"points": points}):
            status, data, headers = request({"action": "history", "symbol": "TEST"}, headers={"Accept-Encoding": "gzip"})
            self.assertEqual(status, 200)
            self.assertEqual(headers["Content-Encoding"], "gzip")
            self.assertEqual(data["points"], points)
            self.assertEqual(headers["Cache-Control"], "no-store")


if __name__ == "__main__":
    unittest.main()
