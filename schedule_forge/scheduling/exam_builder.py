"""Turns the parsed data into the list of exams that have to be scheduled."""

from ..model.exam import Exam


class SchedulingDataError(Exception):
    """The parsed data cannot produce a schedule (for example a missing period)."""


class ExamBuilder(object):
    """Collects the exams of the selected study programs (requirement 1.2).

    Only courses whose evaluation is Exam are scheduled. A course produces one
    exam per moed that the exam periods file defines for the semester in which
    the course is taught, because every moed is scheduled on its own.
    """

    def __init__(self, courses, periods, selected_programs):
        self.courses = courses
        self.periods = periods
        self.selected_programs = list(selected_programs)

    def build(self):
        """Return the exams to schedule, in a stable, readable order."""
        from ..model.enums import Evaluation

        selected = set(self.selected_programs)
        moadim_by_semester = self._moadim_by_semester()
        exams = []
        missing_periods = set()

        for course in self.courses:
            if course.evaluation is not Evaluation.EXAM:
                continue
            enrollments = course.enrollments_in(selected)
            if not enrollments:
                continue
            for semester in self._distinct_semesters(enrollments):
                slots = dict((e.slot, e.requirement) for e in enrollments
                             if e.semester is semester)
                moadim = moadim_by_semester.get(semester)
                if not moadim:
                    missing_periods.add(semester.display_name)
                    continue
                for moed in moadim:
                    exams.append(Exam(course, semester, moed, slots))

        if missing_periods:
            raise SchedulingDataError(
                "the exam periods file defines no period for semester %s, "
                "although courses of the selected programs are taught in it"
                % ", ".join(sorted(missing_periods)))

        exams.sort(key=lambda exam: (exam.semester.order, exam.moed.order,
                                     exam.course.number))
        return exams

    def _distinct_semesters(self, enrollments):
        semesters = []
        for enrollment in enrollments:
            if enrollment.semester not in semesters:
                semesters.append(enrollment.semester)
        return semesters

    def _moadim_by_semester(self):
        by_semester = {}
        for semester, moed in self.periods:
            by_semester.setdefault(semester, []).append(moed)
        for moadim in by_semester.values():
            moadim.sort(key=lambda moed: moed.order)
        return by_semester
