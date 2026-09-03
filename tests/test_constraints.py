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
from schedule_forge.model.enrollment import EnrollmentRoster
from schedule_forge.model.enums import Evaluation, Moed, Requirement, Semester
from schedule_forge.model.exam import Exam
from schedule_forge.scheduling.constraints import (
    MinimumDaysBetweenExams, MinimumDaysBetweenObligatoryExams,
    MinimumGapBetweenMoeds, NoInstructorTwoExamsSameDay,
    NoTwoExamsSameDayInYearAndProgram, SharedStudentsSameDay, constraints_for)
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


class TestMinimumGapBetweenMoeds(unittest.TestCase):

    def setUp(self):
        self.constraint = MinimumGapBetweenMoeds(5)

    def test_is_a_pairwise_day_distance_rule(self):
        self.assertTrue(self.constraint.PAIRWISE_DAY_DISTANCE)

    def test_required_gap_between_moed_aleph_and_moed_bet_of_the_same_course(self):
        first = exam("83112", {}, moed=Moed.ALEPH)
        second = exam("83112", {}, moed=Moed.BET)
        self.assertEqual(5, self.constraint.required_gap(first, second))

    def test_zero_for_the_same_moed(self):
        first = exam("83112", {}, moed=Moed.ALEPH)
        second = exam("83112", {}, moed=Moed.ALEPH)
        self.assertEqual(0, self.constraint.required_gap(first, second))

    def test_zero_for_different_courses(self):
        first = exam("83112", {}, moed=Moed.ALEPH)
        second = exam("83113", {}, moed=Moed.BET)
        self.assertEqual(0, self.constraint.required_gap(first, second))

    def test_zero_across_different_semesters_even_with_the_same_course_number(self):
        first = exam("83112", {}, semester=Semester.FALL, moed=Moed.ALEPH)
        second = exam("83112", {}, semester=Semester.SPRING, moed=Moed.BET)
        self.assertEqual(0, self.constraint.required_gap(first, second))

    def test_applies_with_no_shared_program_or_year_at_all(self):
        first = exam("83112", {("83101", 1): OBLIGATORY}, moed=Moed.ALEPH)
        second = exam("83112", {("83102", 2): OBLIGATORY}, moed=Moed.BET)
        self.assertEqual(5, self.constraint.required_gap(first, second))

    def test_describe_mentions_its_day_count(self):
        self.assertIn("5", self.constraint.describe())

    def test_minimum_days_between_exams_stays_silent_for_the_same_pair(self):
        """The existing 2.2 gap rule deliberately skips cross-moed pairs -
        this new rule is exactly the gap that gap rule leaves uncovered."""
        first = exam("83112", {("83101", 1): OBLIGATORY}, moed=Moed.ALEPH)
        second = exam("83112", {("83101", 1): OBLIGATORY}, moed=Moed.BET)
        self.assertEqual(0, MinimumDaysBetweenExams(2).required_gap(first, second))
        self.assertEqual(5, self.constraint.required_gap(first, second))


class TestSharedStudentsSameDay(unittest.TestCase):

    def test_is_a_pairwise_day_distance_rule(self):
        constraint = SharedStudentsSameDay(EnrollmentRoster({}))
        self.assertTrue(constraint.PAIRWISE_DAY_DISTANCE)

    def test_required_gap_is_1_when_a_real_student_takes_both_courses(self):
        roster = EnrollmentRoster({"83112": {"2021001"}, "83113": {"2021001"}})
        constraint = SharedStudentsSameDay(roster)
        first = exam("83112", {})
        second = exam("83113", {})
        self.assertEqual(1, constraint.required_gap(first, second))

    def test_required_gap_is_0_with_no_overlap_in_the_roster(self):
        roster = EnrollmentRoster({"83112": {"2021001"}, "83113": {"2021002"}})
        constraint = SharedStudentsSameDay(roster)
        first = exam("83112", {})
        second = exam("83113", {})
        self.assertEqual(0, constraint.required_gap(first, second))

    def test_applies_even_with_no_shared_program_or_year(self):
        """The whole point: a roster catches a real conflict the aggregate
        (program, year) model cannot see at all - e.g. a minor or a
        cross-listed elective in a program/year the two courses do not share."""
        roster = EnrollmentRoster({"83112": {"2021001"}, "83113": {"2021001"}})
        constraint = SharedStudentsSameDay(roster)
        first = exam("83112", {("83101", 1): ELECTIVE})
        second = exam("83113", {("83102", 2): ELECTIVE})
        self.assertEqual(1, constraint.required_gap(first, second))

    def test_describe_mentions_a_real_student(self):
        constraint = SharedStudentsSameDay(EnrollmentRoster({}))
        self.assertIn("student", constraint.describe())


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

    def test_min_gap_between_moeds_adds_its_own_rule(self):
        settings = SchedulingSettings(min_gap_between_moeds=7)
        rules = constraints_for(settings)
        self.assertEqual(3, len(rules))
        matching = [r for r in rules if isinstance(r, MinimumGapBetweenMoeds)]
        self.assertEqual(1, len(matching))
        self.assertEqual(7, matching[0].days)

    def test_no_roster_adds_nothing_even_with_thresholds_active(self):
        settings = SchedulingSettings(min_days_between_obligatory=3)
        rules = constraints_for(settings, roster=None)
        self.assertFalse(any(isinstance(r, SharedStudentsSameDay) for r in rules))

    def test_a_roster_adds_its_own_rule(self):
        roster = EnrollmentRoster({"83112": {"2021001"}})
        rules = constraints_for(None, roster=roster)
        matching = [r for r in rules if isinstance(r, SharedStudentsSameDay)]
        self.assertEqual(1, len(matching))
        self.assertIs(roster, matching[0].roster)

    def test_every_rule_returned_declares_pairwise_day_distance(self):
        settings = SchedulingSettings(min_days_between_obligatory=3, min_days_between_any=5)
        for rule in constraints_for(settings):
            self.assertTrue(rule.PAIRWISE_DAY_DISTANCE)


if __name__ == "__main__":
    unittest.main()
