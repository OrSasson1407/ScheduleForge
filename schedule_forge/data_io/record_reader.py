"""Reading of the record based data files described in Appendix A.

All three data files share one physical format: UTF-8 text, records separated
by a line holding four consecutive "$" signs. This module implements that
format once; the individual parsers only interpret the lines of a record.
"""

import io
import os

from .errors import DataFileError

RECORD_SEPARATOR = "$$$$"


class Line(object):
    """One meaningful line of a record, together with its number in the file."""

    def __init__(self, number, text):
        self.number = number
        self.text = text

    def __repr__(self):
        return "Line(%d, %r)" % (self.number, self.text)


class RecordFileReader(object):
    """Splits a data file into records of non-empty `Line` objects."""

    def __init__(self, path):
        self.path = path

    def read_records(self):
        """Return a list of records, each one a list of `Line`.

        Empty lines are dropped and surrounding white space is stripped, so
        that hand edited files keep working.
        """
        if not os.path.isfile(self.path):
            raise DataFileError(self.path, "file not found")
        try:
            with io.open(self.path, "r", encoding="utf-8-sig") as handle:
                raw_lines = handle.read().splitlines()
        except UnicodeDecodeError as error:
            raise DataFileError(self.path, "file is not valid UTF-8 (%s)" % error)
        except IOError as error:
            raise DataFileError(self.path, "cannot read file (%s)" % error)

        records = []
        current = []
        for index, raw in enumerate(raw_lines):
            text = raw.strip()
            if not text:
                continue
            if text == RECORD_SEPARATOR:
                if current:
                    records.append(current)
                current = []
                continue
            current.append(Line(index + 1, text))
        if current:
            records.append(current)
        return records
