"""Tests of the exam building, of the conflict rule and of the generator."""

import os
import sys
import unittest
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from schedule_forge.model.course import Course, ProgramEnrollment
from schedule_forge.model.enrollment import EnrollmentRoster
from schedule_forge.model.enums import Evaluation, Moed, Requirement, Semester
from schedule_forge.model.exam import Exam
from schedule_forge.model.exam_period import ExamPeriod, ExcludedDates
from schedule_forge.scheduling.constraints import (NoTwoExamsSameDayInYearAndProgram,
                                                    constraints_for)
from schedule_forge.scheduling.exam_builder import ExamBuilder, SchedulingDataError
from schedule_forge.scheduling.generator import ExamSystemGenerator, GenerationReport
from schedule_forge.model.study_program import StudyProgramCatalog

FIRST = date(2026, 1, 29)
SECOND = date(2026, 1, 30)


def course(number, evaluation=Evaluation.EXAM, enrollments=()):
    return Course(number, "Course " + number, "Dr. Test", enrollments, evaluation)


def enrollment(program="83101", year=1, semester=Semester.FALL,
               requirement=Requirement.OBLIGATORY):
    return ProgramEnrollment(program, year, semester, requirement)


def exam(number, slots, semester=Semester.FALL, moed=Moed.ALEPH):
    return Exam(course(number), semester, moed, slots)


def two_day_periods():
    return {(Semester.FALL, Moed.ALEPH):
            ExamPeriod(Semester.FALL, Moed.ALEPH, FIRST, SECOND)}


class TestConflictRule(unittest.TestCase):
    """Requirement 1.2 - what counts as a critical conflict in version 1.0."""

    def setUp(self):
        self.constraint = NoTwoExamsSameDayInYearAndProgram()

    def test_forbids_two_obligatory_exams_of_the_same_year_and_program(self):
        placed = exam("83112", {("83101", 1): Requirement.OBLIGATORY})
        candidate = exam("83113", {("83101", 1): Requirement.OBLIGATORY})
        self.assertFalse(self.constraint.allows(candidate, FIRST, [placed]))

    def test_forbids_an_obligatory_and_an_elective_of_the_same_year(self):
        placed = exam("83112", {("83101", 1): Requirement.OBLIGATORY})
        candidate = exam("83113", {("83101", 1): Requirement.ELECTIVE})
        self.assertFalse(self.constraint.allows(candidate, FIRST, [placed]))

    def test_allows_two_elective_exams_of_the_same_year_and_program(self):
        placed = exam("83112", {("83101", 1): Requirement.ELECTIVE})
        candidate = exam("83113", {("83101", 1): Requirement.ELECTIVE})
        self.assertTrue(self.constraint.allows(candidate, FIRST, [placed]))

    def test_allows_exams_of_different_years(self):
        placed = exam("83112", {("83101", 1): Requirement.OBLIGATORY})
        candidate = exam("83113", {("83101", 2): Requirement.OBLIGATORY})
        self.assertTrue(self.constraint.allows(candidate, FIRST, [placed]))

    def test_allows_exams_of_different_programs(self):
        placed = exam("83112", {("83101", 1): Requirement.OBLIGATORY})
        candidate = exam("83113", {("83102", 1): Requirement.OBLIGATORY})
        self.assertTrue(self.constraint.allows(candidate, FIRST, [placed]))

    def test_forbids_when_only_one_shared_program_conflicts(self):
        placed = exam("83112", {("83101", 1): Requirement.ELECTIVE,
                                ("83108", 1): Requirement.OBLIGATORY})
        candidate = exam("83113", {("83101", 1): Requirement.ELECTIVE,
                                   ("83108", 1): Requirement.ELECTIVE})
        self.assertFalse(self.constraint.allows(candidate, FIRST, [placed]))


