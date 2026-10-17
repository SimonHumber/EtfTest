#!/usr/bin/env python3
"""Generate public/iShareCan.json using tickers from public/iShareCan.csv."""

from etf_export import main


if __name__ == "__main__":
    raise SystemExit(main("iShareCan.csv", canadian=True))
