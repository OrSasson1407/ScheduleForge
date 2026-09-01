"""Exams and complete exam systems (section C of the requirements).

The three classes are on the hot path of the generator, so they hold `__slots__`
and precompute the keys they are asked for again and again.
"""


class Exam(object):
    """One exam that has to be scheduled: a course in a specific moed.

    A course whose evaluation is Exam produces one Exam per moed defined for its
    semester, because moed Aleph and moed Bet are scheduled independently.

    `slots` maps every (program, year) the exam belongs to - restricted to the
    programs the user selected - to the Requirement of the course there. It is
    the only information the conflict rule of requirement 1.2 needs.
    """

    __slots__ = ("course", "semester", "moed", "slots", "key", "period_key")

    def __init__(self, course, semester, moed, slots):
        self.course = course
        self.semester = semester
        self.moed = moed
        self.slots = dict(slots)
        self.key = (course.number, semester, moed)
        self.period_key = (semester, moed)

    def __repr__(self):
        return "Exam(%s, %s, %s)" % (
            self.course.number, self.semester.value, self.moed.value)


class ScheduledExam(object):
    """An exam placed on a concrete date (an assignment of an exam).

    The object is a value: it is never changed once it is built. The generator
    relies on that and hands the same object to every exam system that places
    this exam on this date.
    """

    __slots__ = ("exam", "date")

    def __init__(self, exam, date):
        self.exam = exam
        self.date = date

    @property
    def course(self):
        return self.exam.course

    def __repr__(self):
        return "ScheduledExam(%s, %s)" % (self.exam.course.number, self.date)


class ExamSystem(object):
    """A complete, conflict free assignment of all the exams (an exam system).

    The exams are held in the order of the exam list of the generator, which is
    the order of requirement 2.3.3 up to the dates; the readers below sort them.
    """

    __slots__ = ("scheduled_exams",)

    def __init__(self, scheduled_exams):
        self.scheduled_exams = scheduled_exams

    def sorted_by_date(self):
        """The exams ordered as required by 2.3.3: semester, moed, then date."""
        return sorted(
            self.scheduled_exams,
            key=lambda s: (s.exam.semester.order, s.exam.moed.order, s.date,
                           s.exam.course.number))

    def grouped_by_period(self):
        """Yield ((semester, moed), exams sorted by date) groups, in order."""
        groups = {}
        for scheduled in self.scheduled_exams:
            groups.setdefault(scheduled.exam.period_key, []).append(scheduled)
        for key in sorted(groups, key=lambda k: (k[0].order, k[1].order)):
            yield key, sorted(groups[key],
                              key=lambda s: (s.date, s.exam.course.number))

    def __len__(self):
        return len(self.scheduled_exams)
