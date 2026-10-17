import contextlib
import csv
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

import pandas as pd

from scripts.ishares.etf_export import (
    export, inception_date, metadata, read_tickers, write_json, yahoo_symbol,
)


def fund(**info):
    result = Mock()
    result.get_info.return_value = {
        "longName": "Yahoo fund name", "totalAssets": 123456, "netExpenseRatio": 0.03,
        "fundInceptionDate": 958348800, **info,
    }
    return result


class ISharesExportTests(unittest.TestCase):
    def test_csv_only_uses_ticker_and_handles_multiline_headers_bom_and_duplicates(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "funds.csv"
            with path.open("w", encoding="utf-8-sig", newline="") as output:
                writer = csv.writer(output)
                writer.writerow(["Ticker", "Name", "Distribution\nYield", "MER"])
                writer.writerows([[" XMV ", "Do not use", "123", "999"], ["XMV", "Other", "", ""], ["", "Ignore", "", ""], ["IVV", "Wrong name", "", "999"]])
            self.assertEqual(read_tickers(path), ["XMV", "IVV"])

    def test_missing_ticker_header_or_empty_csv_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "funds.csv"
            for content in ["Name\nFund\n", "Ticker,Name\n,Fund\n"]:
                path.write_text(content)
                with self.assertRaises(ValueError):
                    read_tickers(path)

    def test_country_and_unit_class_symbols_preserve_output_ticker(self):
        self.assertEqual(yahoo_symbol("XMV", True), "XMV.TO")
        self.assertEqual(yahoo_symbol("XUU.U", True), "XUU-U.TO")
        self.assertEqual(yahoo_symbol("CLU.C", True), "CLU-C.TO")
        self.assertEqual(yahoo_symbol("XMV.TO", True), "XMV.TO")
        self.assertEqual(yahoo_symbol("CWO.NE", True), "CWO.NE")
        self.assertEqual(yahoo_symbol("CLU.C.NE", True), "CLU-C.NE")
        self.assertEqual(yahoo_symbol("IVV", False), "IVV")
        self.assertEqual(metadata("XUU.U", "XUU-U.TO", fund())["ticker"], "XUU.U")

    def test_yahoo_fields_and_epoch_inception_date_are_exported(self):
        result = metadata("IVV", "IVV", fund(symbol="DIFFERENT"))
        self.assertEqual(result, {"ticker": "IVV", "yahooSymbol": "IVV", "name": "Yahoo fund name", "aum": 123456, "mer": 0.03, "inceptionDate": "2000-05-15"})

    def test_canadian_export_falls_back_to_cboe_and_preserves_unit_class_ticker(self):
        empty = fund(longName=None, shortName=None)
        factory = Mock(side_effect=[empty, empty, fund(longName="Cboe fund")])
        with contextlib.redirect_stderr(io.StringIO()) as log:
            rows, failures = export(["CLU.C"], True, factory, retries=1, sleep=Mock())
        self.assertEqual([call.args[0] for call in factory.call_args_list], ["CLU-C.TO", "CLU-C.TO", "CLU-C.NE"])
        self.assertEqual(rows[0]["ticker"], "CLU.C")
        self.assertEqual(rows[0]["name"], "Cboe fund")
        self.assertEqual(rows[0]["yahooSymbol"], "CLU-C.NE")
        self.assertEqual(failures, 0)
        self.assertIn("trying Cboe Canada", log.getvalue())

    def test_successful_tsx_lookup_with_missing_optional_fields_does_not_query_cboe(self):
        source = fund(netExpenseRatio=None)
        source.funds_data.fund_operations = pd.DataFrame()
        factory = Mock(return_value=source)
        with contextlib.redirect_stderr(io.StringIO()):
            rows, failures = export(["XMV"], True, factory, sleep=Mock())
        factory.assert_called_once_with("XMV.TO")
        self.assertIsNone(rows[0]["mer"])
        self.assertEqual(failures, 0)

    def test_both_canadian_exchanges_failing_keeps_null_row_and_continues(self):
        factory = Mock(side_effect=[ValueError("TSX missing"), ValueError("Cboe missing"), fund()])
        with contextlib.redirect_stderr(io.StringIO()):
            rows, failures = export(["BAD", "XMV"], True, factory, retries=0, sleep=Mock())
        self.assertEqual([call.args[0] for call in factory.call_args_list], ["BAD.TO", "BAD.NE", "XMV.TO"])
        self.assertEqual(failures, 1)
        self.assertIsNone(rows[0]["name"])
        self.assertEqual(rows[1]["ticker"], "XMV")

    def test_explicit_cboe_symbol_does_not_get_a_second_exchange_suffix(self):
        factory = Mock(return_value=fund())
        with contextlib.redirect_stderr(io.StringIO()):
            export(["CWO.NE"], True, factory, sleep=Mock())
        factory.assert_called_once_with("CWO.NE")

    def test_rate_limit_does_not_trigger_exchange_fallback(self):
        class YFRateLimitError(Exception):
            pass
        factory = Mock(side_effect=YFRateLimitError("limited"))
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(RuntimeError):
            export(["CWO"], True, factory, sleep=Mock())
        factory.assert_called_once_with("CWO.TO")

    def test_optional_missing_values_remain_null_and_do_not_guess_inception(self):
        source = fund(totalAssets=None, netExpenseRatio=None, fundInceptionDate=None, firstTradeDateEpochUtc=958348800)
        source.funds_data.fund_operations = pd.DataFrame()
        result = metadata("XMV", "XMV.TO", source)
        self.assertEqual(result, {"ticker": "XMV", "yahooSymbol": "XMV.TO", "name": "Yahoo fund name", "aum": None, "mer": None, "inceptionDate": None})

    def test_annual_expense_fraction_converts_to_percentage_and_preserves_zero(self):
        result = metadata("IVV", "IVV", fund(netExpenseRatio=None, annualReportExpenseRatio=0.0034))
        self.assertEqual(result["mer"], 0.34)
        result = metadata("IVV", "IVV", fund(totalAssets=0, netAssets=999, netExpenseRatio=0, annualReportExpenseRatio=0.5))
        self.assertEqual(result["mer"], 0)
        self.assertEqual(result["aum"], 0)

    def test_fund_operations_fallback_uses_fund_not_category_average(self):
        source = fund(totalAssets=float("nan"), netExpenseRatio=None)
        source.funds_data.fund_operations = pd.DataFrame({"XMV.TO": [0.0034, 1234], "Category Average": [0.99, 9999]}, index=["Annual Report Expense Ratio", "Total Net Assets"])
        result = metadata("XMV", "XMV.TO", source)
        self.assertEqual(result["mer"], 0.34)
        self.assertEqual(result["aum"], 1234)

    def test_invalid_dates_do_not_produce_fake_dates(self):
        for value in [None, float("nan"), float("inf"), 0, -1, True, "bad", 10 ** 100]:
            self.assertIsNone(inception_date(value))
        self.assertEqual(inception_date("2000-05-15T00:00:00Z"), "2000-05-15")

    def test_retries_continue_after_an_individual_failure(self):
        factory = Mock(side_effect=[ValueError("failed"), ValueError("failed"), fund()])
        sleep = Mock()
        with contextlib.redirect_stderr(io.StringIO()):
            rows, failures = export(["BAD", "IVV"], False, factory, retries=1, delay=0.25, sleep=sleep)
        self.assertEqual(failures, 1)
        self.assertIsNone(rows[0]["name"])
        self.assertEqual(rows[1]["ticker"], "IVV")
        self.assertEqual(factory.call_count, 3)
        self.assertEqual(sleep.call_args_list[0].args, (1,))

    def test_rate_limit_and_total_failure_do_not_return_fabricated_exports(self):
        class YFRateLimitError(Exception):
            pass
        for error in [YFRateLimitError("limited"), ValueError("offline")]:
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(RuntimeError):
                export(["IVV"], False, Mock(side_effect=error), retries=0, sleep=Mock())

    def test_missing_yahoo_identity_is_a_failed_lookup(self):
        with self.assertRaises(ValueError):
            metadata("IVV", "IVV", fund(longName=None, shortName=None))

    def test_atomic_json_is_valid_and_does_not_replace_existing_output_on_error(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "funds.json"
            rows = [metadata("IVV", "IVV", fund())]
            write_json(output, rows)
            self.assertEqual(json.loads(output.read_text()), rows)
            with self.assertRaises(ValueError):
                write_json(output, [{"aum": float("nan")}])
            self.assertEqual(json.loads(output.read_text()), rows)
            self.assertEqual(list(Path(directory).glob("*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
