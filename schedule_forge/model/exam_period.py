"""Exam periods: the range of dates an exam of a given moed may be placed in."""

from datetime import timedelta


class ExcludedDates(object):
    """A single date, or a range of dates, on which no exam may take place."""

    def __init__(self, start, end=None, comment=""):
        self.start = start
        self.end = end if end is not None else start
        self.comment = comment

    def contains(self, date):
        return self.start <= date <= self.end

    def __repr__(self):
        return "ExcludedDates(%s..%s, %s)" % (self.start, self.end, self.comment)


class ExamPeriod(object):
    """The dates available for the exams of one (semester, moed) pair."""

    def __init__(self, semester, moed, start_date, end_date, excluded=()):
        self.semester = semester
        self.moed = moed
        self.start_date = start_date
        self.end_date = end_date
        self.excluded = list(excluded)
        self._available = None

    @property
    def key(self):
        return (self.semester, self.moed)

    def is_excluded(self, date):
        return any(rule.contains(date) for rule in self.excluded)

    def available_dates(self):
        """All dates of the period on which an exam may be scheduled.

        Computed once and cached - the generator asks for it on every branch.
        """
        if self._available is None:
            dates = []
            day = self.start_date
            while day <= self.end_date:
                if not self.is_excluded(day):
                    dates.append(day)
                day += timedelta(days=1)
            self._available = dates
        return self._available

    def __repr__(self):
        return "ExamPeriod(%s, %s, %s..%s)" % (
            self.semester.value, self.moed.value, self.start_date, self.end_date)
