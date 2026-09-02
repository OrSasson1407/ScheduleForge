"""Tests of schedule_forge.data_io.record_reader: the shared $$$$-record format."""

import io
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from schedule_forge.data_io.errors import DataFileError
from schedule_forge.data_io.record_reader import Line, RecordFileReader


class RecordReaderTestCase(unittest.TestCase):

    def setUp(self):
        self.directory = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.directory, ignore_errors=True)

    def write(self, text, name="data.txt"):
        path = os.path.join(self.directory, name)
        with io.open(path, "w", encoding="utf-8") as handle:
            handle.write(text)
        return path

    def read(self, text, name="data.txt"):
        return RecordFileReader(self.write(text, name)).read_records()


class TestLine(unittest.TestCase):

    def test_stores_the_number_and_text(self):
        line = Line(3, "hello")
        self.assertEqual(line.number, 3)
        self.assertEqual(line.text, "hello")

    def test_repr_includes_number_and_text(self):
        self.assertEqual(repr(Line(3, "hi")), "Line(3, 'hi')")


class TestReadRecords(RecordReaderTestCase):

    def test_reads_a_single_record(self):
        records = self.read("Name\nValue")
        self.assertEqual(len(records), 1)
        self.assertEqual([line.text for line in records[0]], ["Name", "Value"])

    def test_splits_two_records_on_the_separator(self):
        records = self.read("A\n$$$$\nB")
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0][0].text, "A")
        self.assertEqual(records[1][0].text, "B")

    def test_ignores_blank_lines_within_a_record(self):
        records = self.read("A\n\nB\n")
        self.assertEqual([line.text for line in records[0]], ["A", "B"])

    def test_ignores_blank_lines_between_records(self):
        records = self.read("A\n\n$$$$\n\nB")
        self.assertEqual(len(records), 2)

    def test_strips_surrounding_whitespace_from_each_line(self):
        records = self.read("  Name  \n  Value  ")
        self.assertEqual([line.text for line in records[0]], ["Name", "Value"])

    def test_a_trailing_separator_does_not_create_an_empty_record(self):
        records = self.read("A\n$$$$\n")
        self.assertEqual(len(records), 1)

    def test_a_leading_separator_does_not_create_an_empty_record(self):
        records = self.read("$$$$\nA")
        self.assertEqual(len(records), 1)

    def test_consecutive_separators_do_not_create_an_empty_record(self):
        records = self.read("A\n$$$$\n$$$$\nB")
        self.assertEqual(len(records), 2)

    def test_returns_an_empty_list_for_an_empty_file(self):
        self.assertEqual(self.read(""), [])

    def test_returns_an_empty_list_for_a_file_of_only_blank_lines(self):
        self.assertEqual(self.read("\n\n\n"), [])

    def test_line_numbers_are_1_based_and_count_every_physical_line(self):
        records = self.read("A\nB\n\nC")
        numbers = [line.number for line in records[0]]
        self.assertEqual(numbers, [1, 2, 4])

    def test_line_numbers_continue_across_a_separator(self):
        records = self.read("A\n$$$$\nB")
        self.assertEqual(records[1][0].number, 3)

    def test_reads_utf8_text_correctly(self):
        records = self.read(u"שלום")
        self.assertEqual(records[0][0].text, u"שלום")

    def test_strips_a_utf8_byte_order_mark(self):
        path = os.path.join(self.directory, "bom.txt")
        with io.open(path, "w", encoding="utf-8-sig") as handle:
            handle.write("Name")
        records = RecordFileReader(path).read_records()
        self.assertEqual(records[0][0].text, "Name")

    def test_raises_when_the_file_does_not_exist(self):
        missing = os.path.join(self.directory, "does-not-exist.txt")
        with self.assertRaises(DataFileError):
            RecordFileReader(missing).read_records()

    def test_error_names_the_missing_path(self):
        missing = os.path.join(self.directory, "does-not-exist.txt")
        try:
            RecordFileReader(missing).read_records()
            self.fail("expected DataFileError")
        except DataFileError as error:
            self.assertEqual(error.path, missing)

    def test_raises_when_the_path_is_a_directory(self):
        with self.assertRaises(DataFileError):
            RecordFileReader(self.directory).read_records()

    def test_windows_line_endings_are_handled_like_unix_ones(self):
        records = self.read("A\r\nB\r\n$$$$\r\nC\r\n")
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0][0].text, "A")


if __name__ == "__main__":
    unittest.main()
