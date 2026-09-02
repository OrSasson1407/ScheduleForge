"""Tests of schedule_forge.data_io.exam_system_writer.ExamSystemWriter."""

import io
import os
import shutil
import sys
import tempfile
import unittest
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from schedule_forge.data_io.exam_system_writer import ExamSystemWriter
from schedule_forge.model.course import Course, ProgramEnrollment
from schedule_forge.model.enums import Evaluation, Moed, Requirement, Semester
from schedule_forge.model.exam import Exam, ExamSystem, ScheduledExam
from schedule_forge.model.room import Room, RoomAllocation, RoomBooking
from schedule_forge.model.study_program import StudyProgramCatalog
from schedule_forge.scheduling.search import Candidate, SearchReport
from schedule_forge.settings import SchedulingSettings


def course(number, instructor=None):
    return Course(number, "Course " + number, instructor or "Dr. " + number, [],
                  Evaluation.EXAM)


def exam(number, slots, instructor=None, semester=Semester.FALL, moed=Moed.ALEPH):
    return Exam(course(number, instructor), semester, moed, slots)


def candidate(system, metrics=None, allocation=None):
    return Candidate(system, metrics, allocation)


class FakeMetrics(object):
    def __init__(self, text="metrics summary"):
        self.text = text

    def describe(self):
        return self.text


def report():
    r = SearchReport()
    r.examined = 1
    r.accepted = 1
    r.status = SearchReport.COMPLETE
    r.seconds = 0.01
    r.total_systems = 1
    return r


class ExamSystemWriterTestCase(unittest.TestCase):

    def setUp(self):
        self.directory = tempfile.mkdtemp()
        self.path = os.path.join(self.directory, "output.txt")

    def tearDown(self):
        shutil.rmtree(self.directory, ignore_errors=True)

    def read(self):
        with io.open(self.path, "r", encoding="utf-8") as handle:
            return handle.read()


