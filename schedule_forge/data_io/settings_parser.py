"""Parser of the settings file (requirement sections 2 and 3 of version 3.0).

The file is the file based answer to the settings screen: one `name = value` per
line, `#` starts a comment, and a name that is not written keeps its default,
which for a threshold means that the threshold is off.

    # threshold requirements
    min_days_between_obligatory = 2
    max_exams_per_day = 6
    require_rooms = yes

    # sorting, most important criterion first
    sort = min_days_between_obligatory, max_exams_per_day
"""

import io
import os

from ..settings import SchedulingSettings, SettingsError
from .errors import DataFileError

_WHOLE_NUMBERS = ("min_days_between_obligatory", "min_days_between_any",
                  "max_elective_collisions", "min_obligatory_span",
                  "max_exams_per_day", "min_gap_between_moeds",
                  "max_exams_per_window", "window_days", "max_candidates",
                  "max_examined", "default_students")
_DECIMALS = ("time_limit_seconds",)
_FLAGS = ("require_rooms",)
_TRUE = ("yes", "true", "on", "1")
_FALSE = ("no", "false", "off", "0")


class SettingsParser(object):
    """Reads a settings file into a `SchedulingSettings`."""

    def __init__(self, path):
        self.path = path

    def parse(self):
        if not os.path.isfile(self.path):
            raise DataFileError(self.path, "file not found")
        try:
            with io.open(self.path, "r", encoding="utf-8-sig") as handle:
                lines = handle.read().splitlines()
        except UnicodeDecodeError as error:
            raise DataFileError(self.path, "file is not valid UTF-8 (%s)" % error)
        except IOError as error:
            raise DataFileError(self.path, "cannot read file (%s)" % error)

        values = {}
        for index, raw in enumerate(lines):
            text = raw.split("#", 1)[0].strip()
            if not text:
                continue
            if "=" not in text:
                raise DataFileError(
                    self.path, "'%s' is not a 'name = value' line" % text,
                    index + 1)
            name, value = (part.strip() for part in text.split("=", 1))
            values[name.lower()] = (value, index + 1)

        arguments = {}
        for name, (value, line) in values.items():
            # "sort" is what the file calls the list of criteria of section 3.
            key = "sort_criteria" if name == "sort" else name
            arguments[key] = self._convert(name, value, line)

        try:
            return SchedulingSettings(**arguments)
        except SettingsError as error:
            raise DataFileError(self.path, str(error))
        except TypeError:
            unknown = sorted(set(arguments) - set(SchedulingSettings.__slots__))
            raise DataFileError(
                self.path, "unknown setting(s): %s" % ", ".join(unknown))

    def _convert(self, name, value, line):
        if name == "sort":
            return [item.strip() for item in value.split(",") if item.strip()]
        if name == "time_slots":
            return [item.strip() for item in value.split(",") if item.strip()]
        if name in _FLAGS:
            if value.lower() in _TRUE:
                return True
            if value.lower() in _FALSE:
                return False
            raise DataFileError(
                self.path, "'%s' is not yes or no" % value, line)
        if name in _WHOLE_NUMBERS:
            try:
                return int(value)
            except ValueError:
                raise DataFileError(
                    self.path, "'%s' is not a whole number" % value, line)
        if name in _DECIMALS:
            try:
                return float(value)
            except ValueError:
                raise DataFileError(self.path, "'%s' is not a number" % value, line)
        raise DataFileError(self.path, "unknown setting '%s'" % name, line)
