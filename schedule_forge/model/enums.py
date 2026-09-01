"""Enumerated value sets defined by Appendix A of the requirements document."""

from enum import Enum


class ParsableEnum(Enum):
    """Base class for the enums that are read from the textual data files."""

    @classmethod
    def aliases(cls):
        """Extra spellings accepted on input, mapped to the canonical token."""
        return {}

    @classmethod
    def parse(cls, text):
        """Return the member whose value (or alias) matches `text`.

        Raises ValueError with a readable message when the token is unknown, so
        that the parsers can report the offending file and line.
        """
        token = text.strip().upper()
        token = cls.aliases().get(token, token)
        for member in cls:
            if member.value == token:
                return member
        legal = ", ".join(member.value for member in cls)
        raise ValueError("'%s' is not a legal %s (expected one of: %s)"
                         % (text.strip(), cls.__name__, legal))


class Semester(ParsableEnum):
    """Semester in which a course is taught / an exam period takes place."""

    FALL = "FALL"
    SPRING = "SPRI"
    SUMMER = "SUMM"

    @classmethod
    def aliases(cls):
        return {"SPRING": "SPRI", "SUMMER": "SUMM"}

    @property
    def display_name(self):
        return {"FALL": "FALL", "SPRI": "SPRING", "SUMM": "SUMMER"}[self.value]

    @property
    def order(self):
        """Sort key: the output is grouped FALL, then SPRING, then SUMMER."""
        return {"FALL": 0, "SPRI": 1, "SUMM": 2}[self.value]


class Moed(ParsableEnum):
    """Exam sitting (Hebrew: mo'ed) inside a semester."""

    ALEPH = "ALEPH"
    BET = "BET"
    GIMEL = "GIMEL"

    @classmethod
    def aliases(cls):
        return {"A": "ALEPH", "B": "BET", "C": "GIMEL"}

    @property
    def display_name(self):
        return self.value.capitalize()

    @property
    def order(self):
        return {"ALEPH": 0, "BET": 1, "GIMEL": 2}[self.value]


class Requirement(ParsableEnum):
    """Whether a course is mandatory or elective inside a study program."""

    OBLIGATORY = "OBLIGATORY"
    ELECTIVE = "ELECTIVE"

    @property
    def display_name(self):
        return self.value.capitalize()


class Evaluation(ParsableEnum):
    """How a course is graded. Only EXAM courses are scheduled in version 1.0."""

    EXAM = "EXAM"
    PROJECT = "PROJECT"
    ATTENDANCE = "ATTENDANCE"

    @property
    def display_name(self):
        return self.value.capitalize()
