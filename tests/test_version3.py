"""Tests of version 3.0: the thresholds, the sorting, and the new modules."""

import io
import os
import shutil
import sys
import tempfile
import unittest
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from schedule_forge.data_io.courses_parser import CoursesParser
from schedule_forge.data_io.errors import DataFileError
from schedule_forge.data_io.faculty_parser import FacultyConstraintsParser
from schedule_forge.data_io.ics_writer import CalendarExporter
from schedule_forge.data_io.rooms_parser import RoomsParser
from schedule_forge.data_io.settings_parser import SettingsParser
from schedule_forge.model.course import Course, ProgramEnrollment
from schedule_forge.model.enums import Evaluation, Moed, Requirement, Semester
from schedule_forge.model.exam import Exam, ExamSystem, ScheduledExam
from schedule_forge.model.availability import FacultyAvailability
from schedule_forge.model.exam_period import ExamPeriod, ExcludedDates
from schedule_forge.model.room import Room
from schedule_forge.scheduling.constraints import constraints_for
from schedule_forge.scheduling.generator import ExamSystemGenerator
from schedule_forge.scheduling.partial import PartialThresholdChecker
from schedule_forge.scheduling.quality import SystemEvaluator
from schedule_forge.scheduling.rooms import RoomAllocator
from schedule_forge.scheduling.search import CandidateSearch, SearchReport
from schedule_forge.settings import SchedulingSettings, SettingsError

FIRST = date(2026, 1, 29)
OBLIGATORY = Requirement.OBLIGATORY
ELECTIVE = Requirement.ELECTIVE


def course(number, instructor=None, students=None):
    # A distinct instructor per course number by default, not one name shared
    # by every course the tests build: since version 3.0 the engine refuses
    # to schedule two exams of the same instructor on the same date, and a
    # test that is not itself about that rule should not trip over it just
    # because two unrelated exams happened to share the placeholder name.
    return Course(number, "Course " + number, instructor or "Dr. " + number,
                  [], Evaluation.EXAM, students)


def exam(number, slots, instructor=None, students=None,
         semester=Semester.FALL, moed=Moed.ALEPH):
    return Exam(course(number, instructor, students), semester, moed, slots)


def period(days, semester=Semester.FALL, moed=Moed.ALEPH, first=FIRST):
    return {(semester, moed):
            ExamPeriod(semester, moed, first, first + timedelta(days=days - 1))}


def settings(**values):
    values.setdefault("max_candidates", 200)
    values.setdefault("time_limit_seconds", 10)
    return SchedulingSettings(**values)


def run_search(exams, periods, options, rooms=(), availability=None):
    generator = ExamSystemGenerator(exams, periods, constraints_for(options),
                                    availability)
    allocator = RoomAllocator(rooms, options.default_students) if rooms else None
    pruner = PartialThresholdChecker(
        exams, generator.depth_of_position(), options,
        allocator.total_capacity if allocator is not None else None,
        options.default_students)
    generator.pruner = pruner if pruner.is_needed else None
    search = CandidateSearch(generator, SystemEvaluator(options, allocator),
                             options, allocator)
    search.run()
    return search


def dates_of(system):
    return dict((scheduled.exam.course.number, scheduled.date)
                for scheduled in system.scheduled_exams)


class FileTestCase(unittest.TestCase):

    def setUp(self):
        self.directory = tempfile.mkdtemp(prefix="scheduleforge_v3_")

    def tearDown(self):
        shutil.rmtree(self.directory, ignore_errors=True)

    def write(self, name, text):
        path = os.path.join(self.directory, name)
        with io.open(path, "w", encoding="utf-8") as handle:
            handle.write(text)
        return path


