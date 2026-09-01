"""The date lines shared by the data files.

A line that names dates is written the same way in the exam periods file and in
the staff constraints file: one DD-MM-YYYY date, or two of them separated by a
comma, followed by an optional comment.
"""

import re
from datetime import datetime

from ..model.exam_period import ExcludedDates
from .errors import DataFileError

DATE_FORMAT = "%d-%m-%Y"
DATE_PATTERN = re.compile(r"^\d{2}-\d{2}-\d{4}")


def parse_date(path, text, line_number):
    """One DD-MM-YYYY date, or a `DataFileError` naming the file and the line."""
    try:
        return datetime.strptime(text.strip(), DATE_FORMAT).date()
    except ValueError:
        raise DataFileError(
            path, "'%s' is not a legal DD-MM-YYYY date" % text.strip(),
            line_number)


def split_date_and_comment(path, text, line_number):
    match = DATE_PATTERN.match(text)
    if match is None:
        raise DataFileError(
            path, "'%s' does not start with a DD-MM-YYYY date" % text,
            line_number)
    date = parse_date(path, match.group(0), line_number)
    return date, text[match.end():].strip()


def parse_dates_line(path, line):
    """A single date or a range of dates, as an `ExcludedDates`."""
    fields = [field.strip() for field in line.text.split(",")]
    if len(fields) == 1:
        date, comment = split_date_and_comment(path, fields[0], line.number)
        return ExcludedDates(date, date, comment)
    if len(fields) == 2:
        start, _ = split_date_and_comment(path, fields[0], line.number)
        end, comment = split_date_and_comment(path, fields[1], line.number)
        if start > end:
            raise DataFileError(
                path, "the range starts after it ends: '%s'" % line.text,
                line.number)
        return ExcludedDates(start, end, comment)
    raise DataFileError(
        path,
        "a dates line holds one date or two comma separated dates, optionally "
        "followed by a comment, but is '%s'" % line.text, line.number)
