"""Tests of schedule_forge.data_io.date_lines: the shared DD-MM-YYYY date lines."""

import os
import sys
import unittest
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from schedule_forge.data_io.date_lines import (parse_date, parse_dates_line,
                                                split_date_and_comment)
from schedule_forge.data_io.errors import DataFileError
from schedule_forge.data_io.record_reader import Line

PATH = "dates.txt"


class TestParseDate(unittest.TestCase):

    def test_parses_a_valid_date(self):
        self.assertEqual(parse_date(PATH, "29-01-2026", 1), date(2026, 1, 29))

    def test_strips_surrounding_whitespace(self):
        self.assertEqual(parse_date(PATH, "  29-01-2026  ", 1), date(2026, 1, 29))

    def test_accepts_a_real_leap_day(self):
        self.assertEqual(parse_date(PATH, "29-02-2024", 1), date(2024, 2, 29))

    def test_rejects_a_fake_leap_day(self):
        with self.assertRaises(DataFileError):
            parse_date(PATH, "29-02-2026", 1)

    def test_rejects_day_32(self):
        with self.assertRaises(DataFileError):
            parse_date(PATH, "32-01-2026", 1)

    def test_rejects_month_13(self):
        with self.assertRaises(DataFileError):
            parse_date(PATH, "15-13-2026", 1)

    def test_rejects_garbage_text(self):
        with self.assertRaises(DataFileError):
            parse_date(PATH, "not a date", 1)

    def test_rejects_an_iso_formatted_date(self):
        with self.assertRaises(DataFileError):
            parse_date(PATH, "2026-01-29", 1)

    def test_error_names_the_path_and_line(self):
        try:
            parse_date(PATH, "garbage", 7)
            self.fail("expected DataFileError")
        except DataFileError as error:
            self.assertEqual(error.path, PATH)
            self.assertEqual(error.line_number, 7)
            self.assertIn("line 7", str(error))
            self.assertIn(PATH, str(error))


class TestSplitDateAndComment(unittest.TestCase):

    def test_splits_a_bare_date_with_no_comment(self):
        result_date, comment = split_date_and_comment(PATH, "01-01-2026", 1)
        self.assertEqual(result_date, date(2026, 1, 1))
        self.assertEqual(comment, "")

    def test_splits_a_date_with_a_trailing_comment(self):
        result_date, comment = split_date_and_comment(PATH, "01-01-2026 New Year", 1)
        self.assertEqual(result_date, date(2026, 1, 1))
        self.assertEqual(comment, "New Year")

    def test_strips_whitespace_around_the_comment(self):
        _, comment = split_date_and_comment(PATH, "01-01-2026   holiday  ", 1)
        self.assertEqual(comment, "holiday")

    def test_raises_when_the_text_does_not_start_with_a_date(self):
        with self.assertRaises(DataFileError):
            split_date_and_comment(PATH, "holiday 01-01-2026", 1)

    def test_raises_for_an_invalid_date_prefix(self):
        with self.assertRaises(DataFileError):
            split_date_and_comment(PATH, "99-99-9999 nonsense", 1)


class TestParseDatesLine(unittest.TestCase):

    def _line(self, text, number=1):
        return Line(number, text)

    def test_parses_a_single_date(self):
        result = parse_dates_line(PATH, self._line("01-01-2026"))
        self.assertEqual(result.start, date(2026, 1, 1))
        self.assertEqual(result.end, date(2026, 1, 1))
        self.assertEqual(result.comment, "")

    def test_parses_a_single_date_with_a_comment(self):
        result = parse_dates_line(PATH, self._line("01-01-2026 New Year"))
        self.assertEqual(result.comment, "New Year")

    def test_parses_a_date_range(self):
        result = parse_dates_line(PATH, self._line("01-01-2026,05-01-2026"))
        self.assertEqual(result.start, date(2026, 1, 1))
        self.assertEqual(result.end, date(2026, 1, 5))
        self.assertEqual(result.comment, "")

    def test_parses_a_date_range_with_a_comment_on_the_end_date(self):
        result = parse_dates_line(PATH, self._line("01-01-2026,05-01-2026 break"))
        self.assertEqual(result.comment, "break")

    def test_ignores_a_comment_on_the_start_date_of_a_range(self):
        result = parse_dates_line(PATH, self._line("01-01-2026 note,05-01-2026"))
        self.assertEqual(result.start, date(2026, 1, 1))

    def test_raises_when_the_range_starts_after_it_ends(self):
        with self.assertRaises(DataFileError):
            parse_dates_line(PATH, self._line("05-01-2026,01-01-2026"))

    def test_allows_a_range_where_start_equals_end(self):
        result = parse_dates_line(PATH, self._line("01-01-2026,01-01-2026"))
        self.assertEqual(result.start, result.end)

    def test_raises_for_more_than_two_comma_separated_fields(self):
        with self.assertRaises(DataFileError):
            parse_dates_line(PATH, self._line("01-01-2026,02-01-2026,03-01-2026"))

    def test_raises_for_an_invalid_date_inside_a_range(self):
        with self.assertRaises(DataFileError):
            parse_dates_line(PATH, self._line("not-a-date,05-01-2026"))

    def test_error_carries_the_lines_own_number(self):
        try:
            parse_dates_line(PATH, self._line("garbage", 42))
            self.fail("expected DataFileError")
        except DataFileError as error:
            self.assertEqual(error.line_number, 42)


if __name__ == "__main__":
    unittest.main()
