#!/usr/bin/env python3
"""Market-data operations shared by the HTTP function and command-line bridge."""
import json
import sys
from datetime import date, datetime

try:
    import pandas as pd
    import yfinance as yf
except ImportError as error:
    raise RuntimeError("Python market dependencies are missing. Install requirements.txt.") from error


def number(value):
    try:
        value = float(value)
        return value if value == value else None
    except (TypeError, ValueError):
        return None


def lookup(symbol):
    ticker = yf.Ticker(symbol)
    info = ticker.info or {}
    fast = ticker.fast_info or {}
    price = number(fast.get("lastPrice")) or number(info.get("regularMarketPrice"))
    previous = number(fast.get("previousClose")) or number(info.get("regularMarketPreviousClose"))
    if price is None:
        history = ticker.history(period="5d", auto_adjust=True)
        if history.empty:
            return {"error": f"No market data was found for {symbol}."}
        price = number(history["Close"].iloc[-1])
        previous = number(history["Close"].iloc[-2]) if len(history) > 1 else price
    change = price - (previous or price)
    dividend_yield = number(info.get("dividendYield"))
    # Yahoo returns this as either a fraction or an already-percent value, depending on quote type.
    if dividend_yield is not None and dividend_yield < 0.5:
        dividend_yield *= 100
    expense_ratio = number(info.get("netExpenseRatio"))
    if expense_ratio is None:
        annual_expense_ratio = number(info.get("annualReportExpenseRatio"))
        if annual_expense_ratio is None and info.get("quoteType") in ("ETF", "MUTUALFUND"):
            try:
                operations = ticker.funds_data.fund_operations
                annual_expense_ratio = number(operations.loc["Annual Report Expense Ratio", symbol])
            except Exception:
                # Optional fund data must not prevent a successful quote lookup.
                pass
        # Annual-report ratios are fractions; netExpenseRatio is already a percentage.
        if annual_expense_ratio is not None:
            expense_ratio = annual_expense_ratio * 100
    aum = number(info.get("totalAssets"))
    if aum is None:
        aum = number(info.get("netAssets"))
    return {
        "symbol": info.get("symbol", symbol),
        "name": info.get("longName") or info.get("shortName") or symbol,
        "price": price,
        "change": change,
        "changePercent": (change / previous * 100) if previous else 0,
        "currency": info.get("currency", "USD"),
        "quoteType": info.get("quoteType"),
        "exchange": info.get("fullExchangeName") or info.get("exchange", "-"),
        "sector": info.get("category") or info.get("sector"),
        "industry": info.get("industry") or ("Exchange Traded Fund" if info.get("quoteType") == "ETF" else None),
        "marketCap": number(info.get("marketCap")) or number(fast.get("marketCap")),
        "aum": aum,
        "expenseRatio": expense_ratio,
        "pe": number(info.get("trailingPE")),
        "dividendYield": dividend_yield or 0,
        "fiftyTwoWeekHigh": number(info.get("fiftyTwoWeekHigh")),
        "fiftyTwoWeekLow": number(info.get("fiftyTwoWeekLow")),
        "description": info.get("longBusinessSummary") or info.get("longName"),
    }


def search(query):
    results = []
    for quote in (yf.Search(query, max_results=8, news_count=0).quotes or []):
        symbol = quote.get("symbol")
        if symbol:
            results.append({
                "symbol": symbol,
                "name": quote.get("longname") or quote.get("shortname") or symbol,
                "type": quote.get("quoteType") or quote.get("typeDisp") or "Security",
                "exchange": quote.get("exchDisp") or quote.get("exchange") or "",
            })
    return {"results": results}


def history(symbol):
    end = pd.Timestamp.now(tz="UTC").tz_localize(None).normalize()
    # Fetch the full available daily series once; chart ranges are selected in the browser.
    ticker = yf.Ticker(symbol)
    prices = ticker.history(period="max", auto_adjust=True, actions=False)
    if prices.empty or "Close" not in prices:
        return {"error": f"No price history was found for {symbol}."}
    close = prices["Close"].dropna().copy()
    close.index = pd.to_datetime(close.index).tz_localize(None).normalize()
    close = close[~close.index.duplicated(keep="last")].sort_index()
    if len(close) < 2:
        return {"error": f"Not enough daily history is available for {symbol}."}
    base = close.iloc[0]
    points = [{"date": index.strftime("%Y-%m-%d"), "return": round((value / base - 1) * 100, 4), "close": float(value)} for index, value in close.items()]

    period_starts = {
        "3M": end - pd.DateOffset(months=3),
        "YTD": pd.Timestamp(year=end.year, month=1, day=1),
        "1Y": end - pd.DateOffset(years=1),
        "3Y": end - pd.DateOffset(years=3),
        "5Y": end - pd.DateOffset(years=5),
    }
    performance = {}
    latest = close.iloc[-1]
    for label, target in period_starts.items():
        eligible = close.loc[close.index <= target]
        performance[label] = round((latest / eligible.iloc[-1] - 1) * 100, 2) if len(eligible) else None

    intraday_points = {}
    session_bases = {}
    for interval in ("5m", "30m"):
        intraday_points[interval] = []
        intraday_history = ticker.history(period="5d", interval=interval, auto_adjust=True, actions=False)
        if intraday_history.empty or "Close" not in intraday_history:
            continue
        intraday_history.index = pd.to_datetime(intraday_history.index).tz_localize(None)
        for timestamp, value in intraday_history["Close"].dropna().items():
            session = timestamp.strftime("%Y-%m-%d")
            if session not in session_bases:
                prior = close.loc[close.index < pd.Timestamp(session)]
                session_bases[session] = float(prior.iloc[-1] if len(prior) else value)
            intraday_points[interval].append({"date": timestamp.strftime("%Y-%m-%dT%H:%M:%S"), "close": float(value)})

    metadata = ticker.history_metadata or {}
    return {"symbol": symbol, "points": points, "performance": performance, "intradayPoints": intraday_points, "sessionBases": session_bases, "currency": metadata.get("currency", "USD"), "quoteType": metadata.get("instrumentType")}


