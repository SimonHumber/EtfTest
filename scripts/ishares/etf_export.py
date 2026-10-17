"""Shared Yahoo Finance metadata exporter; CSV columns other than Ticker are ignored."""

import argparse
import csv
import json
import math
import os
import sys
import tempfile
import time
from datetime import date, datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read_tickers(path):
    with Path(path).open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        if not reader.fieldnames or "Ticker" not in reader.fieldnames:
            raise ValueError(f"{path}: CSV must contain a Ticker column.")
        tickers = dict.fromkeys(
            row["Ticker"].strip() for row in reader if row.get("Ticker", "").strip()
        )
    if not tickers:
        raise ValueError(f"{path}: no tickers found.")
    return list(tickers)


def yahoo_symbol(ticker, canadian):
    symbol = ticker.upper()
    if canadian:
        suffix = ".NE" if symbol.endswith(".NE") else ".TO"
        base = symbol[:-3] if symbol.endswith((".TO", ".NE")) else symbol
        # Yahoo uses a hyphen for Canadian unit classes, e.g. XUU.U -> XUU-U.TO.
        return base.replace(".", "-") + suffix
    return symbol


def numeric(value):
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) and result >= 0 else None
    except (TypeError, ValueError, OverflowError):
        return None


def first_number(*values):
    return next((number for value in values if (number := numeric(value)) is not None), None)


def inception_date(value):
    try:
        if isinstance(value, datetime):
            return value.date().isoformat()
        if isinstance(value, date):
            return value.isoformat()
        if isinstance(value, str) and "-" in value:
            return date.fromisoformat(value[:10]).isoformat()
        timestamp = numeric(value)
        if timestamp is not None and timestamp > 0:
            return datetime.fromtimestamp(timestamp, timezone.utc).date().isoformat()
    except (ValueError, OverflowError, OSError):
        pass
    return None


def metadata(ticker, symbol, fund):
    info = fund.get_info() or {}
    if not isinstance(info, dict) or not (info.get("longName") or info.get("shortName")):
        raise ValueError(f"Yahoo returned no fund metadata for {symbol}.")
    aum = first_number(info.get("totalAssets"), info.get("netAssets"))
    mer = numeric(info.get("netExpenseRatio"))
    annual_ratio = numeric(info.get("annualReportExpenseRatio"))
    if aum is None or (mer is None and annual_ratio is None):
        try:
            operations = fund.funds_data.fund_operations
            if annual_ratio is None and mer is None:
                annual_ratio = numeric(operations.loc["Annual Report Expense Ratio", symbol])
            if aum is None:
                aum = numeric(operations.loc["Total Net Assets", symbol])
        except Exception as error:
            if type(error).__name__ == "YFRateLimitError":
                raise
            # Optional fund operations are unavailable for some Yahoo listings.
            pass
    if mer is None and annual_ratio is not None:
        mer = round(annual_ratio * 100, 10)
    return {
        "ticker": ticker,
        "yahooSymbol": symbol,
        "name": info.get("longName") or info.get("shortName"),
        "aum": aum,
        "mer": mer,
        "inceptionDate": inception_date(info.get("fundInceptionDate")),
    }


def write_json(path, records):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, suffix=".tmp", delete=False) as target:
            temporary = target.name
            json.dump(records, target, indent=2, ensure_ascii=False, allow_nan=False)
            target.write("\n")
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def export(tickers, canadian, ticker_factory, retries=2, delay=0.5, sleep=time.sleep):
    records = []
    failures = 0
    consecutive_failures = 0
    for index, ticker in enumerate(tickers, 1):
        symbol = yahoo_symbol(ticker, canadian)
        symbols = [symbol]
        if canadian and symbol.endswith(".TO"):
            symbols.append(symbol[:-3] + ".NE")
        record = None
        last_error = None
        for symbol in symbols:
            for attempt in range(retries + 1):
                try:
                    record = metadata(ticker, symbol, ticker_factory(symbol))
                    break
                except Exception as error:
                    last_error = error
                    if type(error).__name__ == "YFRateLimitError":
                        raise RuntimeError("Yahoo rate limit reached. Wait and rerun; the existing JSON has not been replaced.") from error
                    if attempt < retries:
                        sleep(2 ** attempt)
            if record is not None:
                break
            if symbol != symbols[-1]:
                print(f"[{index}/{len(tickers)}] {symbol}: no metadata; trying Cboe Canada ({symbols[-1]})", file=sys.stderr)
                sleep(delay)
        if record is None:
            failures += 1
            consecutive_failures += 1
            print(f"[{index}/{len(tickers)}] {symbol}: lookup failed ({last_error})", file=sys.stderr)
            record = dict.fromkeys(["ticker", "yahooSymbol", "name", "aum", "mer", "inceptionDate"])
            record["ticker"] = ticker
            if consecutive_failures >= 5:
                raise RuntimeError("Five consecutive lookups failed. Existing JSON has not been replaced; check Yahoo connectivity.")
        else:
            consecutive_failures = 0
            missing = [key for key, value in record.items() if value is None]
            detail = f"; unavailable: {', '.join(missing)}" if missing else ""
            print(f"[{index}/{len(tickers)}] {symbol}: fetched{detail}", file=sys.stderr)
        records.append(record)
        if index < len(tickers):
            sleep(delay)
    if failures == len(tickers):
        raise RuntimeError("No metadata was fetched. Existing JSON has not been replaced.")
    return records, failures


def main(csv_name, canadian):
    parser = argparse.ArgumentParser(description="Export iShares ETF metadata from Yahoo Finance; only tickers come from CSV.")
    parser.add_argument("--input", type=Path, default=ROOT / "public" / csv_name)
    parser.add_argument("--output", type=Path, default=ROOT / "public" / Path(csv_name).with_suffix(".json"))
    parser.add_argument("--delay", type=float, default=0.5, help="Seconds between tickers (default: 0.5).")
    parser.add_argument("--retries", type=int, default=2, help="Retries per failed lookup (default: 2).")
    parser.add_argument("--limit", type=int, help="Export only the first N tickers for a quick check.")
    args = parser.parse_args()
    if not math.isfinite(args.delay) or args.delay < 0 or args.retries < 0 or (args.limit is not None and args.limit < 1):
        parser.error("Delay and retries must be nonnegative; limit must be positive.")
    if args.input.resolve() == args.output.resolve():
        parser.error("Input and output must be different files.")
    try:
        import yfinance as yf

        yf.set_tz_cache_location(str(Path(tempfile.gettempdir()) / "atlas-etf-export"))
        tickers = read_tickers(args.input)
        if args.limit:
            tickers = tickers[:args.limit]
        records, failures = export(tickers, canadian, yf.Ticker, args.retries, args.delay)
        write_json(args.output, records)
        print(f"Saved {len(records)} ETFs to {args.output}; {failures} failed lookups.")
        return 1 if failures else 0
    except (ImportError, OSError, ValueError, RuntimeError) as error:
        print(f"Export failed: {error}", file=sys.stderr)
        return 1