class TestStudyProgramCatalog(unittest.TestCase):
    """Nothing is built in: the catalogue is only ever derived from the data."""

    def test_a_fresh_catalogue_knows_no_program(self):
        catalog = StudyProgramCatalog()
        self.assertEqual([], catalog.numbers())
        self.assertFalse(catalog.contains("83101"))

    def test_from_courses_finds_every_program_the_courses_mention(self):
        courses = [
            course("83112", enrollments=[enrollment(program="83101"),
                                         enrollment(program="83108")]),
            course("83113", enrollments=[enrollment(program="83102")]),
        ]
        catalog = StudyProgramCatalog.from_courses(courses)

        self.assertEqual(["83101", "83102", "83108"], sorted(catalog.numbers()))
        self.assertTrue(catalog.contains("83101"))
        self.assertFalse(catalog.contains("99999"))

    def test_a_program_the_courses_do_not_mention_is_unknown(self):
        courses = [course("83112", enrollments=[enrollment(program="83101")])]
        catalog = StudyProgramCatalog.from_courses(courses)

        self.assertFalse(catalog.contains("83108"))

    def test_name_of_falls_back_to_the_number_itself(self):
        courses = [course("83112", enrollments=[enrollment(program="83101")])]
        catalog = StudyProgramCatalog.from_courses(courses)

        self.assertEqual("83101", catalog.name_of("83101"))
        self.assertEqual("99999", catalog.name_of("99999"))


class TestExamBuilder(unittest.TestCase):

    def setUp(self):
        self.periods = {
            (Semester.FALL, Moed.ALEPH):
                ExamPeriod(Semester.FALL, Moed.ALEPH, FIRST, SECOND),
            (Semester.FALL, Moed.BET):
                ExamPeriod(Semester.FALL, Moed.BET, FIRST, SECOND),
        }

    def test_creates_one_exam_per_moed_of_the_semester(self):
        courses = [course("83112", enrollments=[enrollment()])]
        exams = ExamBuilder(courses, self.periods, ["83101"]).build()

        self.assertEqual(2, len(exams))
        self.assertEqual([Moed.ALEPH, Moed.BET], [e.moed for e in exams])
        self.assertEqual({("83101", 1): Requirement.OBLIGATORY}, exams[0].slots)

    def test_skips_courses_that_are_not_evaluated_by_an_exam(self):
        courses = [course("83112", Evaluation.PROJECT, [enrollment()]),
                   course("83113", Evaluation.ATTENDANCE, [enrollment()])]
        self.assertEqual([], ExamBuilder(courses, self.periods, ["83101"]).build())

    def test_skips_courses_of_programs_that_were_not_selected(self):
        courses = [course("83112", enrollments=[enrollment(program="83109")])]
        self.assertEqual([], ExamBuilder(courses, self.periods, ["83101"]).build())

    def test_keeps_only_the_slots_of_the_selected_programs(self):
        courses = [course("83112", enrollments=[
            enrollment(program="83101", year=1),
            enrollment(program="83109", year=3)])]
        exams = ExamBuilder(courses, self.periods, ["83101"]).build()
        self.assertEqual({("83101", 1): Requirement.OBLIGATORY}, exams[0].slots)

    def test_reports_a_semester_that_has_no_exam_period(self):
        courses = [course("83112",
                          enrollments=[enrollment(semester=Semester.SPRING)])]
        builder = ExamBuilder(courses, self.periods, ["83101"])
        self.assertRaises(SchedulingDataError, builder.build)


