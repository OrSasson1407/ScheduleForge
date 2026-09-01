"""Tests of the engine: the decomposition, the exact count, the enumeration.

The counted number and the enumerated number have to agree - that is what makes
the count of a run trustworthy - so most tests here check both against each
other on shapes whose answer can also be worked out by hand.
"""

import os
import sys
import unittest
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from schedule_forge.model.course import Course
from schedule_forge.model.enums import Evaluation, Moed, Requirement, Semester
from schedule_forge.model.exam import Exam
from schedule_forge.model.exam_period import ExamPeriod
from schedule_forge.scheduling.constraints import (Constraint,
                                                   NoTwoExamsSameDayInYearAndProgram)
from schedule_forge.scheduling.decomposition import ProblemDecomposition
from schedule_forge.scheduling.generator import ExamSystemGenerator, GenerationReport

FIRST = date(2026, 1, 29)
OBLIGATORY = Requirement.OBLIGATORY
ELECTIVE = Requirement.ELECTIVE


def exam(number, slots, semester=Semester.FALL, moed=Moed.ALEPH):
    course = Course(number, "Course " + number, "Dr. Test", [], Evaluation.EXAM)
    return Exam(course, semester, moed, slots)


def period_of(days, semester=Semester.FALL, moed=Moed.ALEPH, first=FIRST):
    return ExamPeriod(semester, moed, first, first + timedelta(days=days - 1))


def periods_of(days, more=None):
    periods = {(Semester.FALL, Moed.ALEPH): period_of(days)}
    for (semester, moed), (length, first) in (more or {}).items():
        periods[(semester, moed)] = period_of(length, semester, moed, first)
    return periods


class TestDecomposition(unittest.TestCase):

    def _components(self, exams, periods):
        decomposition = ProblemDecomposition(
            exams, periods, [NoTwoExamsSameDayInYearAndProgram()])
        return decomposition.components

    def test_exams_that_never_conflict_fall_into_separate_components(self):
        exams = [exam("83112", {("83101", 1): OBLIGATORY}),
                 exam("83113", {("83102", 2): OBLIGATORY})]
        components = self._components(exams, periods_of(5))

        self.assertEqual([1, 1], [component.size for component in components])

    def test_exams_that_conflict_fall_into_one_component(self):
        exams = [exam("83112", {("83101", 1): OBLIGATORY}),
                 exam("83113", {("83101", 1): OBLIGATORY})]
        components = self._components(exams, periods_of(5))

        self.assertEqual([2], [component.size for component in components])
        self.assertTrue(components[0].is_clique)

    def test_two_electives_of_one_year_stay_independent(self):
        exams = [exam("83112", {("83101", 4): ELECTIVE}),
                 exam("83113", {("83101", 4): ELECTIVE})]
        components = self._components(exams, periods_of(5))

        self.assertEqual([1, 1], [component.size for component in components])

    def test_exams_of_different_periods_stay_independent(self):
        periods = periods_of(5, {(Semester.SPRING, Moed.ALEPH):
                                 (5, date(2026, 6, 21))})
        exams = [exam("83112", {("83101", 1): OBLIGATORY}),
                 exam("83113", {("83101", 1): OBLIGATORY},
                      semester=Semester.SPRING)]
        components = self._components(exams, periods)

        self.assertEqual([1, 1], [component.size for component in components])

    def test_exams_of_overlapping_periods_are_related(self):
        """Periods that share dates keep their exams in one component."""
        periods = periods_of(5, {(Semester.FALL, Moed.BET): (5, FIRST)})
        exams = [exam("83112", {("83101", 1): OBLIGATORY}),
                 exam("83113", {("83101", 1): OBLIGATORY}, moed=Moed.BET)]
        components = self._components(exams, periods)

        self.assertEqual([2], [component.size for component in components])

    def test_rejects_a_constraint_that_is_not_about_sharing_a_date(self):
        class Unsupported(Constraint):
            pass

        self.assertRaises(TypeError, ProblemDecomposition,
                          [exam("83112", {})], periods_of(5), [Unsupported()])


