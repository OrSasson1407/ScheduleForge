"""Tests of schedule_forge.scheduling.time_slots.TimeSlotAssigner."""

import os
import sys
import unittest
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from schedule_forge.model.course import Course
from schedule_forge.model.enrollment import EnrollmentRoster
from schedule_forge.model.enums import Evaluation, Moed, Requirement, Semester
from schedule_forge.model.exam import Exam, ExamSystem, ScheduledExam
from schedule_forge.scheduling.time_slots import TimeSlotAssigner

FIRST = date(2026, 1, 29)
SECOND = date(2026, 1, 30)


def exam(number, slots, instructor=None):
    course = Course(number, "Course " + number, instructor or "Dr. " + number,
                    [], Evaluation.EXAM)
    return Exam(course, Semester.FALL, Moed.ALEPH, slots)


class TestConflicts(unittest.TestCase):

    def test_conflicts_when_two_exams_share_a_program_and_year(self):
        assigner = TimeSlotAssigner(["09:00", "13:00"])
        first = exam("83112", {("83101", 1): Requirement.OBLIGATORY})
        second = exam("83113", {("83101", 1): Requirement.ELECTIVE})
        self.assertTrue(assigner.conflicts(first, second))

    def test_does_not_conflict_with_no_shared_slot_and_no_roster(self):
        assigner = TimeSlotAssigner(["09:00", "13:00"])
        first = exam("83112", {("83101", 1): Requirement.OBLIGATORY})
        second = exam("83113", {("83102", 1): Requirement.OBLIGATORY})
        self.assertFalse(assigner.conflicts(first, second))

    def test_conflicts_via_a_roster_even_with_no_shared_slot(self):
        roster = EnrollmentRoster({"83112": {"2021001"}, "83113": {"2021001"}})
        assigner = TimeSlotAssigner(["09:00", "13:00"], roster)
        first = exam("83112", {("83101", 1): Requirement.OBLIGATORY})
        second = exam("83113", {("83102", 1): Requirement.OBLIGATORY})
        self.assertTrue(assigner.conflicts(first, second))

    def test_a_roster_with_no_overlap_does_not_conflict(self):
        roster = EnrollmentRoster({"83112": {"2021001"}, "83113": {"2021002"}})
        assigner = TimeSlotAssigner(["09:00", "13:00"], roster)
        first = exam("83112", {})
        second = exam("83113", {})
        self.assertFalse(assigner.conflicts(first, second))


class TestColor(unittest.TestCase):

    def test_a_single_exam_gets_the_first_slot(self):
        assigner = TimeSlotAssigner(["09:00", "13:00"])
        only = exam("83112", {})
        self.assertEqual({only: 0}, assigner.color([only]))

    def test_two_non_conflicting_exams_may_share_a_slot(self):
        assigner = TimeSlotAssigner(["09:00"])
        first = exam("83112", {("83101", 1): Requirement.OBLIGATORY})
        second = exam("83113", {("83102", 1): Requirement.OBLIGATORY})
        colors = assigner.color([first, second])
        self.assertEqual(0, colors[first])
        self.assertEqual(0, colors[second])

    def test_two_conflicting_exams_get_different_slots(self):
        assigner = TimeSlotAssigner(["09:00", "13:00"])
        first = exam("83112", {("83101", 1): Requirement.OBLIGATORY})
        second = exam("83113", {("83101", 1): Requirement.ELECTIVE})
        colors = assigner.color([first, second])
        self.assertNotEqual(colors[first], colors[second])

    def test_returns_none_when_there_are_not_enough_slots(self):
        assigner = TimeSlotAssigner(["09:00"])
        first = exam("83112", {("83101", 1): Requirement.OBLIGATORY})
        second = exam("83113", {("83101", 1): Requirement.ELECTIVE})
        self.assertIsNone(assigner.color([first, second]))

    def test_a_triangle_of_conflicts_needs_three_slots(self):
        assigner3 = TimeSlotAssigner(["09:00", "13:00", "16:00"])
        assigner2 = TimeSlotAssigner(["09:00", "13:00"])
        slot = {("83101", 1): Requirement.OBLIGATORY}
        exams = [exam("83112", slot), exam("83113", slot), exam("83114", slot)]
        self.assertIsNotNone(assigner3.color(exams))
        self.assertIsNone(assigner2.color(exams))

    def test_empty_list_colors_to_an_empty_mapping(self):
        assigner = TimeSlotAssigner(["09:00"])
        self.assertEqual({}, assigner.color([]))

    def test_exact_slot_budget_boundary(self):
        """Exactly as many mutually conflicting exams as slots must still work."""
        assigner = TimeSlotAssigner(["09:00", "13:00", "16:00"])
        slot = {("83101", 1): Requirement.OBLIGATORY}
        exams = [exam("8311%d" % i, slot) for i in range(3)]
        colors = assigner.color(exams)
        self.assertIsNotNone(colors)
        self.assertEqual(3, len(set(colors.values())))


class TestAssign(unittest.TestCase):

    def test_assigns_a_time_string_to_every_scheduled_exam(self):
        assigner = TimeSlotAssigner(["09:00", "13:00"])
        first = exam("83112", {("83101", 1): Requirement.OBLIGATORY})
        second = exam("83113", {("83101", 1): Requirement.ELECTIVE})
        scheduled_first = ScheduledExam(first, FIRST)
        scheduled_second = ScheduledExam(second, FIRST)
        system = ExamSystem([scheduled_first, scheduled_second])

        assignment = assigner.assign(system)

        self.assertIn(assignment[scheduled_first], ["09:00", "13:00"])
        self.assertIn(assignment[scheduled_second], ["09:00", "13:00"])
        self.assertNotEqual(assignment[scheduled_first], assignment[scheduled_second])

    def test_exams_on_different_dates_never_have_to_differ(self):
        assigner = TimeSlotAssigner(["09:00"])
        first = exam("83112", {("83101", 1): Requirement.OBLIGATORY})
        second = exam("83113", {("83101", 1): Requirement.OBLIGATORY})
        system = ExamSystem([ScheduledExam(first, FIRST), ScheduledExam(second, SECOND)])

        assignment = assigner.assign(system)

        self.assertEqual("09:00", assignment[system.scheduled_exams[0]])
        self.assertEqual("09:00", assignment[system.scheduled_exams[1]])

    def test_returns_none_when_a_date_cannot_be_colored(self):
        assigner = TimeSlotAssigner(["09:00"])
        slot = {("83101", 1): Requirement.OBLIGATORY}
        first = exam("83112", slot)
        second = exam("83113", slot)
        system = ExamSystem([ScheduledExam(first, FIRST), ScheduledExam(second, FIRST)])

        self.assertIsNone(assigner.assign(system))


if __name__ == "__main__":
    unittest.main()
