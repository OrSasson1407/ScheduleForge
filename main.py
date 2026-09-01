"""ScheduleForge - command line entry point (file based interface, req. 3.1).

Usage:
    python main.py --courses data/courses.txt \
                   --periods data/exam_periods.txt \
                   --programs data/programs.txt \
                   --settings data/settings.txt \
                   --rooms data/rooms.txt \
                   --faculty data/faculty_constraints.txt \
                   --output output/exam_systems.txt \
                   --calendars output/calendars
"""

import argparse
import sys

from schedule_forge.app import (DEFAULT_MAX_SYSTEMS, DEFAULT_TIME_LIMIT_SECONDS,
                                ScheduleForgeApp)
from schedule_forge.data_io.errors import DataFileError
from schedule_forge.scheduling.exam_builder import SchedulingDataError
from schedule_forge.settings import SettingsError


def build_parser():
    parser = argparse.ArgumentParser(
        description="Find the exam systems of the selected study programs "
                    "(ScheduleForge, version 3.0).")
    parser.add_argument("--courses", default="data/courses.txt",
                        help="the courses data file")
    parser.add_argument("--periods", default="data/exam_periods.txt",
                        help="the exam periods data file")
    parser.add_argument("--programs", default="data/programs.txt",
                        help="the file holding the selected study programs")
    parser.add_argument("--settings",
                        help="the file holding the threshold requirements and "
                             "the sorting criteria (version 3.0)")
    parser.add_argument("--rooms",
                        help="the rooms data file; exams are then allocated to "
                             "rooms (version 3.0)")
    parser.add_argument("--faculty",
                        help="the staff constraints file: the dates every "
                             "instructor is not available on (version 3.0)")
    parser.add_argument("--output", default="output/exam_systems.txt",
                        help="the file the exam systems are written to")
    parser.add_argument("--calendars",
                        help="a directory to write one .ics calendar per study "
                             "program and year of the best exam system found")
    parser.add_argument("--max-systems", type=int,
                        help="how many exam systems to keep at most "
                             "(0 means no limit; default %d)" % DEFAULT_MAX_SYSTEMS)
    parser.add_argument("--time-limit", type=float,
                        help="how many seconds the search may take "
                             "(0 means no limit; default %d)"
                             % DEFAULT_TIME_LIMIT_SECONDS)
    parser.add_argument("--count-only", action="store_true",
                        help="only report how many exam systems are possible, "
                             "without producing them")
    return parser


def main(argv=None):
    arguments = build_parser().parse_args(argv)
    application = ScheduleForgeApp(
        courses_path=arguments.courses,
        periods_path=arguments.periods,
        programs_path=arguments.programs,
        output_path=arguments.output,
        rooms_path=arguments.rooms,
        faculty_path=arguments.faculty,
        settings_path=arguments.settings,
        calendar_directory=arguments.calendars,
        count_only=arguments.count_only)

    try:
        settings = application.read_settings()
        if arguments.max_systems is not None:
            settings.max_candidates = arguments.max_systems or None
        if arguments.time_limit is not None:
            settings.time_limit_seconds = arguments.time_limit or None
        settings.validate()
        application.settings = settings
        result = application.run()
    except (DataFileError, SchedulingDataError, SettingsError) as error:
        sys.stderr.write("ScheduleForge stopped: %s\n" % error)
        return 1

    print("Study programs: %s" % ", ".join(result.selected_programs))
    print("Courses read: %d" % len(result.courses))
    print("Exams to schedule: %d" % len(result.exams))
    if result.rooms:
        print("Rooms read: %d (%d seats)"
              % (len(result.rooms), sum(room.capacity for room in result.rooms)))
    if result.availability is not None:
        print("Staff constraints read: %d instructor(s)" % len(result.availability))
    for line in result.settings.describe_thresholds():
        print("Threshold: %s" % line)
    for position, line in enumerate(result.settings.describe_sorting()):
        print("Sorted by %d: %s" % (position + 1, line))
    print("Possible exam systems (before the threshold requirements): %s"
          % result.total_systems_text)
    if result.output_path is None:
        return 0
    print(result.report.describe(len(result.candidates)))
    print("Exam systems written to %s" % result.output_path)
    for path in result.calendar_paths:
        print("Calendar written to %s" % path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