class TestWrite(ExamSystemWriterTestCase):

    def test_returns_the_number_of_candidates_written(self):
        e = exam("83101", {("83101", 1): Requirement.OBLIGATORY})
        system = ExamSystem([ScheduledExam(e, date(2026, 1, 1))])
        writer = ExamSystemWriter(self.path)
        written = writer.write([candidate(system)], ["83101"], [e], report)
        self.assertEqual(written, 1)

    def test_writes_zero_candidates_for_an_empty_list(self):
        writer = ExamSystemWriter(self.path)
        written = writer.write([], ["83101"], [], report)
        self.assertEqual(written, 0)

    def test_writes_several_candidates_with_increasing_numbers(self):
        e = exam("83101", {("83101", 1): Requirement.OBLIGATORY})
        system1 = ExamSystem([ScheduledExam(e, date(2026, 1, 1))])
        system2 = ExamSystem([ScheduledExam(e, date(2026, 1, 2))])
        writer = ExamSystemWriter(self.path)
        writer.write([candidate(system1), candidate(system2)], ["83101"], [e], report)
        text = self.read()
        self.assertIn("EXAM SYSTEM #1", text)
        self.assertIn("EXAM SYSTEM #2", text)

    def test_creates_the_parent_directory_if_missing(self):
        nested = os.path.join(self.directory, "nested", "deep", "output.txt")
        writer = ExamSystemWriter(nested)
        writer.write([], ["83101"], [], report)
        self.assertTrue(os.path.isfile(nested))

    def test_header_names_the_selected_programs_and_their_count(self):
        writer = ExamSystemWriter(self.path)
        writer.write([], ["83101", "83102"], [], report)
        text = self.read()
        self.assertIn("Selected study programs (2):", text)
        self.assertIn("83101", text)
        self.assertIn("83102", text)

    def test_header_uses_the_catalog_name_when_given(self):
        catalog = StudyProgramCatalog([("83101", "Computer Science")])
        writer = ExamSystemWriter(self.path, catalog)
        writer.write([], ["83101"], [], report)
        text = self.read()
        self.assertIn("83101 Computer Science", text)

    def test_header_falls_back_to_the_number_with_no_catalog(self):
        writer = ExamSystemWriter(self.path)
        writer.write([], ["83101"], [], report)
        text = self.read()
        self.assertIn("83101 \n", text)

    def test_header_counts_the_exams_to_schedule(self):
        e = exam("83101", {("83101", 1): Requirement.OBLIGATORY})
        writer = ExamSystemWriter(self.path)
        writer.write([], ["83101"], [e], report)
        text = self.read()
        self.assertIn("Exams to schedule: 1", text)

    def test_header_includes_total_systems_when_given(self):
        writer = ExamSystemWriter(self.path)
        writer.write([], ["83101"], [], report, total_systems=1234)
        text = self.read()
        self.assertIn("1,234", text)

    def test_header_omits_total_systems_when_not_given(self):
        writer = ExamSystemWriter(self.path)
        writer.write([], ["83101"], [], report)
        text = self.read()
        self.assertNotIn("without the threshold", text)

    def test_header_says_none_when_no_thresholds_are_active(self):
        writer = ExamSystemWriter(self.path)
        writer.write([], ["83101"], [], report, settings=SchedulingSettings())
        text = self.read()
        self.assertIn("Threshold requirements: none", text)

    def test_header_lists_active_thresholds(self):
        settings = SchedulingSettings(min_days_between_obligatory=3)
        writer = ExamSystemWriter(self.path)
        writer.write([], ["83101"], [], report, settings=settings)
        text = self.read()
        self.assertIn("2.1 at least 3 days", text)

    def test_header_lists_the_sorting_criteria_in_order(self):
        settings = SchedulingSettings(sort_criteria=["elective_collisions",
                                                      "max_exams_per_day"])
        writer = ExamSystemWriter(self.path)
        writer.write([], ["83101"], [], report, settings=settings)
        text = self.read()
        self.assertIn("1. 3.3", text)
        self.assertIn("2. 3.5", text)

    def test_header_says_nothing_when_sorting_is_off(self):
        settings = SchedulingSettings(sort_criteria=[])
        writer = ExamSystemWriter(self.path)
        writer.write([], ["83101"], [], report, settings=settings)
        text = self.read()
        self.assertIn("Sorted by: nothing", text)

    def test_block_header_names_the_semester_and_moed(self):
        e = exam("83101", {("83101", 1): Requirement.OBLIGATORY},
                 semester=Semester.FALL, moed=Moed.ALEPH)
        system = ExamSystem([ScheduledExam(e, date(2026, 1, 1))])
        writer = ExamSystemWriter(self.path)
        writer.write([candidate(system)], ["83101"], [e], report)
        text = self.read()
        self.assertIn("FALL, moed Aleph", text)

    def test_exam_line_includes_date_course_and_instructor(self):
        e = exam("83101", {("83101", 1): Requirement.OBLIGATORY}, instructor="Dr. Smith")
        system = ExamSystem([ScheduledExam(e, date(2026, 1, 29))])
        writer = ExamSystemWriter(self.path)
        writer.write([candidate(system)], ["83101"], [e], report)
        text = self.read()
        self.assertIn("29-01-2026", text)
        self.assertIn("83101", text)
        self.assertIn("Dr. Smith", text)

    def test_blocks_are_ordered_by_semester_then_moed(self):
        fall = exam("83101", {("83101", 1): Requirement.OBLIGATORY}, semester=Semester.FALL)
        spring = exam("83102", {("83101", 1): Requirement.OBLIGATORY}, semester=Semester.SPRING)
        system = ExamSystem([ScheduledExam(spring, date(2026, 6, 1)),
                             ScheduledExam(fall, date(2026, 1, 1))])
        writer = ExamSystemWriter(self.path)
        writer.write([candidate(system)], ["83101"], [fall, spring], report)
        text = self.read()
        self.assertLess(text.index("FALL"), text.index("SPRING"))

    def test_metrics_line_is_included_when_given(self):
        e = exam("83101", {("83101", 1): Requirement.OBLIGATORY})
        system = ExamSystem([ScheduledExam(e, date(2026, 1, 1))])
        writer = ExamSystemWriter(self.path)
        writer.write([candidate(system, FakeMetrics("my metrics line"))], ["83101"], [e], report)
        text = self.read()
        self.assertIn("my metrics line", text)

    def test_metrics_line_is_omitted_when_none(self):
        e = exam("83101", {("83101", 1): Requirement.OBLIGATORY})
        system = ExamSystem([ScheduledExam(e, date(2026, 1, 1))])
        writer = ExamSystemWriter(self.path)
        writer.write([candidate(system, None)], ["83101"], [e], report)
        text = self.read()
        self.assertNotIn("metrics summary", text)

    def test_without_rooms_the_table_has_no_rooms_column(self):
        e = exam("83101", {("83101", 1): Requirement.OBLIGATORY})
        system = ExamSystem([ScheduledExam(e, date(2026, 1, 1))])
        writer = ExamSystemWriter(self.path)
        writer.write([candidate(system)], ["83101"], [e], report)
        text = self.read()
        self.assertNotIn("ROOMS", text)

    def test_with_rooms_the_table_has_a_rooms_column_and_room_names(self):
        e = exam("83101", {("83101", 1): Requirement.OBLIGATORY})
        scheduled = ScheduledExam(e, date(2026, 1, 1))
        system = ExamSystem([scheduled])
        room = Room("Hall A", 100)
        allocation = RoomAllocation({e.key: RoomBooking(e, scheduled.date, [room])}, [])
        writer = ExamSystemWriter(self.path)
        writer.write([candidate(system, allocation=allocation)], ["83101"], [e], report)
        text = self.read()
        self.assertIn("ROOMS", text)
        self.assertIn("Hall A", text)

    def test_an_exam_with_no_booked_room_shows_a_dash(self):
        e = exam("83101", {("83101", 1): Requirement.OBLIGATORY})
        scheduled = ScheduledExam(e, date(2026, 1, 1))
        system = ExamSystem([scheduled])
        allocation = RoomAllocation({}, ["83101 could not be seated"])
        writer = ExamSystemWriter(self.path)
        writer.write([candidate(system, allocation=allocation)], ["83101"], [e], report)
        text = self.read()
        line = next(l for l in text.splitlines() if "83101" in l and "01-01-2026" in l)
        self.assertTrue(line.rstrip().endswith("-"))

    def test_reports_a_room_failure_count_when_allocation_is_incomplete(self):
        e = exam("83101", {("83101", 1): Requirement.OBLIGATORY})
        scheduled = ScheduledExam(e, date(2026, 1, 1))
        system = ExamSystem([scheduled])
        allocation = RoomAllocation({}, ["83101 could not be seated"])
        writer = ExamSystemWriter(self.path)
        writer.write([candidate(system, allocation=allocation)], ["83101"], [e], report)
        text = self.read()
        self.assertIn("1 exam(s) could not be seated", text)

    def test_does_not_report_a_room_failure_when_allocation_is_complete(self):
        e = exam("83101", {("83101", 1): Requirement.OBLIGATORY})
        scheduled = ScheduledExam(e, date(2026, 1, 1))
        system = ExamSystem([scheduled])
        allocation = RoomAllocation({}, [])
        writer = ExamSystemWriter(self.path)
        writer.write([candidate(system, allocation=allocation)], ["83101"], [e], report)
        text = self.read()
        self.assertNotIn("could not be seated", text)

    def test_summary_reports_the_number_written_and_the_report_text(self):
        e = exam("83101", {("83101", 1): Requirement.OBLIGATORY})
        system = ExamSystem([ScheduledExam(e, date(2026, 1, 1))])
        writer = ExamSystemWriter(self.path)
        writer.write([candidate(system)], ["83101"], [e], report)
        text = self.read()
        self.assertIn("Exam systems in this file: 1", text)
        self.assertIn("SUMMARY", text)

    def test_report_provider_is_only_called_once_after_the_run(self):
        calls = []

        def provider():
            calls.append(1)
            return report()

        e = exam("83101", {("83101", 1): Requirement.OBLIGATORY})
        system = ExamSystem([ScheduledExam(e, date(2026, 1, 1))])
        writer = ExamSystemWriter(self.path)
        writer.write([candidate(system), candidate(system)], ["83101"], [e], provider)
        self.assertEqual(len(calls), 1)

    def test_general_grouping_path_is_used_for_a_system_out_of_order(self):
        # A hand-built system whose exam order does not match `exams` still
        # gets written correctly, through ExamSystem.grouped_by_period().
        e1 = exam("83101", {("83101", 1): Requirement.OBLIGATORY})
        e2 = exam("83102", {("83101", 1): Requirement.OBLIGATORY})
        system = ExamSystem([ScheduledExam(e2, date(2026, 1, 2)),
                             ScheduledExam(e1, date(2026, 1, 1))])
        writer = ExamSystemWriter(self.path)
        writer.write([candidate(system)], ["83101"], [e1, e2], report)
        text = self.read()
        self.assertIn("83101", text)
        self.assertIn("83102", text)

    def test_writes_the_exam_count_of_the_system_in_its_own_heading(self):
        e1 = exam("83101", {("83101", 1): Requirement.OBLIGATORY})
        e2 = exam("83102", {("83101", 1): Requirement.OBLIGATORY})
        system = ExamSystem([ScheduledExam(e1, date(2026, 1, 1)),
                             ScheduledExam(e2, date(2026, 1, 2))])
        writer = ExamSystemWriter(self.path)
        writer.write([candidate(system)], ["83101"], [e1, e2], report)
        text = self.read()
        self.assertIn("(2 exams)", text)


if __name__ == "__main__":
    unittest.main()
