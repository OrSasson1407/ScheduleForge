"""Tests of the plain model objects: enums, course, exam, room, study program,
exam period and faculty availability - the parts of schedule_forge.model not
already exercised end to end by the parser and scheduling tests."""

import os
import sys
import unittest
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from schedule_forge.model.availability import FacultyAvailability
from schedule_forge.model.course import Course, ProgramEnrollment
from schedule_forge.model.enums import Evaluation, Moed, Requirement, Semester
from schedule_forge.model.exam import Exam, ExamSystem, ScheduledExam
from schedule_forge.model.exam_period import ExamPeriod, ExcludedDates
from schedule_forge.model.room import Room, RoomAllocation, RoomBooking
from schedule_forge.model.study_program import StudyProgram, StudyProgramCatalog


class TestParsableEnum(unittest.TestCase):

    def test_semester_parses_its_canonical_tokens(self):
        self.assertIs(Semester.parse("FALL"), Semester.FALL)
        self.assertIs(Semester.parse("SPRI"), Semester.SPRING)
        self.assertIs(Semester.parse("SUMM"), Semester.SUMMER)

    def test_semester_parses_its_aliases(self):
        self.assertIs(Semester.parse("SPRING"), Semester.SPRING)
        self.assertIs(Semester.parse("SUMMER"), Semester.SUMMER)

    def test_semester_parse_is_case_insensitive(self):
        self.assertIs(Semester.parse("fall"), Semester.FALL)

    def test_semester_parse_strips_whitespace(self):
        self.assertIs(Semester.parse("  FALL  "), Semester.FALL)

    def test_semester_parse_rejects_an_unknown_token(self):
        with self.assertRaises(ValueError):
            Semester.parse("WINTER")

    def test_semester_parse_error_lists_the_legal_values(self):
        try:
            Semester.parse("WINTER")
            self.fail("expected ValueError")
        except ValueError as error:
            self.assertIn("FALL", str(error))
            self.assertIn("SPRI", str(error))
            self.assertIn("SUMM", str(error))

    def test_semester_display_names(self):
        self.assertEqual(Semester.FALL.display_name, "FALL")
        self.assertEqual(Semester.SPRING.display_name, "SPRING")
        self.assertEqual(Semester.SUMMER.display_name, "SUMMER")

    def test_semester_order_is_fall_then_spring_then_summer(self):
        self.assertLess(Semester.FALL.order, Semester.SPRING.order)
        self.assertLess(Semester.SPRING.order, Semester.SUMMER.order)

    def test_moed_parses_short_aliases(self):
        self.assertIs(Moed.parse("A"), Moed.ALEPH)
        self.assertIs(Moed.parse("B"), Moed.BET)
        self.assertIs(Moed.parse("C"), Moed.GIMEL)

    def test_moed_display_name_is_capitalized(self):
        self.assertEqual(Moed.ALEPH.display_name, "Aleph")

    def test_moed_order_is_aleph_then_bet_then_gimel(self):
        self.assertLess(Moed.ALEPH.order, Moed.BET.order)
        self.assertLess(Moed.BET.order, Moed.GIMEL.order)

    def test_requirement_parses_case_insensitively(self):
        self.assertIs(Requirement.parse("obligatory"), Requirement.OBLIGATORY)
        self.assertIs(Requirement.parse("ELECTIVE"), Requirement.ELECTIVE)

    def test_requirement_display_name(self):
        self.assertEqual(Requirement.OBLIGATORY.display_name, "Obligatory")

    def test_evaluation_parses_every_legal_value(self):
        self.assertIs(Evaluation.parse("EXAM"), Evaluation.EXAM)
        self.assertIs(Evaluation.parse("PROJECT"), Evaluation.PROJECT)
        self.assertIs(Evaluation.parse("ATTENDANCE"), Evaluation.ATTENDANCE)

    def test_evaluation_rejects_an_unknown_value(self):
        with self.assertRaises(ValueError):
            Evaluation.parse("QUIZ")


class TestProgramEnrollment(unittest.TestCase):

    def test_slot_is_the_program_and_year_pair(self):
        enrollment = ProgramEnrollment("83101", 1, Semester.FALL, Requirement.OBLIGATORY)
        self.assertEqual(enrollment.slot, ("83101", 1))

    def test_repr_includes_program_year_semester_and_requirement(self):
        enrollment = ProgramEnrollment("83101", 1, Semester.FALL, Requirement.OBLIGATORY)
        text = repr(enrollment)
        self.assertIn("83101", text)
        self.assertIn("FALL", text)
        self.assertIn("OBLIGATORY", text)


