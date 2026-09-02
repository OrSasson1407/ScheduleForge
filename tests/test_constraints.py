"""Tests of schedule_forge.scheduling.constraints: the pairwise scheduling
rules directly, not merely through the generator's end-to-end behavior.
NoTwoExamsSameDayInYearAndProgram already has direct coverage in
test_scheduling.py; this file covers the instructor rule, the two version 3.0
pairwise thresholds, and constraints_for's own composition logic."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from schedule_forge.model.course import Course
from schedule_forge.model.enums import Evaluation, Moed, Requirement, Semester
from schedule_forge.model.exam import Exam
from schedule_forge.scheduling.constraints import (
    MinimumDaysBetweenExams, MinimumDaysBetweenObligatoryExams,
    NoInstructorTwoExamsSameDay, NoTwoExamsSameDayInYearAndProgram,
    constraints_for)
from schedule_forge.settings import SchedulingSettings

OBLIGATORY = Requirement.OBLIGATORY
ELECTIVE = Requirement.ELECTIVE


def exam(number, slots, instructor="Dr. Test", semester=Semester.FALL, moed=Moed.ALEPH):
    course = Course(number, "Course " + number, instructor, [], Evaluation.EXAM)
    return Exam(course, semester, moed, slots)


class TestNoInstructorTwoExamsSameDay(unittest.TestCase):

    def setUp(self):
        self.constraint = NoInstructorTwoExamsSameDay()

    def test_is_a_pairwise_day_distance_rule(self):
        self.assertTrue(self.constraint.PAIRWISE_DAY_DISTANCE)

    def test_required_gap_is_1_for_the_same_instructor(self):
        first = exam("83112", {}, instructor="Dr. A")
        second = exam("83113", {}, instructor="Dr. A")
        self.assertEqual(1, self.constraint.required_gap(first, second))

    def test_required_gap_is_0_for_different_instructors(self):
        first = exam("83112", {}, instructor="Dr. A")
        second = exam("83113", {}, instructor="Dr. B")
        self.assertEqual(0, self.constraint.required_gap(first, second))

    def test_applies_even_with_no_shared_program_or_year(self):
        first = exam("83112", {("83101", 1): OBLIGATORY}, instructor="Dr. A")
        second = exam("83113", {("83102", 2): OBLIGATORY}, instructor="Dr. A")
        self.assertEqual(1, self.constraint.required_gap(first, second))

    def test_conflicts_matches_required_gap(self):
        same = [exam("a", {}, instructor="Dr. A"), exam("b", {}, instructor="Dr. A")]
        different = [exam("a", {}, instructor="Dr. A"), exam("b", {}, instructor="Dr. B")]
        self.assertTrue(self.constraint.conflicts(*same))
        self.assertFalse(self.constraint.conflicts(*different))

    def test_allows_rejects_a_date_already_holding_the_same_instructor(self):
        placed = exam("83112", {}, instructor="Dr. A")
        candidate = exam("83113", {}, instructor="Dr. A")
        self.assertFalse(self.constraint.allows(candidate, None, [placed]))

    def test_allows_a_date_with_only_other_instructors(self):
        placed = exam("83112", {}, instructor="Dr. A")
        candidate = exam("83113", {}, instructor="Dr. B")
        self.assertTrue(self.constraint.allows(candidate, None, [placed]))

    def test_describe_mentions_the_instructor(self):
        self.assertIn("instructor", self.constraint.describe())


class TestMinimumDaysBetweenObligatoryExams(unittest.TestCase):

    def setUp(self):
        self.constraint = MinimumDaysBetweenObligatoryExams(3)

    def test_required_gap_between_two_obligatory_exams_of_the_same_slot(self):
        first = exam("83112", {("83101", 1): OBLIGATORY})
        second = exam("83113", {("83101", 1): OBLIGATORY})
        self.assertEqual(3, self.constraint.required_gap(first, second))

    def test_zero_when_either_exam_is_elective_in_the_shared_slot(self):
        first = exam("83112", {("83101", 1): OBLIGATORY})
        second = exam("83113", {("83101", 1): ELECTIVE})
        self.assertEqual(0, self.constraint.required_gap(first, second))

    def test_zero_for_different_programs(self):
        first = exam("83112", {("83101", 1): OBLIGATORY})
        second = exam("83113", {("83102", 1): OBLIGATORY})
        self.assertEqual(0, self.constraint.required_gap(first, second))

    def test_zero_for_different_years_of_the_same_program(self):
        first = exam("83112", {("83101", 1): OBLIGATORY})
        second = exam("83113", {("83101", 2): OBLIGATORY})
        self.assertEqual(0, self.constraint.required_gap(first, second))

    def test_zero_across_different_exam_periods(self):
        first = exam("83112", {("83101", 1): OBLIGATORY}, moed=Moed.ALEPH)
        second = exam("83113", {("83101", 1): OBLIGATORY}, moed=Moed.BET)
        self.assertEqual(0, self.constraint.required_gap(first, second))

    def test_zero_across_different_semesters_even_with_the_same_moed(self):
        first = exam("83112", {("83101", 1): OBLIGATORY}, semester=Semester.FALL)
        second = exam("83113", {("83101", 1): OBLIGATORY}, semester=Semester.SPRING)
        self.assertEqual(0, self.constraint.required_gap(first, second))

    def test_uses_its_own_configured_number_of_days(self):
        wide = MinimumDaysBetweenObligatoryExams(10)
        first = exam("83112", {("83101", 1): OBLIGATORY})
        second = exam("83113", {("83101", 1): OBLIGATORY})
        self.assertEqual(10, wide.required_gap(first, second))

    def test_describe_mentions_its_day_count(self):
        self.assertIn("3", self.constraint.describe())


class TestMinimumDaysBetweenExams(unittest.TestCase):

    def setUp(self):
        self.constraint = MinimumDaysBetweenExams(2)

    def test_applies_between_two_obligatory_exams(self):
        first = exam("83112", {("83101", 1): OBLIGATORY})
        second = exam("83113", {("83101", 1): OBLIGATORY})
        self.assertEqual(2, self.constraint.required_gap(first, second))

    def test_applies_between_two_elective_exams_unlike_the_obligatory_only_rule(self):
        first = exam("83112", {("83101", 1): ELECTIVE})
        second = exam("83113", {("83101", 1): ELECTIVE})
        self.assertEqual(2, self.constraint.required_gap(first, second))

    def test_applies_between_a_mixed_obligatory_and_elective_pair(self):
        first = exam("83112", {("83101", 1): OBLIGATORY})
        second = exam("83113", {("83101", 1): ELECTIVE})
        self.assertEqual(2, self.constraint.required_gap(first, second))

    def test_zero_for_different_programs(self):
        first = exam("83112", {("83101", 1): OBLIGATORY})
        second = exam("83113", {("83102", 1): OBLIGATORY})
        self.assertEqual(0, self.constraint.required_gap(first, second))

    def test_zero_across_different_exam_periods(self):
        first = exam("83112", {("83101", 1): OBLIGATORY}, moed=Moed.ALEPH)
        second = exam("83113", {("83101", 1): OBLIGATORY}, moed=Moed.BET)
        self.assertEqual(0, self.constraint.required_gap(first, second))

    def test_describe_mentions_its_day_count(self):
        self.assertIn("2", self.constraint.describe())


class TestConstraintsFor(unittest.TestCase):

    def test_with_no_settings_only_the_two_unconditional_rules_apply(self):
        rules = constraints_for(None)
        self.assertEqual(2, len(rules))
        self.assertTrue(any(isinstance(r, NoTwoExamsSameDayInYearAndProgram) for r in rules))
        self.assertTrue(any(isinstance(r, NoInstructorTwoExamsSameDay) for r in rules))

    def test_settings_with_no_thresholds_still_yields_only_the_two_base_rules(self):
        settings = SchedulingSettings()
        rules = constraints_for(settings)
        self.assertEqual(2, len(rules))

    def test_min_days_between_obligatory_adds_its_own_rule(self):
        settings = SchedulingSettings(min_days_between_obligatory=3)
        rules = constraints_for(settings)
        self.assertEqual(3, len(rules))
        matching = [r for r in rules if isinstance(r, MinimumDaysBetweenObligatoryExams)]
        self.assertEqual(1, len(matching))
        self.assertEqual(3, matching[0].days)

    def test_min_days_between_any_adds_its_own_rule(self):
        settings = SchedulingSettings(min_days_between_any=5)
        rules = constraints_for(settings)
        self.assertEqual(3, len(rules))
        matching = [r for r in rules if isinstance(r, MinimumDaysBetweenExams)]
        self.assertEqual(1, len(matching))
        self.assertEqual(5, matching[0].days)

    def test_both_thresholds_together_yield_four_rules(self):
        settings = SchedulingSettings(min_days_between_obligatory=3, min_days_between_any=5)
        rules = constraints_for(settings)
        self.assertEqual(4, len(rules))

    def test_every_rule_returned_declares_pairwise_day_distance(self):
        settings = SchedulingSettings(min_days_between_obligatory=3, min_days_between_any=5)
        for rule in constraints_for(settings):
            self.assertTrue(rule.PAIRWISE_DAY_DISTANCE)


if __name__ == "__main__":
    unittest.main()
