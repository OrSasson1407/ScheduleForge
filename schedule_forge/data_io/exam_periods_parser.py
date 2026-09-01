"""Parser of the exam periods file (requirement 2.1, second data file)."""

from ..model.enums import Moed, Semester
from ..model.exam_period import ExamPeriod
from .date_lines import parse_date, parse_dates_line
from .errors import DataFileError
from .record_reader import RecordFileReader


class ExamPeriodsParser(object):
    """Builds `ExamPeriod` objects out of the exam periods data file.

    Record layout (Appendix A), one line each:
        semester, moed / start date, end date / zero or more excluded lines.
    An excluded line is either "DD-MM-YYYY comment" or
    "DD-MM-YYYY, DD-MM-YYYY comment"; the comment is optional.
    """

    def __init__(self, path):
        self.path = path

    def parse(self):
        """Return the exam periods keyed by (Semester, Moed)."""
        records = RecordFileReader(self.path).read_records()
        if not records:
            raise DataFileError(self.path, "the exam periods file holds no records")
        periods = {}
        for record in records:
            period = self._parse_record(record)
            if period.key in periods:
                raise DataFileError(
                    self.path, "exam period %s %s is defined twice"
                    % (period.semester.value, period.moed.value), record[0].number)
            periods[period.key] = period
        return periods

    def _parse_record(self, record):
        if len(record) < 2:
            raise DataFileError(
                self.path,
                "an exam period record needs at least 2 lines "
                "(semester and moed, then the dates) but holds %d" % len(record),
                record[0].number)

        semester, moed = self._parse_period_header(record[0])
        start_date, end_date = self._parse_period_dates(record[1])
        excluded = [parse_dates_line(self.path, line) for line in record[2:]]
        return ExamPeriod(semester, moed, start_date, end_date, excluded)

    def _parse_period_header(self, line):
        fields = [field.strip() for field in line.text.split(",")]
        if len(fields) != 2:
            raise DataFileError(
                self.path,
                "the first line of an exam period must be 'Semester, Moed' "
                "but is '%s'" % line.text, line.number)
        try:
            return Semester.parse(fields[0]), Moed.parse(fields[1])
        except ValueError as error:
            raise DataFileError(self.path, str(error), line.number)

    def _parse_period_dates(self, line):
        fields = [field.strip() for field in line.text.split(",")]
        if len(fields) != 2:
            raise DataFileError(
                self.path,
                "the dates line must be 'start date, end date' but is '%s'"
                % line.text, line.number)
        start_date = self._parse_date(fields[0], line)
        end_date = self._parse_date(fields[1], line)
        if start_date >= end_date:
            raise DataFileError(
                self.path, "the start date %s is not before the end date %s"
                % (fields[0], fields[1]), line.number)
        return start_date, end_date

    def _parse_date(self, text, line):
        return parse_date(self.path, text, line.number)