class TestCourse(unittest.TestCase):

    def _course(self, students=None, enrollments=()):
        return Course("83101", "Intro", "Dr. A", enrollments, Evaluation.EXAM, students)

    def test_students_or_returns_its_own_count_when_set(self):
        self.assertEqual(self._course(students=45).students_or(30), 45)

    def test_students_or_falls_back_to_the_default(self):
        self.assertEqual(self._course(students=None).students_or(30), 30)

    def test_enrollments_in_filters_by_program_number(self):
        enrollments = [
            ProgramEnrollment("83101", 1, Semester.FALL, Requirement.OBLIGATORY),
            ProgramEnrollment("83102", 1, Semester.FALL, Requirement.OBLIGATORY),
        ]
        course = self._course(enrollments=enrollments)
        result = course.enrollments_in({"83101"})
        self.assertEqual([e.program_number for e in result], ["83101"])

    def test_is_taught_in_any_true_when_one_enrollment_matches(self):
        enrollments = [ProgramEnrollment("83101", 1, Semester.FALL, Requirement.OBLIGATORY)]
        course = self._course(enrollments=enrollments)
        self.assertTrue(course.is_taught_in_any({"83101", "83102"}))

    def test_is_taught_in_any_false_when_nothing_matches(self):
        enrollments = [ProgramEnrollment("83101", 1, Semester.FALL, Requirement.OBLIGATORY)]
        course = self._course(enrollments=enrollments)
        self.assertFalse(course.is_taught_in_any({"83102"}))

    def test_is_taught_in_any_false_with_no_enrollments(self):
        self.assertFalse(self._course().is_taught_in_any({"83101"}))


class TestExam(unittest.TestCase):

    def _course(self):
        return Course("83101", "Intro", "Dr. A", [], Evaluation.EXAM)

    def test_key_combines_course_semester_and_moed(self):
        exam = Exam(self._course(), Semester.FALL, Moed.ALEPH, {})
        self.assertEqual(exam.key, ("83101", Semester.FALL, Moed.ALEPH))

    def test_period_key_is_semester_and_moed(self):
        exam = Exam(self._course(), Semester.FALL, Moed.ALEPH, {})
        self.assertEqual(exam.period_key, (Semester.FALL, Moed.ALEPH))

    def test_slots_is_copied_from_the_given_mapping(self):
        slots = {("83101", 1): Requirement.OBLIGATORY}
        exam = Exam(self._course(), Semester.FALL, Moed.ALEPH, slots)
        self.assertEqual(exam.slots, slots)
        slots[("83101", 1)] = Requirement.ELECTIVE
        self.assertEqual(exam.slots[("83101", 1)], Requirement.OBLIGATORY)

    def test_repr_includes_course_semester_and_moed(self):
        exam = Exam(self._course(), Semester.FALL, Moed.ALEPH, {})
        text = repr(exam)
        self.assertIn("83101", text)
        self.assertIn("FALL", text)
        self.assertIn("ALEPH", text)


class TestScheduledExam(unittest.TestCase):

    def test_course_property_delegates_to_the_exam(self):
        course = Course("83101", "Intro", "Dr. A", [], Evaluation.EXAM)
        exam = Exam(course, Semester.FALL, Moed.ALEPH, {})
        scheduled = ScheduledExam(exam, date(2026, 1, 1))
        self.assertIs(scheduled.course, course)

    def test_repr_includes_course_number_and_date(self):
        course = Course("83101", "Intro", "Dr. A", [], Evaluation.EXAM)
        exam = Exam(course, Semester.FALL, Moed.ALEPH, {})
        scheduled = ScheduledExam(exam, date(2026, 1, 1))
        self.assertIn("83101", repr(scheduled))
        self.assertIn("2026-01-01", repr(scheduled))


