"""Parser of the courses file (requirement 2.1, first data file)."""

import re

from ..model.course import Course, ProgramEnrollment
from ..model.enums import Evaluation, Requirement, Semester
from .errors import DataFileError
from .record_reader import RecordFileReader

COURSE_NUMBER_PATTERN = re.compile(r"^\d{5}$")
PROGRAM_NUMBER_PATTERN = re.compile(r"^\d{5}$")
LEGAL_YEARS = (1, 2, 3, 4)


class CoursesParser(object):
    """Builds `Course` objects out of the courses data file.

    Record layout (Appendix A), one line each:
        course name / course number / instructor name /
        one or more program lines / evaluation / number of students (optional)

    The last line is the addition of version 3.0: the number of students the
    exam has to seat, used by the room allocation module. A record that does
    not hold it falls back to the default of the settings.
    """

    def __init__(self, path):
        self.path = path

    def parse(self):
        """Return the list of courses held in the file."""
        records = RecordFileReader(self.path).read_records()
        if not records:
            raise DataFileError(self.path, "the courses file holds no records")
        courses = []
        seen_numbers = set()
        for record in records:
            course = self._parse_record(record)
            if course.number in seen_numbers:
                raise DataFileError(self.path, "course %s appears twice"
                                    % course.number, record[1].number)
            seen_numbers.add(course.number)
            courses.append(course)
        return courses

    def _parse_record(self, record):
        if len(record) < 5:
            raise DataFileError(
                self.path,
                "a course record needs at least 5 lines (name, number, "
                "instructor, one program, evaluation) but holds %d" % len(record),
                record[0].number)

        students = None
        if record[-1].text.isdigit():
            students = int(record[-1].text)
            if students < 1:
                raise DataFileError(self.path, "the number of students is not a "
                                    "positive number", record[-1].number)
            record = record[:-1]
            if len(record) < 5:
                raise DataFileError(
                    self.path,
                    "a course record needs a name, a number, an instructor, at "
                    "least one program and an evaluation before the number of "
                    "students", record[0].number)

        name = record[0].text
        number_line = record[1]
        if not COURSE_NUMBER_PATTERN.match(number_line.text):
            raise DataFileError(self.path, "course number '%s' is not 5 digits"
                                % number_line.text, number_line.number)
        instructor = record[2].text

        evaluation_line = record[-1]
        evaluation = self._parse_enum(Evaluation, evaluation_line)

        enrollments = [self._parse_enrollment(line) for line in record[3:-1]]
        self._reject_duplicate_programs(enrollments, record[3])
        return Course(number_line.text, name, instructor, enrollments, evaluation,
                      students)

    def _parse_enrollment(self, line):
        fields = [field.strip() for field in line.text.split(",")]
        if len(fields) != 4:
            raise DataFileError(
                self.path,
                "a program line must hold 4 comma separated fields "
                "(program, year, semester, requirement) but holds %d: '%s'"
                % (len(fields), line.text), line.number)
        program_number, year_text, semester_text, requirement_text = fields

        if not PROGRAM_NUMBER_PATTERN.match(program_number):
            raise DataFileError(self.path, "program number '%s' is not 5 digits"
                                % program_number, line.number)
        try:
            year = int(year_text)
        except ValueError:
            raise DataFileError(self.path, "year '%s' is not a number"
                                % year_text, line.number)
        if year not in LEGAL_YEARS:
            raise DataFileError(self.path, "year %d is not in {1, 2, 3, 4}" % year,
                                line.number)
        semester = self._parse_enum(Semester, line, semester_text)
        requirement = self._parse_enum(Requirement, line, requirement_text)
        return ProgramEnrollment(program_number, year, semester, requirement)

    def _reject_duplicate_programs(self, enrollments, line):
        numbers = [enrollment.program_number for enrollment in enrollments]
        for number in numbers:
            if numbers.count(number) > 1:
                raise DataFileError(
                    self.path,
                    "the course is listed twice in program %s" % number,
                    line.number)

    def _parse_enum(self, enum_class, line, text=None):
        try:
            return enum_class.parse(line.text if text is None else text)
        except ValueError as error:
            raise DataFileError(self.path, str(error), line.number)
