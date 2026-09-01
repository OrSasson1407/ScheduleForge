"""Tests of the data file parsers (Appendix A of the requirements)."""

import io
import os
import shutil
import sys
import tempfile
import unittest
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from schedule_forge.data_io.courses_parser import CoursesParser
from schedule_forge.data_io.errors import DataFileError
from schedule_forge.data_io.exam_periods_parser import ExamPeriodsParser
from schedule_forge.data_io.programs_parser import ProgramsParser
from schedule_forge.model.enums import Evaluation, Moed, Requirement, Semester
from schedule_forge.model.study_program import StudyProgramCatalog

COURSES_FILE = """$$$$
Physics 1
83102
Prof. O. Some
83101,1,FALL,Obligatory
83108,2,SPRI,Elective
Exam
$$$$
Final Project
83103
Dr. A. Levi
83101,4,SPRI,Obligatory
Project
"""

PERIODS_FILE = """$$$$
FALL, Aleph
29-01-2026, 05-02-2026
31-01-2026 Saturday
02-02-2026, 03-02-2026 Purim
"""


class ParserTestCase(unittest.TestCase):
    """Shared helper that writes the input of a test into a temporary file."""

    def setUp(self):
        self.directory = tempfile.mkdtemp(prefix="scheduleforge_test_")

    def tearDown(self):
        shutil.rmtree(self.directory, ignore_errors=True)

    def write(self, name, text):
        path = os.path.join(self.directory, name)
        with io.open(path, "w", encoding="utf-8") as handle:
            handle.write(text)
        return path


class TestCoursesParser(ParserTestCase):

    def test_parses_every_field_of_a_record(self):
        courses = CoursesParser(self.write("courses.txt", COURSES_FILE)).parse()

        self.assertEqual(2, len(courses))
        physics = courses[0]
        self.assertEqual("83102", physics.number)
        self.assertEqual("Physics 1", physics.name)
        self.assertEqual("Prof. O. Some", physics.instructor)
        self.assertIs(Evaluation.EXAM, physics.evaluation)
        self.assertEqual(2, len(physics.enrollments))
        self.assertEqual(("83101", 1), physics.enrollments[0].slot)
        self.assertIs(Semester.FALL, physics.enrollments[0].semester)
        self.assertIs(Requirement.OBLIGATORY, physics.enrollments[0].requirement)
        self.assertIs(Requirement.ELECTIVE, physics.enrollments[1].requirement)
        self.assertIs(Evaluation.PROJECT, courses[1].evaluation)

    def test_rejects_a_course_number_that_is_not_five_digits(self):
        path = self.write("courses.txt", COURSES_FILE.replace("83102", "8310"))
        self.assertRaises(DataFileError, CoursesParser(path).parse)

    def test_rejects_an_unknown_evaluation(self):
        path = self.write("courses.txt", COURSES_FILE.replace("Exam", "Homework"))
        self.assertRaises(DataFileError, CoursesParser(path).parse)

    def test_rejects_a_year_outside_one_to_four(self):
        path = self.write("courses.txt",
                          COURSES_FILE.replace("83101,1,FALL", "83101,5,FALL"))
        self.assertRaises(DataFileError, CoursesParser(path).parse)

    def test_rejects_a_record_without_a_program_line(self):
        path = self.write("courses.txt", "$$$$\nPhysics 1\n83102\nProf. O\nExam\n")
        self.assertRaises(DataFileError, CoursesParser(path).parse)

    def test_reports_a_missing_file(self):
        path = os.path.join(self.directory, "no_such_file.txt")
        self.assertRaises(DataFileError, CoursesParser(path).parse)


class TestExamPeriodsParser(ParserTestCase):

    def test_parses_the_period_and_removes_the_excluded_dates(self):
        periods = ExamPeriodsParser(
            self.write("periods.txt", PERIODS_FILE)).parse()

        period = periods[(Semester.FALL, Moed.ALEPH)]
        self.assertEqual(date(2026, 1, 29), period.start_date)
        self.assertEqual(date(2026, 2, 5), period.end_date)
        self.assertEqual([date(2026, 1, 29), date(2026, 1, 30),
                          date(2026, 2, 1), date(2026, 2, 4),
                          date(2026, 2, 5)], period.available_dates())
        self.assertEqual("Purim", period.excluded[1].comment)

    def test_rejects_a_start_date_after_the_end_date(self):
        path = self.write("periods.txt", PERIODS_FILE.replace(
            "29-01-2026, 05-02-2026", "05-02-2026, 29-01-2026"))
        self.assertRaises(DataFileError, ExamPeriodsParser(path).parse)

    def test_rejects_a_malformed_date(self):
        path = self.write("periods.txt",
                          PERIODS_FILE.replace("31-01-2026", "31-13-2026"))
        self.assertRaises(DataFileError, ExamPeriodsParser(path).parse)

    def test_rejects_an_unknown_moed(self):
        path = self.write("periods.txt",
                          PERIODS_FILE.replace("FALL, Aleph", "FALL, Daled"))
        self.assertRaises(DataFileError, ExamPeriodsParser(path).parse)


def catalog_of(*numbers):
    """A catalogue holding exactly these program numbers, named after them.

    Mirrors `StudyProgramCatalog.from_courses`: the catalogue is always built
    from data (the loaded courses, here stood in for by a plain list), never
    from a list built into the software.
    """
    return StudyProgramCatalog((number, number) for number in numbers)


class TestProgramsParser(ParserTestCase):

    def test_reads_the_selected_programs_of_one_line(self):
        path = self.write("programs.txt", "83101, 83102, 83108\n")
        catalog = catalog_of("83101", "83102", "83108")
        self.assertEqual(["83101", "83102", "83108"],
                         ProgramsParser(path, catalog).parse())

    def test_reads_programs_spread_over_several_lines_and_drops_repetitions(self):
        path = self.write("programs.txt", "83101\n83102\n83101\n")
        catalog = catalog_of("83101", "83102")
        self.assertEqual(["83101", "83102"], ProgramsParser(path, catalog).parse())

    def test_rejects_more_than_five_programs(self):
        path = self.write("programs.txt",
                          "83101, 83102, 83104, 83107, 83108, 83109\n")
        catalog = catalog_of("83101", "83102", "83104", "83107", "83108", "83109")
        self.assertRaises(DataFileError, ProgramsParser(path, catalog).parse)

    def test_rejects_a_program_that_is_not_in_the_catalogue(self):
        path = self.write("programs.txt", "83101, 99999\n")
        catalog = catalog_of("83101")
        self.assertRaises(DataFileError, ProgramsParser(path, catalog).parse)

    def test_rejects_an_empty_selection(self):
        path = self.write("programs.txt", "\n")
        self.assertRaises(DataFileError, ProgramsParser(path).parse)


if __name__ == "__main__":
    unittest.main()