class TestExamSystem(unittest.TestCase):

    def _scheduled(self, number, semester, moed, day):
        course = Course(number, "Course " + number, "Dr. " + number, [], Evaluation.EXAM)
        exam = Exam(course, semester, moed, {})
        return ScheduledExam(exam, day)

    def test_len_counts_the_scheduled_exams(self):
        system = ExamSystem([self._scheduled("83101", Semester.FALL, Moed.ALEPH, date(2026, 1, 1))])
        self.assertEqual(len(system), 1)

    def test_sorted_by_date_orders_by_semester_then_moed_then_date_then_course(self):
        a = self._scheduled("83102", Semester.FALL, Moed.ALEPH, date(2026, 1, 5))
        b = self._scheduled("83101", Semester.FALL, Moed.ALEPH, date(2026, 1, 1))
        c = self._scheduled("83103", Semester.SPRING, Moed.ALEPH, date(2026, 1, 1))
        system = ExamSystem([a, b, c])
        ordered = system.sorted_by_date()
        self.assertEqual([s.course.number for s in ordered], ["83101", "83102", "83103"])

    def test_grouped_by_period_yields_semester_moed_groups_in_order(self):
        fall = self._scheduled("83101", Semester.FALL, Moed.ALEPH, date(2026, 1, 1))
        spring = self._scheduled("83102", Semester.SPRING, Moed.ALEPH, date(2026, 1, 1))
        system = ExamSystem([spring, fall])
        groups = list(system.grouped_by_period())
        self.assertEqual([key for key, _ in groups],
                         [(Semester.FALL, Moed.ALEPH), (Semester.SPRING, Moed.ALEPH)])

    def test_grouped_by_period_sorts_each_group_by_date_then_course(self):
        a = self._scheduled("83102", Semester.FALL, Moed.ALEPH, date(2026, 1, 1))
        b = self._scheduled("83101", Semester.FALL, Moed.ALEPH, date(2026, 1, 1))
        system = ExamSystem([a, b])
        _, group = list(system.grouped_by_period())[0]
        self.assertEqual([s.course.number for s in group], ["83101", "83102"])


class TestRoom(unittest.TestCase):

    def test_defaults_to_an_empty_location(self):
        self.assertEqual(Room("A", 30).location, "")

    def test_repr_includes_name_and_capacity(self):
        self.assertIn("A", repr(Room("A", 30)))
        self.assertIn("30", repr(Room("A", 30)))


class TestRoomBooking(unittest.TestCase):

    def _exam(self):
        course = Course("83101", "Intro", "Dr. A", [], Evaluation.EXAM)
        return Exam(course, Semester.FALL, Moed.ALEPH, {})

    def test_seats_sums_the_capacity_of_every_room(self):
        booking = RoomBooking(self._exam(), date(2026, 1, 1),
                              [Room("A", 20), Room("B", 30)])
        self.assertEqual(booking.seats, 50)

    def test_seats_is_zero_with_no_rooms(self):
        booking = RoomBooking(self._exam(), date(2026, 1, 1), [])
        self.assertEqual(booking.seats, 0)


class TestRoomAllocation(unittest.TestCase):

    def _exam(self, number="83101"):
        course = Course(number, "Intro", "Dr. A", [], Evaluation.EXAM)
        return Exam(course, Semester.FALL, Moed.ALEPH, {})

    def test_is_complete_true_with_no_failures(self):
        self.assertTrue(RoomAllocation({}, []).is_complete)

    def test_is_complete_false_with_failures(self):
        self.assertFalse(RoomAllocation({}, ["could not seat X"]).is_complete)

    def test_rooms_of_returns_the_booked_rooms(self):
        exam = self._exam()
        room = Room("A", 30)
        booking = RoomBooking(exam, date(2026, 1, 1), [room])
        allocation = RoomAllocation({exam.key: booking}, [])
        self.assertEqual(allocation.rooms_of(exam), [room])

    def test_rooms_of_returns_empty_list_for_an_unbooked_exam(self):
        allocation = RoomAllocation({}, [])
        self.assertEqual(allocation.rooms_of(self._exam()), [])


