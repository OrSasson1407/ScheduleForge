"""Parser of the institution-wide excluded dates file (optional).

Record layout, in the format of Appendix A: one or more records, each one
holding one or more date lines (a single date or a range, with an optional
comment - exactly as the excluded lines of the exam periods file are
written). Unlike the staff constraints file, no header line names anything;
every line of every record is a date line, since these dates apply to the
whole institution rather than to one instructor.
"""

from .date_lines import parse_dates_line
from .errors import DataFileError
from .record_reader import RecordFileReader


class GlobalExcludedDatesParser(object):
    """Builds the list of `ExcludedDates` that apply to every exam period."""

    def __init__(self, path):
        self.path = path

    def parse(self):
        records = RecordFileReader(self.path).read_records()
        if not records:
            raise DataFileError(
                self.path, "the global excluded dates file holds no records")
        excluded = []
        for record in records:
            excluded.extend(parse_dates_line(self.path, line) for line in record)
        return excluded


def merge_into(periods, excluded):
    """Add `excluded` to every `ExamPeriod` of `periods` (keyed by (semester, moed)).

    Must run before anything calls `ExamPeriod.available_dates()`, which
    caches its result on first use.
    """
    for period in periods.values():
        period.excluded.extend(excluded)
