"""Parser of the selected study programs file (requirements 1.1, 2.2)."""

import io
import os
import re

from ..model.study_program import StudyProgramCatalog
from .errors import DataFileError

TOKEN_SEPARATORS = re.compile(r"[,\s;]+")
PROGRAM_NUMBER_PATTERN = re.compile(r"^\d{5}$")


class ProgramsParser(object):
    """Reads the user selection, for example the single line "83101, 83102".

    The file may spread the numbers over several lines. The parser checks the
    three rules of requirement 1.1: 5 digit numbers, known programs, and at
    most `StudyProgramCatalog.MAX_SELECTED_PROGRAMS` of them.
    """

    def __init__(self, path, catalog=None):
        self.path = path
        self.catalog = catalog if catalog is not None else StudyProgramCatalog()

    def parse(self):
        """Return the selected program numbers, in the order they appear."""
        if not os.path.isfile(self.path):
            raise DataFileError(self.path, "file not found")
        try:
            with io.open(self.path, "r", encoding="utf-8-sig") as handle:
                text = handle.read()
        except UnicodeDecodeError as error:
            raise DataFileError(self.path, "file is not valid UTF-8 (%s)" % error)
        except IOError as error:
            raise DataFileError(self.path, "cannot read file (%s)" % error)

        selected = []
        for token in TOKEN_SEPARATORS.split(text.strip()):
            if not token or token == "$$$$":
                continue
            if not PROGRAM_NUMBER_PATTERN.match(token):
                raise DataFileError(
                    self.path, "'%s' is not a 5 digit study program number" % token)
            if not self.catalog.contains(token):
                raise DataFileError(
                    self.path, "study program %s does not exist" % token)
            if token not in selected:
                selected.append(token)

        if not selected:
            raise DataFileError(self.path, "no study program was selected")
        limit = StudyProgramCatalog.MAX_SELECTED_PROGRAMS
        if len(selected) > limit:
            raise DataFileError(
                self.path, "%d study programs were selected, at most %d are allowed"
                % (len(selected), limit))
        return selected