class TestStudyProgramCatalog(unittest.TestCase):

    def test_str_of_study_program_is_number_and_name(self):
        self.assertEqual(str(StudyProgram("83101", "Computer Science")), "83101 Computer Science")

    def test_contains_true_for_a_known_number(self):
        catalog = StudyProgramCatalog([("83101", "Computer Science")])
        self.assertTrue(catalog.contains("83101"))

    def test_contains_false_for_an_unknown_number(self):
        catalog = StudyProgramCatalog([])
        self.assertFalse(catalog.contains("83101"))

    def test_get_returns_none_for_an_unknown_number(self):
        self.assertIsNone(StudyProgramCatalog([]).get("83101"))

    def test_name_of_falls_back_to_the_number(self):
        catalog = StudyProgramCatalog([])
        self.assertEqual(catalog.name_of("83101"), "83101")

    def test_name_of_returns_the_stored_name(self):
        catalog = StudyProgramCatalog([("83101", "Computer Science")])
        self.assertEqual(catalog.name_of("83101"), "Computer Science")

    def test_numbers_lists_every_program(self):
        catalog = StudyProgramCatalog([("83101", "A"), ("83102", "B")])
        self.assertEqual(sorted(catalog.numbers()), ["83101", "83102"])

    def test_from_courses_collects_every_enrolled_program_number(self):
        enrollments = [
            ProgramEnrollment("83101", 1, Semester.FALL, Requirement.OBLIGATORY),
            ProgramEnrollment("83102", 1, Semester.FALL, Requirement.OBLIGATORY),
        ]
        course = Course("1", "C", "Dr. A", enrollments, Evaluation.EXAM)
        catalog = StudyProgramCatalog.from_courses([course])
        self.assertEqual(sorted(catalog.numbers()), ["83101", "83102"])

    def test_from_courses_names_each_program_after_its_own_number(self):
        enrollments = [ProgramEnrollment("83101", 1, Semester.FALL, Requirement.OBLIGATORY)]
        course = Course("1", "C", "Dr. A", enrollments, Evaluation.EXAM)
        catalog = StudyProgramCatalog.from_courses([course])
        self.assertEqual(catalog.name_of("83101"), "83101")

    def test_from_courses_deduplicates_a_program_shared_by_several_courses(self):
        enrollments = [ProgramEnrollment("83101", 1, Semester.FALL, Requirement.OBLIGATORY)]
        c1 = Course("1", "C1", "Dr. A", enrollments, Evaluation.EXAM)
        c2 = Course("2", "C2", "Dr. B", enrollments, Evaluation.EXAM)
        catalog = StudyProgramCatalog.from_courses([c1, c2])
        self.assertEqual(len(catalog.numbers()), 1)


class TestExcludedDates(unittest.TestCase):

    def test_end_defaults_to_start_for_a_single_day(self):
        excluded = ExcludedDates(date(2026, 1, 1))
        self.assertEqual(excluded.end, date(2026, 1, 1))

    def test_contains_true_within_the_range(self):
        excluded = ExcludedDates(date(2026, 1, 1), date(2026, 1, 5))
        self.assertTrue(excluded.contains(date(2026, 1, 3)))

    def test_contains_true_on_the_boundaries(self):
        excluded = ExcludedDates(date(2026, 1, 1), date(2026, 1, 5))
        self.assertTrue(excluded.contains(date(2026, 1, 1)))
        self.assertTrue(excluded.contains(date(2026, 1, 5)))

    def test_contains_false_outside_the_range(self):
        excluded = ExcludedDates(date(2026, 1, 1), date(2026, 1, 5))
        self.assertFalse(excluded.contains(date(2026, 1, 6)))


class TestExamPeriod(unittest.TestCase):

    def _period(self, start, end, excluded=()):
        return ExamPeriod(Semester.FALL, Moed.ALEPH, start, end, excluded)

    def test_key_is_semester_and_moed(self):
        period = self._period(date(2026, 1, 1), date(2026, 1, 5))
        self.assertEqual(period.key, (Semester.FALL, Moed.ALEPH))

    def test_available_dates_includes_every_day_with_no_exclusions(self):
        period = self._period(date(2026, 1, 1), date(2026, 1, 3))
        self.assertEqual(period.available_dates(),
                         [date(2026, 1, 1), date(2026, 1, 2), date(2026, 1, 3)])

    def test_available_dates_omits_an_excluded_day(self):
        excluded = [ExcludedDates(date(2026, 1, 2))]
        period = self._period(date(2026, 1, 1), date(2026, 1, 3), excluded)
        self.assertEqual(period.available_dates(), [date(2026, 1, 1), date(2026, 1, 3)])

    def test_available_dates_is_empty_when_the_whole_period_is_excluded(self):
        excluded = [ExcludedDates(date(2026, 1, 1), date(2026, 1, 3))]
        period = self._period(date(2026, 1, 1), date(2026, 1, 3), excluded)
        self.assertEqual(period.available_dates(), [])

    def test_available_dates_is_cached_across_calls(self):
        period = self._period(date(2026, 1, 1), date(2026, 1, 3))
        first = period.available_dates()
        period.excluded.append(ExcludedDates(date(2026, 1, 1)))
        second = period.available_dates()
        self.assertEqual(first, second)  # the cache is not invalidated by a later mutation

    def test_is_excluded_checks_every_rule(self):
        excluded = [ExcludedDates(date(2026, 1, 1)), ExcludedDates(date(2026, 1, 5))]
        period = self._period(date(2026, 1, 1), date(2026, 1, 10), excluded)
        self.assertTrue(period.is_excluded(date(2026, 1, 5)))
        self.assertFalse(period.is_excluded(date(2026, 1, 3)))

    def test_single_day_period_has_one_available_date(self):
        period = self._period(date(2026, 1, 1), date(2026, 1, 1))
        self.assertEqual(period.available_dates(), [date(2026, 1, 1)])