class TestExactCount(unittest.TestCase):
    """The counted number against the number the generator really produces."""

    def _both(self, exams, periods):
        generator = ExamSystemGenerator(exams, periods)
        produced = sum(1 for _ in generator.generate())
        return generator.total_systems(), produced

    def test_one_exam_may_take_every_date_of_its_period(self):
        counted, produced = self._both([exam("83112", {("83101", 1): OBLIGATORY})],
                                       periods_of(5))
        self.assertEqual((5, 5), (counted, produced))

    def test_independent_exams_multiply(self):
        exams = [exam("83112", {("83101", 1): OBLIGATORY}),
                 exam("83113", {("83102", 2): OBLIGATORY})]
        counted, produced = self._both(exams, periods_of(5))
        self.assertEqual((25, 25), (counted, produced))

    def test_a_group_that_excludes_itself_is_a_falling_factorial(self):
        slot = {("83101", 1): OBLIGATORY}
        exams = [exam("83112", slot), exam("83113", slot), exam("83114", slot)]
        counted, produced = self._both(exams, periods_of(5))
        self.assertEqual((5 * 4 * 3, 5 * 4 * 3), (counted, produced))

    def test_a_chain_of_exams_is_counted_right(self):
        """A shape that is neither independent nor a full group: a chain."""
        exams = [exam("83112", {("83101", 1): OBLIGATORY}),
                 exam("83113", {("83101", 1): OBLIGATORY,
                                ("83102", 2): OBLIGATORY}),
                 exam("83114", {("83102", 2): OBLIGATORY})]
        counted, produced = self._both(exams, periods_of(5))
        # The middle exam takes any date, the two ends any other one: 5*4*4.
        self.assertEqual((5 * 4 * 4, 5 * 4 * 4), (counted, produced))

    def test_more_exams_than_dates_gives_no_system_at_all(self):
        slot = {("83101", 1): OBLIGATORY}
        exams = [exam("8311%d" % index, slot) for index in range(4)]
        counted, produced = self._both(exams, periods_of(3))
        self.assertEqual((0, 0), (counted, produced))

    def test_the_whole_product_is_reported_in_the_report(self):
        slot = {("83101", 1): OBLIGATORY}
        exams = [exam("83112", slot), exam("83113", slot),
                 exam("83114", {("83102", 1): OBLIGATORY})]
        generator = ExamSystemGenerator(exams, periods_of(5))
        list(generator.generate(max_systems=2))

        self.assertEqual(5 * 4 * 5, generator.report.total)
        self.assertEqual(GenerationReport.REACHED_LIMIT, generator.report.status)


class TestEnumeration(unittest.TestCase):

    def test_every_produced_system_is_free_of_conflicts(self):
        rule = NoTwoExamsSameDayInYearAndProgram()
        exams = [exam("83112", {("83101", 1): OBLIGATORY}),
                 exam("83113", {("83101", 1): OBLIGATORY}),
                 exam("83114", {("83101", 1): ELECTIVE})]
        generator = ExamSystemGenerator(exams, periods_of(4))

        systems = list(generator.generate())
        self.assertEqual(4 * 3 * 2, len(systems))
        for system in systems:
            by_date = {}
            for scheduled in system.scheduled_exams:
                for placed in by_date.setdefault(scheduled.date, []):
                    self.assertFalse(rule.conflicts(scheduled.exam, placed))
                by_date[scheduled.date].append(scheduled.exam)

    def test_no_exam_system_is_produced_twice(self):
        exams = [exam("83112", {("83101", 1): OBLIGATORY}),
                 exam("83113", {("83102", 2): OBLIGATORY}),
                 exam("83114", {("83103", 3): OBLIGATORY})]
        generator = ExamSystemGenerator(exams, periods_of(4))

        seen = set()
        for system in generator.generate():
            key = frozenset((s.exam.key, s.date) for s in system.scheduled_exams)
            self.assertNotIn(key, seen)
            seen.add(key)
        self.assertEqual(4 ** 3, len(seen))

    def test_the_first_system_places_every_exam_as_early_as_it_can(self):
        exams = [exam("83112", {("83101", 1): OBLIGATORY}),
                 exam("83113", {("83101", 1): OBLIGATORY})]
        generator = ExamSystemGenerator(exams, periods_of(5))

        first = next(generator.generate())
        self.assertEqual([FIRST, FIRST + timedelta(days=1)],
                         [s.date for s in first.sorted_by_date()])

    def test_a_system_holds_the_exams_in_the_order_of_the_exam_list(self):
        exams = [exam("83112", {("83101", 1): OBLIGATORY}),
                 exam("83113", {("83102", 2): OBLIGATORY})]
        generator = ExamSystemGenerator(exams, periods_of(4))

        for system in generator.generate(max_systems=5):
            self.assertEqual(exams, [s.exam for s in system.scheduled_exams])


if __name__ == "__main__":
    unittest.main()
