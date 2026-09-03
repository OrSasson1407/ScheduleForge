"""Tests of schedule_forge.data_io.enrollment_parser.EnrollmentParser and the
model.enrollment.EnrollmentRoster it builds."""

import io
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from schedule_forge.data_io.enrollment_parser import EnrollmentParser
from schedule_forge.data_io.errors import DataFileError
from schedule_forge.model.enrollment import EnrollmentRoster


class ParserTestCase(unittest.TestCase):

    def setUp(self):
        self.directory = tempfile.mkdtemp(prefix="scheduleforge_test_")

    def tearDown(self):
        shutil.rmtree(self.directory, ignore_errors=True)

    def write(self, text):
        path = os.path.join(self.directory, "enrollment.csv")
        with io.open(path, "w", encoding="utf-8") as handle:
            handle.write(text)
        return path


class TestEnrollmentParser(ParserTestCase):

    def test_parses_rows_with_no_header(self):
        roster = EnrollmentParser(self.write(
            "2021001,83112\n2021001,83113\n2021002,83112\n")).parse()

        self.assertEqual({"2021001", "2021002"}, roster.students_of("83112"))
        self.assertEqual({"2021001"}, roster.students_of("83113"))

    def test_skips_an_optional_header_row(self):
        roster = EnrollmentParser(self.write(
            "StudentID,CourseNumber\n2021001,83112\n")).parse()

        self.assertEqual({"2021001"}, roster.students_of("83112"))

    def test_header_detection_is_case_insensitive(self):
        roster = EnrollmentParser(self.write(
            "studentid,coursenumber\n2021001,83112\n")).parse()

        self.assertEqual({"2021001"}, roster.students_of("83112"))

    def test_a_course_with_no_enrollment_rows_has_an_empty_set(self):
        roster = EnrollmentParser(self.write("2021001,83112\n")).parse()

        self.assertEqual(frozenset(), roster.students_of("99999"))

    def test_ignores_blank_lines(self):
        roster = EnrollmentParser(self.write(
            "2021001,83112\n\n\n2021002,83113\n")).parse()

        self.assertEqual({"2021001"}, roster.students_of("83112"))
        self.assertEqual({"2021002"}, roster.students_of("83113"))

    def test_the_same_student_course_pair_twice_counts_once(self):
        roster = EnrollmentParser(self.write(
            "2021001,83112\n2021001,83112\n")).parse()

        self.assertEqual({"2021001"}, roster.students_of("83112"))

    def test_rejects_an_empty_file(self):
        path = self.write("")
        self.assertRaises(DataFileError, EnrollmentParser(path).parse)

    def test_rejects_a_row_with_only_one_column(self):
        path = self.write("2021001\n")
        self.assertRaises(DataFileError, EnrollmentParser(path).parse)

    def test_rejects_a_row_with_a_blank_student_id(self):
        path = self.write(",83112\n")
        self.assertRaises(DataFileError, EnrollmentParser(path).parse)

    def test_reports_a_missing_file(self):
        path = os.path.join(self.directory, "no_such_file.csv")
        self.assertRaises(DataFileError, EnrollmentParser(path).parse)


class TestEnrollmentRoster(unittest.TestCase):

    def test_shares_students_is_true_when_a_real_student_takes_both(self):
        roster = EnrollmentRoster({"83112": {"a", "b"}, "83113": {"b", "c"}})
        self.assertTrue(roster.shares_students("83112", "83113"))

    def test_shares_students_is_false_with_no_overlap(self):
        roster = EnrollmentRoster({"83112": {"a"}, "83113": {"b"}})
        self.assertFalse(roster.shares_students("83112", "83113"))

    def test_shares_students_is_false_when_a_course_has_no_roster_at_all(self):
        roster = EnrollmentRoster({"83112": {"a"}})
        self.assertFalse(roster.shares_students("83112", "99999"))

    def test_shares_students_of_a_course_with_itself_is_true_when_it_has_students(self):
        roster = EnrollmentRoster({"83112": {"a"}})
        self.assertTrue(roster.shares_students("83112", "83112"))

    def test_shares_students_of_an_unknown_course_with_itself_is_false(self):
        roster = EnrollmentRoster({})
        self.assertFalse(roster.shares_students("83112", "83112"))

    def test_len_is_the_number_of_courses_with_a_roster(self):
        roster = EnrollmentRoster({"83112": {"a"}, "83113": {"b"}})
        self.assertEqual(2, len(roster))


if __name__ == "__main__":
    unittest.main()
