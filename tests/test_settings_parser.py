"""Tests of schedule_forge.data_io.settings_parser.SettingsParser."""

import io
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from schedule_forge.data_io.errors import DataFileError
from schedule_forge.data_io.settings_parser import SettingsParser
from schedule_forge.settings import (CRITERION_DIRECTION, SORT_CRITERIA,
                                     SORT_CRITERIA_TITLES, SchedulingSettings)


class SettingsParserTestCase(unittest.TestCase):

    def setUp(self):
        self.directory = tempfile.mkdtemp()
        self.path = os.path.join(self.directory, "settings.txt")

    def tearDown(self):
        shutil.rmtree(self.directory, ignore_errors=True)

    def parse(self, text):
        with io.open(self.path, "w", encoding="utf-8") as handle:
            handle.write(text)
        return SettingsParser(self.path).parse()


class TestSettingsParser(SettingsParserTestCase):

    def test_an_empty_file_yields_every_default(self):
        settings = self.parse("")
        self.assertIsNone(settings.min_days_between_obligatory)
        self.assertFalse(settings.require_rooms)

    def test_parses_a_whole_number_setting(self):
        settings = self.parse("min_days_between_obligatory = 3")
        self.assertEqual(settings.min_days_between_obligatory, 3)

    def test_parses_several_settings_on_separate_lines(self):
        settings = self.parse("min_days_between_obligatory = 2\nmax_exams_per_day = 6")
        self.assertEqual(settings.min_days_between_obligatory, 2)
        self.assertEqual(settings.max_exams_per_day, 6)

    def test_parses_min_gap_between_moeds(self):
        settings = self.parse("min_gap_between_moeds = 4")
        self.assertEqual(settings.min_gap_between_moeds, 4)

    def test_min_gap_between_moeds_is_accepted_as_a_sort_criterion(self):
        settings = self.parse("sort = min_gap_between_moeds")
        self.assertEqual(settings.sort_criteria, ["min_gap_between_moeds"])

    def test_ignores_a_full_line_comment(self):
        settings = self.parse("# a comment\nmax_exams_per_day = 4")
        self.assertEqual(settings.max_exams_per_day, 4)

    def test_ignores_a_trailing_comment_on_a_setting_line(self):
        settings = self.parse("max_exams_per_day = 4  # at most four a day")
        self.assertEqual(settings.max_exams_per_day, 4)

    def test_ignores_blank_lines(self):
        settings = self.parse("\n\nmax_exams_per_day = 4\n\n")
        self.assertEqual(settings.max_exams_per_day, 4)

    def test_setting_names_are_case_insensitive(self):
        settings = self.parse("MAX_EXAMS_PER_DAY = 4")
        self.assertEqual(settings.max_exams_per_day, 4)

    def test_strips_whitespace_around_the_name_and_value(self):
        settings = self.parse("  max_exams_per_day   =   4  ")
        self.assertEqual(settings.max_exams_per_day, 4)

    def test_parses_a_true_flag_written_as_yes(self):
        self.assertTrue(self.parse("require_rooms = yes").require_rooms)

    def test_parses_a_true_flag_written_as_true(self):
        self.assertTrue(self.parse("require_rooms = true").require_rooms)

    def test_parses_a_true_flag_written_as_on(self):
        self.assertTrue(self.parse("require_rooms = on").require_rooms)

    def test_parses_a_true_flag_written_as_1(self):
        self.assertTrue(self.parse("require_rooms = 1").require_rooms)

    def test_parses_a_false_flag_written_as_no(self):
        self.assertFalse(self.parse("require_rooms = no").require_rooms)

    def test_parses_a_false_flag_written_as_off(self):
        self.assertFalse(self.parse("require_rooms = off").require_rooms)

    def test_flag_value_is_case_insensitive(self):
        self.assertTrue(self.parse("require_rooms = YES").require_rooms)

    def test_raises_for_an_illegal_flag_value(self):
        with self.assertRaises(DataFileError):
            self.parse("require_rooms = maybe")

    def test_parses_a_decimal_setting(self):
        settings = self.parse("time_limit_seconds = 12.5")
        self.assertEqual(settings.time_limit_seconds, 12.5)

    def test_a_decimal_setting_accepts_a_whole_number_too(self):
        settings = self.parse("time_limit_seconds = 10")
        self.assertEqual(settings.time_limit_seconds, 10.0)

    def test_raises_for_a_non_numeric_decimal_value(self):
        with self.assertRaises(DataFileError):
            self.parse("time_limit_seconds = soon")

    def test_raises_for_a_non_numeric_whole_number_value(self):
        with self.assertRaises(DataFileError):
            self.parse("max_exams_per_day = many")

    def test_parses_the_sort_list_as_sort_criteria(self):
        settings = self.parse("sort = min_days_between_obligatory, max_exams_per_day")
        self.assertEqual(settings.sort_criteria,
                         ["min_days_between_obligatory", "max_exams_per_day"])

    def test_sort_list_is_case_sensitive_to_the_criterion_names_but_trims_whitespace(self):
        settings = self.parse("sort =   min_days_between_obligatory ,  max_exams_per_day  ")
        self.assertEqual(settings.sort_criteria,
                         ["min_days_between_obligatory", "max_exams_per_day"])

    def test_a_single_item_sort_list(self):
        settings = self.parse("sort = elective_collisions")
        self.assertEqual(settings.sort_criteria, ["elective_collisions"])

    def test_an_empty_sort_value_yields_an_empty_list_turning_sorting_off(self):
        settings = self.parse("sort = ")
        self.assertEqual(settings.sort_criteria, [])

    def test_raises_for_an_unknown_sort_criterion(self):
        with self.assertRaises(DataFileError):
            self.parse("sort = not_a_real_criterion")

    def test_raises_for_a_line_with_no_equals_sign(self):
        with self.assertRaises(DataFileError):
            self.parse("max_exams_per_day 4")

    def test_raises_for_an_unknown_setting_name(self):
        with self.assertRaises(DataFileError):
            self.parse("not_a_real_setting = 4")

    def test_raises_for_a_negative_threshold(self):
        with self.assertRaises(DataFileError):
            self.parse("max_exams_per_day = -1")

    def test_raises_for_a_zero_default_students(self):
        with self.assertRaises(DataFileError):
            self.parse("default_students = 0")

    def test_error_carries_the_offending_line_number(self):
        try:
            self.parse("max_exams_per_day = 4\nrequire_rooms = maybe")
            self.fail("expected DataFileError")
        except DataFileError as error:
            self.assertEqual(error.line_number, 2)

    def test_a_later_line_overrides_an_earlier_one_for_the_same_setting(self):
        settings = self.parse("max_exams_per_day = 4\nmax_exams_per_day = 8")
        self.assertEqual(settings.max_exams_per_day, 8)

    def test_raises_when_the_file_does_not_exist(self):
        missing = os.path.join(self.directory, "missing.txt")
        with self.assertRaises(DataFileError):
            SettingsParser(missing).parse()

    def test_max_elective_collisions_of_zero_is_a_real_active_threshold(self):
        settings = self.parse("max_elective_collisions = 0")
        self.assertEqual(settings.max_elective_collisions, 0)

    def test_parses_max_candidates_and_max_examined(self):
        settings = self.parse("max_candidates = 500\nmax_examined = 100000")
        self.assertEqual(settings.max_candidates, 500)
        self.assertEqual(settings.max_examined, 100000)

    def test_a_full_realistic_file_parses_correctly(self):
        text = (
            "# threshold requirements\n"
            "min_days_between_obligatory = 2\n"
            "max_exams_per_day = 6\n"
            "require_rooms = yes\n"
            "\n"
            "# sorting, most important criterion first\n"
            "sort = min_days_between_obligatory, max_exams_per_day\n"
        )
        settings = self.parse(text)
        self.assertEqual(settings.min_days_between_obligatory, 2)
        self.assertEqual(settings.max_exams_per_day, 6)
        self.assertTrue(settings.require_rooms)
        self.assertEqual(settings.sort_criteria,
                         ["min_days_between_obligatory", "max_exams_per_day"])


class TestSortCriteriaCompleteness(unittest.TestCase):
    """Every criterion `constants.py` lists has to actually be usable, or a
    run that names it in `sort` blows up with a KeyError instead of a
    reported `SettingsError` - as `min_gap_between_moeds` briefly did here
    before `CRITERION_DIRECTION` caught up with `SORT_CRITERIA`."""

    def test_every_criterion_has_a_title(self):
        for criterion in SORT_CRITERIA:
            self.assertIn(criterion, SORT_CRITERIA_TITLES)

    def test_every_criterion_has_a_direction(self):
        for criterion in SORT_CRITERIA:
            self.assertIn(CRITERION_DIRECTION.get(criterion), (1, -1))

    def test_every_criterion_can_be_used_alone_without_error(self):
        for criterion in SORT_CRITERIA:
            settings = SchedulingSettings(sort_criteria=[criterion])
            self.assertEqual([criterion], settings.sort_criteria)
            settings.describe_sorting()  # must not raise KeyError


if __name__ == "__main__":
    unittest.main()