class TestFacultyAvailability(unittest.TestCase):

    def test_is_available_true_with_no_rules_at_all(self):
        self.assertTrue(FacultyAvailability().is_available("Dr. A", date(2026, 1, 1)))

    def test_is_available_false_on_a_blocked_date(self):
        blocked = {"Dr. A": [ExcludedDates(date(2026, 1, 1), date(2026, 1, 3))]}
        availability = FacultyAvailability(blocked)
        self.assertFalse(availability.is_available("Dr. A", date(2026, 1, 2)))

    def test_is_available_true_outside_the_blocked_range(self):
        blocked = {"Dr. A": [ExcludedDates(date(2026, 1, 1), date(2026, 1, 3))]}
        availability = FacultyAvailability(blocked)
        self.assertTrue(availability.is_available("Dr. A", date(2026, 1, 5)))

    def test_rules_do_not_apply_to_a_different_instructor(self):
        blocked = {"Dr. A": [ExcludedDates(date(2026, 1, 1))]}
        availability = FacultyAvailability(blocked)
        self.assertTrue(availability.is_available("Dr. B", date(2026, 1, 1)))

    def test_instructors_lists_every_instructor_with_a_rule(self):
        blocked = {"Dr. A": [], "Dr. B": []}
        self.assertEqual(sorted(FacultyAvailability(blocked).instructors()), ["Dr. A", "Dr. B"])

    def test_rules_of_returns_the_instructors_own_rules(self):
        rule = ExcludedDates(date(2026, 1, 1))
        availability = FacultyAvailability({"Dr. A": [rule]})
        self.assertEqual(availability.rules_of("Dr. A"), [rule])

    def test_rules_of_returns_empty_list_for_an_unknown_instructor(self):
        self.assertEqual(FacultyAvailability().rules_of("Dr. A"), [])

    def test_blocking_rule_returns_the_rule_that_matches(self):
        rule = ExcludedDates(date(2026, 1, 1), date(2026, 1, 3))
        availability = FacultyAvailability({"Dr. A": [rule]})
        self.assertIs(availability.blocking_rule("Dr. A", date(2026, 1, 2)), rule)

    def test_blocking_rule_returns_none_when_nothing_matches(self):
        availability = FacultyAvailability({"Dr. A": [ExcludedDates(date(2026, 1, 1))]})
        self.assertIsNone(availability.blocking_rule("Dr. A", date(2026, 1, 5)))

    def test_dates_for_exam_returns_every_date_for_an_unblocked_instructor(self):
        course = Course("83101", "Intro", "Dr. A", [], Evaluation.EXAM)
        exam = Exam(course, Semester.FALL, Moed.ALEPH, {})
        dates = [date(2026, 1, 1), date(2026, 1, 2)]
        self.assertEqual(FacultyAvailability().dates_for_exam(exam, dates), dates)

    def test_dates_for_exam_filters_out_blocked_dates(self):
        course = Course("83101", "Intro", "Dr. A", [], Evaluation.EXAM)
        exam = Exam(course, Semester.FALL, Moed.ALEPH, {})
        blocked = {"Dr. A": [ExcludedDates(date(2026, 1, 1))]}
        availability = FacultyAvailability(blocked)
        dates = [date(2026, 1, 1), date(2026, 1, 2)]
        self.assertEqual(availability.dates_for_exam(exam, dates), [date(2026, 1, 2)])

    def test_len_counts_the_number_of_instructors_with_rules(self):
        self.assertEqual(len(FacultyAvailability({"Dr. A": [], "Dr. B": []})), 2)

    def test_len_is_zero_with_no_rules(self):
        self.assertEqual(len(FacultyAvailability()), 0)


if __name__ == "__main__":
    unittest.main()
