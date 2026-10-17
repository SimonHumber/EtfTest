import unittest
from datetime import date

from services.yfinance_service import scheduled_dates


class AnnualCashFlowTests(unittest.TestCase):
    def test_annual_schedule_and_end_date(self):
        flow = {"type": "recurring", "frequency": "annual", "date": "2024-01-01"}
        self.assertEqual(scheduled_dates(flow, date(2026, 12, 31)), [date(2024, 1, 1), date(2025, 1, 1), date(2026, 1, 1)])
        self.assertEqual(scheduled_dates(flow, date(2023, 12, 31)), [])

    def test_leap_day_anniversary_is_preserved(self):
        flow = {"type": "recurring", "frequency": "annual", "date": "2024-02-29"}
        self.assertEqual(scheduled_dates(flow, date(2028, 12, 31)), [date(2024, 2, 29), date(2025, 2, 28), date(2026, 2, 28), date(2027, 2, 28), date(2028, 2, 29)])

    def test_month_end_anniversary_is_preserved(self):
        flow = {"type": "recurring", "frequency": "annual", "date": "2024-01-31"}
        self.assertEqual(scheduled_dates(flow, date(2026, 12, 31)), [date(2024, 1, 31), date(2025, 1, 31), date(2026, 1, 31)])


if __name__ == "__main__":
    unittest.main()