class TestExamSystemGenerator(unittest.TestCase):

    def _generate(self, exams, periods=None, **limits):
        periods = periods if periods is not None else two_day_periods()
        generator = ExamSystemGenerator(exams, periods)
        systems = list(generator.generate(**limits))
        return systems, generator.report

    def test_generates_every_combination_when_nothing_conflicts(self):
        exams = [exam("83112", {("83101", 1): Requirement.OBLIGATORY}),
                 exam("83113", {("83102", 1): Requirement.OBLIGATORY})]
        systems, report = self._generate(exams)

        self.assertEqual(4, len(systems))
        self.assertTrue(report.is_complete)
        self.assertEqual(2, len(systems[0]))

    def test_leaves_out_the_systems_that_hold_a_conflict(self):
        exams = [exam("83112", {("83101", 1): Requirement.OBLIGATORY}),
                 exam("83113", {("83101", 1): Requirement.OBLIGATORY})]
        systems, report = self._generate(exams)

        self.assertEqual(2, len(systems))
        self.assertTrue(report.is_complete)
        for system in systems:
            dates = [scheduled.date for scheduled in system.scheduled_exams]
            self.assertEqual(len(dates), len(set(dates)))

    def test_produces_nothing_when_no_conflict_free_system_exists(self):
        conflicting = {("83101", 1): Requirement.OBLIGATORY}
        exams = [exam("83112", conflicting), exam("83113", conflicting),
                 exam("83114", conflicting)]
        systems, report = self._generate(exams)

        self.assertEqual([], systems)
        self.assertTrue(report.is_complete)

    def test_skips_the_excluded_dates_of_the_period(self):
        periods = {(Semester.FALL, Moed.ALEPH): ExamPeriod(
            Semester.FALL, Moed.ALEPH, FIRST, SECOND,
            [ExcludedDates(SECOND, SECOND, "Saturday")])}
        exams = [exam("83112", {("83101", 1): Requirement.OBLIGATORY})]
        systems, _ = self._generate(exams, periods)

        self.assertEqual(1, len(systems))
        self.assertEqual(FIRST, systems[0].scheduled_exams[0].date)

    def test_stops_at_the_requested_number_of_systems(self):
        exams = [exam("83112", {("83101", 1): Requirement.OBLIGATORY}),
                 exam("83113", {("83102", 1): Requirement.OBLIGATORY})]
        systems, report = self._generate(exams, max_systems=3)

        self.assertEqual(3, len(systems))
        self.assertEqual(GenerationReport.REACHED_LIMIT, report.status)

    def test_orders_the_exams_of_a_system_by_period_and_date(self):
        periods = two_day_periods()
        periods[(Semester.FALL, Moed.BET)] = ExamPeriod(
            Semester.FALL, Moed.BET, FIRST, SECOND)
        exams = [exam("83112", {("83101", 1): Requirement.OBLIGATORY}),
                 exam("83113", {("83101", 2): Requirement.OBLIGATORY},
                      moed=Moed.BET)]
        systems, _ = self._generate(exams, periods)

        groups = list(systems[0].grouped_by_period())
        self.assertEqual([(Semester.FALL, Moed.ALEPH), (Semester.FALL, Moed.BET)],
                         [key for key, _ in groups])


class TestSharedStudentsEndToEnd(unittest.TestCase):
    """Item 1 - a roster can force apart a pair the (program, year) rule's
    own elective/elective exception would otherwise allow to share a date."""

    def _electives_of_one_program(self):
        # Distinct instructors: isolates this from the unconditional
        # instructor rule, which would force the two exams apart on its own
        # regardless of the roster and defeat the point of the test.
        first_course = Course("83112", "Course 83112", "Dr. A", [], Evaluation.EXAM)
        second_course = Course("83113", "Course 83113", "Dr. B", [], Evaluation.EXAM)
        slots = {("83101", 1): Requirement.ELECTIVE}
        return [Exam(first_course, Semester.FALL, Moed.ALEPH, slots),
                Exam(second_course, Semester.FALL, Moed.ALEPH, slots)]

    def test_a_roster_forces_apart_an_elective_pair_that_shares_a_real_student(self):
        exams = self._electives_of_one_program()
        roster = EnrollmentRoster({"83112": {"2021001"}, "83113": {"2021001"}})
        generator = ExamSystemGenerator(exams, two_day_periods(),
                                        constraints_for(None, roster))

        systems = list(generator.generate())
        self.assertTrue(systems)
        for system in systems:
            dates = [scheduled.date for scheduled in system.scheduled_exams]
            self.assertEqual(len(dates), len(set(dates)))

    def test_without_roster_evidence_the_same_pair_may_still_share_a_date(self):
        exams = self._electives_of_one_program()
        generator = ExamSystemGenerator(exams, two_day_periods(),
                                        constraints_for(None, None))

        systems = list(generator.generate())
        same_date = [system for system in systems
                    if len({s.date for s in system.scheduled_exams}) == 1]
        self.assertTrue(same_date)

    def test_a_roster_with_no_overlap_for_this_pair_changes_nothing(self):
        exams = self._electives_of_one_program()
        roster = EnrollmentRoster({"83112": {"2021001"}, "83113": {"2021002"}})
        generator = ExamSystemGenerator(exams, two_day_periods(),
                                        constraints_for(None, roster))

        systems = list(generator.generate())
        same_date = [system for system in systems
                    if len({s.date for s in system.scheduled_exams}) == 1]
        self.assertTrue(same_date)


if __name__ == "__main__":
    unittest.main()
