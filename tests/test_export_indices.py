import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from scripts.export_indices import export, main, read_tickers


class ExportIndicesTests(unittest.TestCase):
    def test_input_normalizes_bom_blanks_case_and_duplicates(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "indices.txt"
            path.write_text("\ufeff ^gspc \n\n^GSPC\n ^ndx\n", encoding="utf-8")
            self.assertEqual(read_tickers(path), ["^GSPC", "^NDX"])

    def test_names_and_descriptions_come_from_yahoo(self):
        factory = Mock(side_effect=[
            SimpleNamespace(info={"longName": "S&P 500", "shortName": "Ignored", "longBusinessSummary": "Index summary", "description": "Ignored"}),
            SimpleNamespace(info={"longName": " ", "shortName": "Nasdaq", "longBusinessSummary": " ", "description": "Short summary"}),
            SimpleNamespace(info={"region": "US"}),
        ])
        result, failures = export(["^GSPC", "^NDX", "UNKNOWN"], factory)
        self.assertEqual(result, {"^GSPC": {"name": "S&P 500", "description": "Index summary"}, "^NDX": {"name": "Nasdaq", "description": "Short summary"}, "UNKNOWN": {"name": "UNKNOWN", "description": ""}})
        self.assertEqual(failures, 0)

    def test_cli_writes_every_ticker_and_reports_lookup_failures(self):
        factory = Mock(side_effect=[
            RuntimeError("Rate limited"), SimpleNamespace(info={}),
            SimpleNamespace(info={"longName": "日本", "description": "日本の説明"}),
        ])
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / "indices.txt", Path(directory) / "indices.json"
            source.write_text("BAD\nEMPTY\nGOOD\n")
            with patch.dict("sys.modules", {"yfinance": SimpleNamespace(Ticker=factory)}), contextlib.redirect_stderr(io.StringIO()) as errors, contextlib.redirect_stdout(io.StringIO()) as summary:
                status = main(["--input", str(source), "--output", str(output)])
            self.assertEqual(status, 1)
            self.assertEqual(json.loads(output.read_text()), {"BAD": {"name": "BAD", "description": ""}, "EMPTY": {"name": "EMPTY", "description": ""}, "GOOD": {"name": "日本", "description": "日本の説明"}})
            self.assertTrue(output.read_text().endswith("\n"))
            self.assertIn("BAD: Rate limited", errors.getvalue())
            self.assertIn("1 succeeded, 2 failed", summary.getvalue())


if __name__ == "__main__":
    unittest.main()