class TestNewDataFiles(FileTestCase):

    def test_reads_the_rooms_file(self):
        path = self.write("rooms.txt",
                          "$$$$\nHall A\n250\nBuilding 1\n$$$$\nRoom B\n40\n")
        rooms = RoomsParser(path).parse()

        self.assertEqual(["Hall A", "Room B"], [room.name for room in rooms])
        self.assertEqual([250, 40], [room.capacity for room in rooms])
        self.assertEqual("Building 1", rooms[0].location)

    def test_rejects_a_room_without_a_number_for_a_capacity(self):
        path = self.write("rooms.txt", "$$$$\nHall A\nmany\n")
        self.assertRaises(DataFileError, RoomsParser(path).parse)

    def test_reads_the_staff_constraints_file(self):
        path = self.write("staff.txt",
                          "$$$$\nProf. O. Some\n02-02-2026 Conference\n"
                          "09-02-2026, 11-02-2026 Abroad\n")
        availability = FacultyConstraintsParser(path).parse()

        self.assertFalse(availability.is_available("Prof. O. Some", date(2026, 2, 2)))
        self.assertFalse(availability.is_available("Prof. O. Some", date(2026, 2, 10)))
        self.assertTrue(availability.is_available("Prof. O. Some", date(2026, 2, 3)))
        self.assertTrue(availability.is_available("Dr. A. Levi", date(2026, 2, 2)))

    def test_reads_a_course_that_states_how_many_students_it_has(self):
        path = self.write("courses.txt", "$$$$\nPhysics\n83102\nProf. O\n"
                                         "83101,1,FALL,Obligatory\nExam\n220\n")
        courses = CoursesParser(path).parse()

        self.assertEqual(220, courses[0].students)
        self.assertEqual(220, courses[0].students_or(30))

    def test_a_course_without_a_number_of_students_falls_back_to_the_default(self):
        path = self.write("courses.txt", "$$$$\nPhysics\n83102\nProf. O\n"
                                         "83101,1,FALL,Obligatory\nExam\n")
        courses = CoursesParser(path).parse()

        self.assertIsNone(courses[0].students)
        self.assertEqual(30, courses[0].students_or(30))

    def test_reads_the_settings_file(self):
        path = self.write("settings.txt",
                          "# a comment\nmin_days_between_obligatory = 3\n"
                          "require_rooms = yes\n"
                          "sort = max_exams_per_day, elective_collisions\n")
        options = SettingsParser(path).parse()

        self.assertEqual(3, options.min_days_between_obligatory)
        self.assertTrue(options.require_rooms)
        self.assertEqual(["max_exams_per_day", "elective_collisions"],
                         options.sort_criteria)
        self.assertIsNone(options.max_exams_per_day)

    def test_rejects_an_unknown_setting_and_an_unknown_criterion(self):
        unknown = self.write("a.txt", "colour = blue\n")
        self.assertRaises(DataFileError, SettingsParser(unknown).parse)
        criterion = self.write("b.txt", "sort = by_the_moon\n")
        self.assertRaises(DataFileError, SettingsParser(criterion).parse)

    def test_rejects_a_threshold_that_is_not_a_positive_number(self):
        self.assertRaises(SettingsError, SchedulingSettings,
                          min_days_between_obligatory=0)


class TestPairwiseThresholds(unittest.TestCase):
    """2.1 and 2.2 - the generator never builds a system that breaks them."""

    def test_keeps_the_days_between_two_obligatory_exams(self):
        exams = [exam("83112", {("83101", 1): OBLIGATORY}),
                 exam("83113", {("83101", 1): OBLIGATORY}),
                 exam("83114", {("83101", 1): ELECTIVE})]
        search = run_search(exams, period(10),
                            settings(min_days_between_obligatory=4))

        self.assertTrue(search.candidates)
        for candidate in search.candidates:
            placed = dates_of(candidate.system)
            self.assertGreaterEqual(
                abs((placed["83112"] - placed["83113"]).days), 4)

    def test_the_elective_exam_is_only_kept_off_the_same_date(self):
        """2.1 speaks of obligatory courses, so an elective may sit next to one."""
        exams = [exam("83112", {("83101", 1): OBLIGATORY}),
                 exam("83114", {("83101", 1): ELECTIVE})]
        search = run_search(exams, period(6),
                            settings(min_days_between_obligatory=4))

        gaps = set()
        for candidate in search.candidates:
            placed = dates_of(candidate.system)
            gaps.add(abs((placed["83112"] - placed["83114"]).days))
        self.assertIn(1, gaps)
        self.assertNotIn(0, gaps)

    def test_keeps_the_days_between_any_two_exams_of_a_year(self):
        exams = [exam("83112", {("83101", 1): ELECTIVE}),
                 exam("83113", {("83101", 1): ELECTIVE})]
        search = run_search(exams, period(10), settings(min_days_between_any=3))

        self.assertTrue(search.candidates)
        for candidate in search.candidates:
            placed = dates_of(candidate.system)
            self.assertGreaterEqual(
                abs((placed["83112"] - placed["83113"]).days), 3)

    def test_a_threshold_that_cannot_be_met_produces_nothing(self):
        exams = [exam("83112", {("83101", 1): OBLIGATORY}),
                 exam("83113", {("83101", 1): OBLIGATORY})]
        search = run_search(exams, period(3),
                            settings(min_days_between_obligatory=5))

        self.assertEqual([], search.candidates)

    def test_the_days_are_counted_across_a_weekend(self):
        """The count includes Saturdays, so an excluded date is still a day."""
        periods = period(10)
        saturday = FIRST + timedelta(days=1)
        periods[(Semester.FALL, Moed.ALEPH)].excluded.append(
            ExcludedDates(saturday, saturday, "Saturday"))
        exams = [exam("83112", {("83101", 1): OBLIGATORY}),
                 exam("83113", {("83101", 1): OBLIGATORY})]
        search = run_search(exams, periods, settings(min_days_between_obligatory=2))

        for candidate in search.candidates:
            placed = dates_of(candidate.system)
            self.assertGreaterEqual(
                abs((placed["83112"] - placed["83113"]).days), 2)


