"""More tests of the data file parsers - edge cases test_parsers.py does not
reach: duplicate detection, the optional student-count line, room locations,
the staff constraints file, and the programs-selection file's token rules."""

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
from schedule_forge.data_io.faculty_parser import FacultyConstraintsParser
from schedule_forge.data_io.programs_parser import ProgramsParser
from schedule_forge.data_io.rooms_parser import RoomsParser
from schedule_forge.model.enums import Moed, Semester
from schedule_forge.model.study_program import StudyProgramCatalog


class ParserTestCase(unittest.TestCase):

    def setUp(self):
        self.directory = tempfile.mkdtemp(prefix="scheduleforge_test_")

    def tearDown(self):
        shutil.rmtree(self.directory, ignore_errors=True)

    def write(self, name, text):
        path = os.path.join(self.directory, name)
        with io.open(path, "w", encoding="utf-8") as handle:
            handle.write(text)
        return path


def course_record(name="Intro", number="83101", instructor="Dr. A",
                  programs=("83101,1,FALL,Obligatory",), evaluation="Exam",
                  students=None):
    lines = [name, number, instructor] + list(programs) + [evaluation]
    if students is not None:
        lines.append(str(students))
    return "\n".join(lines)


class TestCoursesParserMore(ParserTestCase):

    def parse(self, text):
        path = self.write("courses.txt", text)
        return CoursesParser(path).parse()

    def test_parses_an_optional_trailing_student_count(self):
        courses = self.parse(course_record(students=45))
        self.assertEqual(courses[0].students, 45)

    def test_students_is_none_when_the_line_is_absent(self):
        courses = self.parse(course_record())
        self.assertIsNone(courses[0].students)

    def test_rejects_a_student_count_of_zero(self):
        with self.assertRaises(DataFileError):
            self.parse(course_record(students=0))

    def test_a_course_record_too_short_once_students_is_removed_is_rejected(self):
        # "Name / 83101 / Instructor / Evaluation / 45" - only 4 lines remain
        # once the trailing digit line is understood as a student count, one
        # short of the 5 a record needs (it has no program line at all).
        text = "Name\n83101\nDr. A\nExam\n45"
        with self.assertRaises(DataFileError):
            self.parse(text)

    def test_rejects_two_courses_with_the_same_number(self):
        text = course_record(number="83101") + "\n$$$$\n" + course_record(number="83101")
        with self.assertRaises(DataFileError):
            self.parse(text)

    def test_allows_two_courses_with_different_numbers(self):
        text = course_record(number="83101") + "\n$$$$\n" + course_record(number="83102")
        courses = self.parse(text)
        self.assertEqual(2, len(courses))

    def test_a_course_may_enroll_in_several_programs(self):
        text = course_record(programs=("83101,1,FALL,Obligatory", "83102,2,SPRI,Elective"))
        courses = self.parse(text)
        self.assertEqual(2, len(courses[0].enrollments))

    def test_rejects_the_same_program_listed_twice_even_with_different_years(self):
        text = course_record(programs=("83101,1,FALL,Obligatory", "83101,2,SPRI,Elective"))
        with self.assertRaises(DataFileError):
            self.parse(text)

    def test_allows_the_same_program_with_different_semesters_as_long_as_not_duplicated(self):
        # Sanity check that the duplicate rule keys on the program number
        # alone, not (program, semester): two different programs is fine.
        text = course_record(programs=("83101,1,FALL,Obligatory", "83102,1,FALL,Obligatory"))
        courses = self.parse(text)
        self.assertEqual(2, len(courses[0].enrollments))

    def test_rejects_an_enrollment_line_with_the_wrong_field_count(self):
        text = course_record(programs=("83101,1,FALL",))
        with self.assertRaises(DataFileError):
            self.parse(text)

    def test_rejects_a_non_numeric_year(self):
        text = course_record(programs=("83101,many,FALL,Obligatory",))
        with self.assertRaises(DataFileError):
            self.parse(text)

    def test_rejects_year_zero(self):
        text = course_record(programs=("83101,0,FALL,Obligatory",))
        with self.assertRaises(DataFileError):
            self.parse(text)

    def test_rejects_year_five(self):
        text = course_record(programs=("83101,5,FALL,Obligatory",))
        with self.assertRaises(DataFileError):
            self.parse(text)

    def test_accepts_every_legal_year(self):
        for year in (1, 2, 3, 4):
            text = course_record(programs=("83101,%d,FALL,Obligatory" % year,))
            courses = self.parse(text)
            self.assertEqual(year, courses[0].enrollments[0].year)

    def test_ignores_blank_lines_inside_a_record(self):
        text = "Intro\n83101\nDr. A\n\n83101,1,FALL,Obligatory\n\nExam"
        courses = self.parse(text)
        self.assertEqual(1, len(courses))

    def test_error_names_the_file_path(self):
        path = self.write("courses.txt", course_record(number="831"))
        try:
            CoursesParser(path).parse()
            self.fail("expected DataFileError")
        except DataFileError as error:
            self.assertEqual(error.path, path)