def risk_free_rates():
    prices = yf.Ticker("^IRX").history(period="max", interval="1d", auto_adjust=True, actions=False)
    if prices.empty or "Close" not in prices:
        return {"error": "Historical ^IRX financing rates are unavailable. Please try again."}
    close = prices["Close"].dropna().copy()
    close.index = pd.to_datetime(close.index).tz_localize(None).normalize()
    close = close[~close.index.duplicated(keep="last")].sort_index()
    return {"symbol": "^IRX", "points": [{"date": index.strftime("%Y-%m-%d"), "rate": float(value) / 100} for index, value in close.items()]}


def add_months(value, months):
    month = value.month - 1 + months
    return date(value.year + month // 12, month % 12 + 1, min(value.day, 28))


def scheduled_dates(flow, last_date):
    start = datetime.strptime(flow["date"], "%Y-%m-%d").date()
    if flow.get("type") != "recurring":
        return [start]
    frequency = flow.get("frequency", "monthly")
    dates = []
    current = start
    while current <= last_date:
        dates.append(current)
        if frequency == "weekly":
            current = current + pd.Timedelta(days=7)
        elif frequency == "quarterly":
            current = add_months(current, 3)
        else:
            current = add_months(current, 1)
    return dates


def backtest(payload):
    portfolios = payload.get("portfolios") or []
    if not portfolios:
        return {"error": "Add at least one portfolio."}
    symbols = sorted({h.get("symbol", "").upper().strip() for p in portfolios for h in p.get("holdings", []) if h.get("symbol", "").strip()})
    if not symbols:
        return {"error": "Add a ticker to each portfolio."}

    prices = {}
    intraday_prices = {"5m": {}, "30m": {}}
    # Fetch individually to keep Yahoo's occasional multi-index response out of calculations.
    for symbol in symbols:
        history = yf.Ticker(symbol).history(period="max", auto_adjust=True, actions=False)
        if history.empty or "Close" not in history:
            return {"error": f"No price history was found for {symbol}."}
        series = history["Close"].copy()
        series.index = pd.to_datetime(series.index).tz_localize(None).normalize()
        prices[symbol] = series
        for interval in intraday_prices:
            intraday_history = yf.Ticker(symbol).history(period="5d", interval=interval, auto_adjust=True, actions=False)
            if not intraday_history.empty and "Close" in intraday_history:
                series = intraday_history["Close"].copy()
                series.index = pd.to_datetime(series.index).tz_localize(None)
                intraday_prices[interval][symbol] = series

    dates = pd.DatetimeIndex(sorted(set.union(*[set(s.index) for s in prices.values()])))
    frame = pd.DataFrame(prices, index=dates).ffill().dropna()
    if len(frame) < 2:
        return {"error": "The selected tickers do not have an overlapping daily price history."}
    rows = []
    for day, row in frame.iterrows():
        rows.append({"date": day.strftime("%Y-%m-%d"), "prices": {symbol: round(float(value), 6) for symbol, value in row.items()}})
    intraday_rows = {}
    for interval, interval_prices in intraday_prices.items():
        intraday_rows[interval] = []
        if len(interval_prices) != len(symbols):
            continue
        intraday_dates = pd.DatetimeIndex(sorted(set.union(*[set(series.index) for series in interval_prices.values()])))
        intraday_frame = pd.DataFrame(interval_prices, index=intraday_dates).ffill().dropna()
        for timestamp, row in intraday_frame.iterrows():
            intraday_rows[interval].append({"date": timestamp.strftime("%Y-%m-%dT%H:%M:%S"), "prices": {symbol: round(float(value), 6) for symbol, value in row.items()}})
    return {"priceHistory": rows, "intradayPriceHistory": intraday_rows, "symbols": symbols}


class MarketRequestError(ValueError):
    pass


def dispatch(payload):
    if not isinstance(payload, dict):
        raise MarketRequestError("The request body must be a JSON object.")
    action = payload.get("action")
    if action in ("lookup", "history"):
        symbol = payload.get("symbol")
        if not isinstance(symbol, str) or not symbol.strip():
            raise MarketRequestError("A ticker symbol is required.")
        return (lookup if action == "lookup" else history)(symbol.strip().upper())
    if action == "search":
        query = payload.get("query", "")
        if not isinstance(query, str):
            raise MarketRequestError("Search query must be text.")
        return search(query.strip()) if query.strip() else {"results": []}
    if action == "backtest":
        portfolios = payload.get("portfolios")
        if not isinstance(portfolios, list) or not portfolios:
            raise MarketRequestError("Add at least one portfolio.")
        for portfolio in portfolios:
            if not isinstance(portfolio, dict) or not isinstance(portfolio.get("holdings"), list):
                raise MarketRequestError("Each portfolio must contain a holdings list.")
            if any(not isinstance(holding, dict) or not isinstance(holding.get("symbol"), str) for holding in portfolio["holdings"]):
                raise MarketRequestError("Each holding must contain a ticker symbol.")
        return backtest({"portfolios": portfolios})
    if action == "rates":
        return risk_free_rates()
    raise MarketRequestError("Unknown market-data action.")


def main():
    try:
        payload = json.loads(sys.argv[1]) if len(sys.argv) > 1 else json.load(sys.stdin)
        result = dispatch(payload)
    except Exception as error:
        result = {"error": str(error)}
    print(json.dumps(result, default=str))


if __name__ == "__main__":
    main()