class TestInstructorConflict(unittest.TestCase):
    """The same instructor never gives two exams on the same date.

    Unconditional, like the rule of version 1.0 - `run_search` always goes
    through `constraints_for`, so no setting has to be turned on for it.
    """

    def test_keeps_the_same_instructors_exams_apart(self):
        # Two different programs and years, on purpose: nothing about the
        # rule of version 1.0 would keep these two exams apart on its own.
        exams = [exam("83112", {("83101", 1): OBLIGATORY}, instructor="Dr. Levi"),
                 exam("83116", {("83108", 2): OBLIGATORY}, instructor="Dr. Levi")]
        search = run_search(exams, period(10), settings())

        self.assertTrue(search.candidates)
        for candidate in search.candidates:
            placed = dates_of(candidate.system)
            self.assertNotEqual(placed["83112"], placed["83116"])

    def test_does_not_restrict_two_different_instructors(self):
        """The rule is about one instructor, not exams in general."""
        exams = [exam("83112", {("83101", 1): OBLIGATORY}, instructor="Dr. Levi"),
                 exam("83116", {("83108", 2): OBLIGATORY}, instructor="Dr. Cohen")]
        search = run_search(exams, period(10), settings())

        same_date = any(
            dates_of(candidate.system)["83112"] == dates_of(candidate.system)["83116"]
            for candidate in search.candidates)
        self.assertTrue(same_date)


class TestAggregateThresholds(unittest.TestCase):
    """2.3, 2.4 and 2.5 - counts over a whole exam system."""

    def test_limits_the_number_of_exams_on_one_day(self):
        exams = [exam("8311%d" % index, {("8310%d" % index, 1): OBLIGATORY})
                 for index in range(4)]
        search = run_search(exams, period(2), settings(max_exams_per_day=2))

        self.assertTrue(search.candidates)
        for candidate in search.candidates:
            self.assertLessEqual(candidate.metrics.max_exams_per_day, 2)

    def test_limits_the_collisions_between_elective_courses(self):
        exams = [exam("83112", {("83101", 1): ELECTIVE}),
                 exam("83113", {("83101", 2): ELECTIVE}),
                 exam("83114", {("83101", 3): ELECTIVE})]
        search = run_search(exams, period(2), settings(max_elective_collisions=1))

        self.assertTrue(search.candidates)
        for candidate in search.candidates:
            self.assertLessEqual(candidate.metrics.worst_program_collisions, 1)

    def test_keeps_the_obligatory_exams_of_a_year_far_enough_apart(self):
        exams = [exam("83112", {("83101", 1): OBLIGATORY}),
                 exam("83113", {("83101", 1): OBLIGATORY})]
        search = run_search(exams, period(10), settings(min_obligatory_span=6))

        self.assertTrue(search.candidates)
        for candidate in search.candidates:
            placed = dates_of(candidate.system)
            self.assertGreaterEqual(
                abs((placed["83112"] - placed["83113"]).days), 6)

    def test_an_early_group_is_moved_and_not_only_the_last_one(self):
        """The walk has to reconsider the exams it placed first.

        Two independent pairs, each of which alone would break 2.5 if both of
        its exams share a date; a check that only ran on finished systems would
        leave the first pair where it was and never find a system at all.
        """
        exams = [exam("83112", {("83101", 1): OBLIGATORY}),
                 exam("83113", {("83102", 1): OBLIGATORY}),
                 exam("83114", {("83103", 1): OBLIGATORY}),
                 exam("83115", {("83104", 1): OBLIGATORY})]
        search = run_search(exams, period(4), settings(max_exams_per_day=1))

        self.assertTrue(search.candidates)
        for candidate in search.candidates:
            placed = list(dates_of(candidate.system).values())
            self.assertEqual(len(placed), len(set(placed)))


