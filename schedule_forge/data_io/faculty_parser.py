"""Parser of the staff constraints file (version 3.0).

Record layout, in the format of Appendix A:
    instructor name / one or more lines of dates that instructor is not
    available on - a single date or a range, with an optional comment, exactly
    as the excluded lines of the exam periods file are written.
"""

from ..model.availability import FacultyAvailability
from .date_lines import parse_dates_line
from .errors import DataFileError
from .record_reader import RecordFileReader


class FacultyConstraintsParser(object):
    """Builds a `FacultyAvailability` out of the staff constraints file."""

    def __init__(self, path):
        self.path = path

    def parse(self):
        records = RecordFileReader(self.path).read_records()
        if not records:
            raise DataFileError(self.path,
                                "the staff constraints file holds no records")
        blocked = {}
        for record in records:
            if len(record) < 2:
                raise DataFileError(
                    self.path,
                    "a staff constraint record needs the name of the instructor "
                    "and at least one date, but holds %d line(s)" % len(record),
                    record[0].number)
            instructor = record[0].text
            rules = [parse_dates_line(self.path, line) for line in record[1:]]
            blocked.setdefault(instructor, []).extend(rules)
        return FacultyAvailability(blocked)
