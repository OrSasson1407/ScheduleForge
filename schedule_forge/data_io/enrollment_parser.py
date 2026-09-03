"""Parser of the (optional) real enrollment file.

Every other data file of this engine speaks of courses only in aggregate -
a (program, year) it is taught in, a headcount for room seating. This one is
genuinely tabular per-student data (one row per enrollment fact), so - unlike
the hand-typed Appendix A record files the rest of `data_io` reads - the
standard library's `csv` module is the right tool here.

    StudentID,CourseNumber
    2021001,83112
    2021001,83113
    2021002,83112

A header naming the two columns is optional and is skipped when present.
"""

import csv
import io
import os

from ..model.enrollment import EnrollmentRoster
from .errors import DataFileError

_HEADER_NAMES = {"studentid", "student_id", "student", "student id"}


class EnrollmentParser(object):
    """Builds an `EnrollmentRoster` out of the enrollment CSV file."""

    def __init__(self, path):
        self.path = path

    def parse(self):
        if not os.path.isfile(self.path):
            raise DataFileError(self.path, "file not found")
        try:
            with io.open(self.path, "r", encoding="utf-8-sig", newline="") as handle:
                rows = list(csv.reader(handle))
        except UnicodeDecodeError as error:
            raise DataFileError(self.path, "file is not valid UTF-8 (%s)" % error)
        except IOError as error:
            raise DataFileError(self.path, "cannot read file (%s)" % error)

        rows = [row for row in rows if any(field.strip() for field in row)]
        if not rows:
            raise DataFileError(self.path, "the enrollment file holds no rows")

        start = 1 if rows[0][0].strip().lower() in _HEADER_NAMES else 0
        students_of = {}
        for line_number, row in enumerate(rows[start:], start=start + 1):
            if len(row) < 2 or not row[0].strip() or not row[1].strip():
                raise DataFileError(
                    self.path,
                    "an enrollment row needs a student id and a course number, "
                    "but is '%s'" % ",".join(row), line_number)
            student, course = row[0].strip(), row[1].strip()
            students_of.setdefault(course, set()).add(student)
        return EnrollmentRoster(students_of)