class TestFacultyConstraints(unittest.TestCase):

    def test_no_exam_is_placed_on_a_day_its_instructor_is_away(self):
        away = FacultyAvailability({
            "Prof. Away": [ExcludedDates(FIRST, FIRST + timedelta(days=2), "away")]})
        exams = [exam("83112", {("83101", 1): OBLIGATORY}, instructor="Prof. Away"),
                 exam("83113", {("83102", 1): OBLIGATORY}, instructor="Dr. Here")]
        search = run_search(exams, period(5), settings(), availability=away)

        self.assertTrue(search.candidates)
        seen_for_present = set()
        for candidate in search.candidates:
            placed = dates_of(candidate.system)
            self.assertGreater(placed["83112"], FIRST + timedelta(days=2))
            seen_for_present.add(placed["83113"])
        self.assertIn(FIRST, seen_for_present)

    def test_the_exact_count_still_holds_with_a_staff_constraint(self):
        away = FacultyAvailability({
            "Prof. Away": [ExcludedDates(FIRST, FIRST, "away")]})
        exams = [exam("83112", {("83101", 1): OBLIGATORY}, instructor="Prof. Away")]
        generator = ExamSystemGenerator(exams, period(5), None, away)

        self.assertEqual(4, generator.total_systems())
        self.assertEqual(4, sum(1 for _ in generator.generate()))


class TestRoomAllocation(unittest.TestCase):

    def _one_day_system(self, exams):
        search = run_search(exams, period(1), settings())
        return search

    def test_every_exam_of_a_day_gets_a_room_of_its_own(self):
        rooms = [Room("Big", 200), Room("Small", 50)]
        exams = [exam("83112", {("83101", 1): OBLIGATORY}, students=150),
                 exam("83113", {("83102", 1): OBLIGATORY}, students=40)]
        search = run_search(exams, period(1), settings(), rooms)

        allocation = search.candidates[0].allocation
        self.assertTrue(allocation.is_complete)
        names = [room.name for exam_key in allocation.bookings
                 for room in allocation.bookings[exam_key].rooms]
        self.assertEqual(sorted(names), ["Big", "Small"])

    def test_an_exam_larger_than_a_room_is_spread_over_several(self):
        rooms = [Room("A", 100), Room("B", 100)]
        exams = [exam("83112", {("83101", 1): OBLIGATORY}, students=150)]
        search = run_search(exams, period(1), settings(), rooms)

        booking = search.candidates[0].allocation.bookings[exams[0].key]
        self.assertEqual(2, len(booking.rooms))
        self.assertGreaterEqual(booking.seats, 150)

    def test_a_day_without_enough_seats_is_reported(self):
        rooms = [Room("Small", 30)]
        exams = [exam("83112", {("83101", 1): OBLIGATORY}, students=100)]
        allocation = RoomAllocator(rooms).allocate(
            run_search(exams, period(1), settings()).candidates[0].system)

        self.assertFalse(allocation.is_complete)
        self.assertIn("needs 100 seats", allocation.failures[0])

    def test_require_rooms_throws_away_the_systems_that_do_not_fit(self):
        rooms = [Room("Only", 100)]
        exams = [exam("83112", {("83101", 1): OBLIGATORY}, students=80),
                 exam("83113", {("83102", 1): OBLIGATORY}, students=80)]
        search = run_search(exams, period(3), settings(require_rooms=True), rooms)

        self.assertTrue(search.candidates)
        for candidate in search.candidates:
            placed = dates_of(candidate.system)
            self.assertNotEqual(placed["83112"], placed["83113"])
            self.assertTrue(candidate.allocation.is_complete)