class TestRoomsParserMore(ParserTestCase):

    def parse(self, text):
        path = self.write("rooms.txt", text)
        return RoomsParser(path).parse()

    def test_parses_name_and_capacity_with_no_location(self):
        rooms = self.parse("Hall A\n100")
        self.assertEqual(rooms[0].name, "Hall A")
        self.assertEqual(rooms[0].capacity, 100)
        self.assertEqual(rooms[0].location, "")

    def test_parses_an_optional_location(self):
        rooms = self.parse("Hall A\n100\nBuilding 3, Floor 2")
        self.assertEqual(rooms[0].location, "Building 3, Floor 2")

    def test_parses_several_rooms(self):
        rooms = self.parse("A\n10\n$$$$\nB\n20")
        self.assertEqual([r.name for r in rooms], ["A", "B"])

    def test_rejects_a_record_with_only_a_name(self):
        with self.assertRaises(DataFileError):
            self.parse("Hall A")

    def test_rejects_a_non_numeric_capacity(self):
        with self.assertRaises(DataFileError):
            self.parse("Hall A\nmany")

    def test_rejects_a_capacity_of_zero(self):
        with self.assertRaises(DataFileError):
            self.parse("Hall A\n0")

    def test_rejects_a_negative_capacity(self):
        with self.assertRaises(DataFileError):
            self.parse("Hall A\n-5")

    def test_rejects_a_repeated_room_name(self):
        with self.assertRaises(DataFileError):
            self.parse("Hall A\n10\n$$$$\nHall A\n20")

    def test_rejects_an_empty_file(self):
        with self.assertRaises(DataFileError):
            self.parse("")


class TestFacultyConstraintsParserMore(ParserTestCase):

    def parse(self, text):
        path = self.write("faculty.txt", text)
        return FacultyConstraintsParser(path).parse()

    def test_parses_a_single_excluded_date(self):
        availability = self.parse("Dr. A\n01-01-2026")
        self.assertFalse(availability.is_available("Dr. A", date(2026, 1, 1)))

    def test_parses_an_excluded_range(self):
        availability = self.parse("Dr. A\n01-01-2026,05-01-2026")
        self.assertFalse(availability.is_available("Dr. A", date(2026, 1, 3)))
        self.assertTrue(availability.is_available("Dr. A", date(2026, 1, 6)))

    def test_parses_several_dates_for_one_instructor_on_separate_lines(self):
        availability = self.parse("Dr. A\n01-01-2026\n10-01-2026")
        self.assertEqual(2, len(availability.rules_of("Dr. A")))

    def test_merges_rules_for_the_same_instructor_across_records(self):
        availability = self.parse("Dr. A\n01-01-2026\n$$$$\nDr. A\n10-01-2026")
        self.assertEqual(2, len(availability.rules_of("Dr. A")))

    def test_keeps_different_instructors_separate(self):
        availability = self.parse("Dr. A\n01-01-2026\n$$$$\nDr. B\n02-01-2026")
        self.assertEqual(sorted(availability.instructors()), ["Dr. A", "Dr. B"])

    def test_rejects_a_record_with_only_an_instructor_name(self):
        with self.assertRaises(DataFileError):
            self.parse("Dr. A")

    def test_rejects_an_empty_file(self):
        with self.assertRaises(DataFileError):
            self.parse("")

    def test_rejects_an_invalid_date_line(self):
        with self.assertRaises(DataFileError):
            self.parse("Dr. A\nnot a date")

    def test_rejects_a_backwards_range(self):
        with self.assertRaises(DataFileError):
            self.parse("Dr. A\n10-01-2026,01-01-2026")

    def test_a_comment_is_kept_on_the_rule(self):
        availability = self.parse("Dr. A\n01-01-2026 conference")
        self.assertEqual(availability.rules_of("Dr. A")[0].comment, "conference")

    def test_an_instructor_with_no_rules_is_always_available(self):
        availability = self.parse("Dr. A\n01-01-2026")
        self.assertTrue(availability.is_available("Dr. B", date(2026, 1, 1)))


