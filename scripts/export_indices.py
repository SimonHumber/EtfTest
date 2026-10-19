#!/usr/bin/env python3
"""Export Yahoo index names and descriptions: python scripts/export_indices.py."""

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read_tickers(path):
    lines = Path(path).read_text(encoding="utf-8-sig").splitlines()
    return list(dict.fromkeys(line.strip().upper() for line in lines if line.strip()))


def nonblank(value):
    return isinstance(value, str) and bool(value.strip())


def export(tickers, ticker_factory):
    result = {}
    failures = 0
    for symbol in tickers:
        try:
            info = ticker_factory(symbol).info
            if not isinstance(info, dict) or not info:
                raise ValueError("Yahoo returned no metadata")
            name = next((info[key] for key in ("longName", "shortName")
                         if nonblank(info.get(key))), symbol)
            description = next((info[key] for key in ("longBusinessSummary", "description")
                                if nonblank(info.get(key))), "")
            result[symbol] = {"name": name, "description": description}
        except Exception as error:
            print(f"{symbol}: {error}", file=sys.stderr)
            result[symbol] = {"name": symbol, "description": ""}
            failures += 1
    return result, failures


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "public/indices.txt")
    parser.add_argument("--output", type=Path, default=ROOT / "public/indices.json")
    args = parser.parse_args(argv)
    try:
        import yfinance as yf

        tickers = read_tickers(args.input)
        if not tickers:
            raise ValueError("Input contains no ticker symbols")
        result, failures = export(tickers, yf.Ticker)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except (ImportError, OSError, ValueError) as error:
        print(f"Export failed: {error}", file=sys.stderr)
        return 1
    print(f"Wrote {args.output}: {len(result) - failures} succeeded, {failures} failed.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