class TestSorting(unittest.TestCase):
    """Requirement 3 - the criteria, and the order the user puts them in."""

    def _exams(self):
        return [exam("83112", {("83101", 1): OBLIGATORY}),
                exam("83113", {("83101", 1): OBLIGATORY})]

    def test_sorts_by_the_gap_between_obligatory_exams(self):
        search = run_search(self._exams(), period(6),
                            settings(sort_criteria=["min_days_between_obligatory"]))

        values = [candidate.metrics.min_days_between_obligatory
                  for candidate in search.candidates]
        self.assertEqual(values, sorted(values, reverse=True))
        self.assertEqual(5, values[0])

    def test_sorts_again_when_the_user_changes_the_criteria(self):
        search = run_search(self._exams(), period(6),
                            settings(sort_criteria=["min_days_between_obligatory"]))
        widest = search.candidates[0].metrics.min_days_between_obligatory

        search.sort_by(["average_days_between_exams"])
        values = [candidate.metrics.average_days_between_exams
                  for candidate in search.candidates]
        self.assertEqual(values, sorted(values, reverse=True))
        self.assertEqual(float(widest), values[0])

    def test_the_second_criterion_breaks_the_ties_of_the_first(self):
        exams = [exam("83112", {("83101", 1): OBLIGATORY}),
                 exam("83113", {("83101", 1): OBLIGATORY}),
                 exam("83114", {("83102", 1): ELECTIVE}),
                 exam("83115", {("83102", 1): ELECTIVE})]
        search = run_search(exams, period(4), settings(
            sort_criteria=["min_days_between_obligatory", "elective_collisions"]))

        # min_days_between_obligatory: a wider gap is better (descending).
        gaps = [candidate.metrics.min_days_between_obligatory
               for candidate in search.candidates]
        self.assertEqual(gaps, sorted(gaps, reverse=True))

        # elective_collisions: fewer collisions is better (ascending), and only
        # has to hold among the candidates that tie on the first criterion.
        by_gap = {}
        for candidate in search.candidates:
            by_gap.setdefault(candidate.metrics.min_days_between_obligatory, []).append(
                candidate.metrics.elective_collisions)
        for collisions in by_gap.values():
            self.assertEqual(collisions, sorted(collisions))

        # And the whole list is exactly what sort_key (ascending) says it is.
        keys = [search.evaluator.sort_key(candidate.metrics)
               for candidate in search.candidates]
        self.assertEqual(keys, sorted(keys))


class TestBestKSelection(unittest.TestCase):
    """The search keeps the best `max_candidates` systems, not the first ones.

    Confirmed against a brute force reference: every legal system is listed by
    hand, and the best K of that list - by the very same criterion - is what
    the search is expected to keep.
    """

    def _brute_force_gaps(self, periods):
        """Every legal (date, date) pair of the two obligatory exams, as gaps."""
        only = periods[(Semester.FALL, Moed.ALEPH)]
        dates = only.available_dates()
        gaps = []
        for first in dates:
            for second in dates:
                if first != second:
                    gaps.append(abs((first - second).days))
        return gaps

    def test_keeps_the_widest_gaps_out_of_every_legal_system(self):
        exams = [exam("83112", {("83101", 1): OBLIGATORY}),
                 exam("83113", {("83101", 1): OBLIGATORY})]
        periods = period(10)
        search = run_search(exams, periods, settings(
            max_candidates=5, sort_criteria=["min_days_between_obligatory"]))

        got = sorted((candidate.metrics.min_days_between_obligatory
                     for candidate in search.candidates), reverse=True)
        expected = sorted(self._brute_force_gaps(periods), reverse=True)[:5]

        self.assertEqual(5, len(search.candidates))
        self.assertEqual(expected, got)
        # The widest gap of all (period spans 10 days, 0-indexed) is 9.
        self.assertEqual(9, got[0])

    def test_keeps_the_fewest_collisions_when_smaller_is_better(self):
        """elective_collisions is a "smaller is better" criterion (fewer
        collisions is preferred) - checked against a from-scratch brute force
        enumeration of every legal placement of three freely movable electives,
        using the very same `measure` the search itself uses, so the reference
        is independent of the search's own bookkeeping but not of a hand
        reimplementation of the collision formula."""
        exams = [exam("83112", {("83101", 1): ELECTIVE}),
                 exam("83113", {("83101", 1): ELECTIVE}),
                 exam("83114", {("83101", 1): ELECTIVE})]
        periods = period(3)
        evaluator = SystemEvaluator(settings(), None)
        dates = periods[(Semester.FALL, Moed.ALEPH)].available_dates()
        brute_force = []
        for first in dates:
            for second in dates:
                for third in dates:
                    system = ExamSystem([
                        ScheduledExam(exams[0], first),
                        ScheduledExam(exams[1], second),
                        ScheduledExam(exams[2], third),
                    ])
                    brute_force.append(evaluator.measure(system).elective_collisions)

        search = run_search(exams, periods, settings(
            max_candidates=5, sort_criteria=["elective_collisions"]))

        got = sorted(candidate.metrics.elective_collisions
                    for candidate in search.candidates)
        expected = sorted(brute_force)[:5]
        self.assertEqual(expected, got)
        self.assertEqual(0, got[0])  # some placement avoids every collision

    def test_examines_far_more_systems_than_it_keeps(self):
        """The whole point: the search does not stop once it has filled the
        quota, it keeps looking for a better system until its budget runs out."""
        exams = [exam("83112", {("83101", 1): OBLIGATORY}),
                 exam("83113", {("83101", 1): OBLIGATORY})]
        search = run_search(exams, period(10), settings(
            max_candidates=5, sort_criteria=["min_days_between_obligatory"]))

        self.assertEqual(5, len(search.candidates))
        self.assertGreater(search.report.accepted, 5)
        self.assertEqual(SearchReport.COMPLETE, search.report.status)

    def test_without_a_criterion_keeps_the_first_ones_found_instead(self):
        """"Best" has no meaning without a criterion, so the fallback is
        exactly what version 3.0 always did: the first ones that pass."""
        exams = [exam("83112", {("83101", 1): OBLIGATORY}),
                 exam("83113", {("83101", 1): OBLIGATORY})]
        search = run_search(exams, period(10),
                            settings(max_candidates=5, sort_criteria=[]))

        self.assertEqual(5, len(search.candidates))
        self.assertEqual(SearchReport.ENOUGH, search.report.status)