class TestExamPeriodsParserMore(ParserTestCase):

    def parse(self, text):
        path = self.write("periods.txt", text)
        return ExamPeriodsParser(path).parse()

    def test_periods_are_keyed_by_semester_and_moed(self):
        periods = self.parse("FALL, ALEPH\n01-01-2026, 05-01-2026")
        self.assertIn((Semester.FALL, Moed.ALEPH), periods)

    def test_rejects_the_same_semester_and_moed_defined_twice(self):
        text = "FALL, ALEPH\n01-01-2026, 05-01-2026\n$$$$\nFALL, ALEPH\n10-01-2026, 15-01-2026"
        with self.assertRaises(DataFileError):
            self.parse(text)

    def test_allows_the_same_semester_with_a_different_moed(self):
        text = "FALL, ALEPH\n01-01-2026, 05-01-2026\n$$$$\nFALL, BET\n10-01-2026, 15-01-2026"
        periods = self.parse(text)
        self.assertEqual(2, len(periods))

    def test_rejects_a_header_that_is_not_two_fields(self):
        with self.assertRaises(DataFileError):
            self.parse("FALL\n01-01-2026, 05-01-2026")

    def test_rejects_an_unknown_semester_in_the_header(self):
        with self.assertRaises(DataFileError):
            self.parse("WINTER, ALEPH\n01-01-2026, 05-01-2026")

    def test_rejects_a_dates_line_that_is_not_two_fields(self):
        with self.assertRaises(DataFileError):
            self.parse("FALL, ALEPH\n01-01-2026")

    def test_rejects_equal_start_and_end_dates(self):
        with self.assertRaises(DataFileError):
            self.parse("FALL, ALEPH\n01-01-2026, 01-01-2026")

    def test_parses_multiple_excluded_lines(self):
        text = "FALL, ALEPH\n01-01-2026, 31-01-2026\n05-01-2026\n10-01-2026,12-01-2026"
        periods = self.parse(text)
        period = periods[(Semester.FALL, Moed.ALEPH)]
        self.assertEqual(2, len(period.excluded))

    def test_a_period_with_no_excluded_lines_has_an_empty_list(self):
        periods = self.parse("FALL, ALEPH\n01-01-2026, 05-01-2026")
        self.assertEqual([], periods[(Semester.FALL, Moed.ALEPH)].excluded)

    def test_rejects_an_empty_file(self):
        with self.assertRaises(DataFileError):
            self.parse("")


class TestProgramsParserMore(ParserTestCase):

    def _catalog(self, *numbers):
        return StudyProgramCatalog((number, number) for number in numbers)

    def parse(self, text, catalog=None):
        path = self.write("programs.txt", text)
        return ProgramsParser(path, catalog).parse()

    def test_parses_a_single_program(self):
        selected = self.parse("83101", self._catalog("83101"))
        self.assertEqual(["83101"], selected)

    def test_parses_several_comma_separated_programs(self):
        selected = self.parse("83101, 83102", self._catalog("83101", "83102"))
        self.assertEqual(["83101", "83102"], selected)

    def test_parses_programs_separated_by_whitespace(self):
        selected = self.parse("83101 83102", self._catalog("83101", "83102"))
        self.assertEqual(["83101", "83102"], selected)

    def test_parses_programs_spread_over_several_lines(self):
        selected = self.parse("83101\n83102", self._catalog("83101", "83102"))
        self.assertEqual(["83101", "83102"], selected)

    def test_preserves_the_order_of_first_appearance(self):
        selected = self.parse("83102, 83101", self._catalog("83101", "83102"))
        self.assertEqual(["83102", "83101"], selected)

    def test_drops_a_repeated_program_number(self):
        selected = self.parse("83101, 83101", self._catalog("83101"))
        self.assertEqual(["83101"], selected)

    def test_ignores_a_stray_record_separator(self):
        selected = self.parse("83101\n$$$$\n83102", self._catalog("83101", "83102"))
        self.assertEqual(["83101", "83102"], selected)

    def test_rejects_a_program_number_that_is_not_5_digits(self):
        with self.assertRaises(DataFileError):
            self.parse("831", self._catalog("83101"))

    def test_rejects_a_program_not_in_the_catalog(self):
        with self.assertRaises(DataFileError):
            self.parse("83109", self._catalog("83101"))

    def test_rejects_an_empty_file(self):
        with self.assertRaises(DataFileError):
            self.parse("", self._catalog("83101"))

    def test_rejects_more_than_five_programs(self):
        numbers = ["8310%d" % i for i in range(1, 7)]
        with self.assertRaises(DataFileError):
            self.parse(", ".join(numbers), self._catalog(*numbers))

    def test_accepts_exactly_five_programs(self):
        numbers = ["8310%d" % i for i in range(1, 6)]
        selected = self.parse(", ".join(numbers), self._catalog(*numbers))
        self.assertEqual(5, len(selected))

    def test_raises_when_the_file_does_not_exist(self):
        missing = os.path.join(self.directory, "missing.txt")
        with self.assertRaises(DataFileError):
            ProgramsParser(missing, self._catalog("83101")).parse()

    def test_uses_an_empty_catalog_by_default(self):
        with self.assertRaises(DataFileError):
            self.parse("83101")  # no catalog given -> nothing is known


if __name__ == "__main__":
    unittest.main()
