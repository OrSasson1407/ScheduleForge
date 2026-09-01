"""Dates on which a member of the staff cannot be present (version 3.0).

An exam is never placed on a date its instructor is not available on. The rule
is about one exam alone, so it does not relate two exams to each other: it only
takes dates out of the dates that exam may use, which leaves the whole engine of
version 1.0 - and the exact count of the exam systems - as it is.
"""


class FacultyAvailability(object):
    """The dates every instructor is not available on."""

    __slots__ = ("_blocked",)

    def __init__(self, blocked=None):
        #: instructor name -> list of ExcludedDates
        self._blocked = dict(blocked or {})

    def instructors(self):
        return list(self._blocked.keys())

    def rules_of(self, instructor):
        return self._blocked.get(instructor, [])

    def is_available(self, instructor, date):
        for rule in self._blocked.get(instructor, ()):
            if rule.contains(date):
                return False
        return True

    def blocking_rule(self, instructor, date):
        """The rule that blocks that date, or None - used for the messages."""
        for rule in self._blocked.get(instructor, ()):
            if rule.contains(date):
                return rule
        return None

    def dates_for_exam(self, exam, dates):
        """The dates of `dates` the instructor of that exam can be present on."""
        instructor = exam.course.instructor
        if instructor not in self._blocked:
            return dates
        return [date for date in dates if self.is_available(instructor, date)]

    def __len__(self):
        return len(self._blocked)