class TestCalendarExport(unittest.TestCase):

    def test_writes_one_calendar_per_program_and_year(self):
        exams = [exam("83112", {("83101", 1): OBLIGATORY, ("83108", 2): ELECTIVE}),
                 exam("83113", {("83101", 1): OBLIGATORY})]
        search = run_search(exams, period(4), settings())
        calendars = CalendarExporter().calendars_of(search.candidates[0].system,
                                                    ["83101", "83108"])

        self.assertEqual([("83101", 1), ("83108", 2)], sorted(calendars))
        text = calendars[("83101", 1)]
        self.assertTrue(text.startswith("BEGIN:VCALENDAR"))
        self.assertTrue(text.rstrip().endswith("END:VCALENDAR"))
        self.assertEqual(2, text.count("BEGIN:VEVENT"))
        self.assertIn("DTSTART;VALUE=DATE:20260129", text)
        self.assertEqual(1, text.count("UID:83112-ALEPH-83101-1@scheduleforge"))

    def test_a_calendar_holds_only_the_exams_of_that_program_and_year(self):
        exams = [exam("83112", {("83101", 1): OBLIGATORY}),
                 exam("83113", {("83102", 1): OBLIGATORY})]
        search = run_search(exams, period(4), settings())
        calendars = CalendarExporter().calendars_of(search.candidates[0].system,
                                                    ["83101"])

        self.assertEqual([("83101", 1)], sorted(calendars))
        self.assertIn("83112", calendars[("83101", 1)])
        self.assertNotIn("83113", calendars[("83101", 1)])

    def test_the_lines_of_a_calendar_are_folded_and_escaped(self):
        exams = [exam("83112", {("83101", 1): OBLIGATORY})]
        search = run_search(exams, period(2), settings())
        text = CalendarExporter().calendars_of(search.candidates[0].system,
                                               ["83101"])[("83101", 1)]

        for line in text.split("\r\n"):
            self.assertLessEqual(len(line.encode("utf-8")), 75)
        unfolded = text.replace("\r\n ", "")
        self.assertIn("FALL\\, moed Aleph", unfolded)


class TestMetrics(unittest.TestCase):

    def test_measures_a_system_that_can_be_checked_by_hand(self):
        exams = [exam("83112", {("83101", 1): OBLIGATORY}),
                 exam("83113", {("83101", 1): OBLIGATORY}),
                 exam("83114", {("83101", 1): ELECTIVE})]
        search = run_search(exams, period(8),
                            settings(sort_criteria=["min_days_between_obligatory"]))
        best = search.candidates[0]
        placed = dates_of(best.system)

        metrics = best.metrics
        self.assertEqual(abs((placed["83112"] - placed["83113"]).days),
                         metrics.min_days_between_obligatory)
        self.assertEqual(abs((placed["83112"] - placed["83113"]).days),
                         metrics.obligatory_span)
        self.assertEqual(1, metrics.max_exams_per_day)
        self.assertEqual(0, metrics.elective_collisions)


if __name__ == "__main__":
    unittest.main()
