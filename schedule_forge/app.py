"""The application: it wires the parsers, the search and the writers together.

`ScheduleForgeApp` holds no user interface code of its own, so that the screens
of version 2.0 and the command line of version 1.0 drive the very same object.
"""

from .data_io.courses_parser import CoursesParser
from .data_io.enrollment_parser import EnrollmentParser
from .data_io.exam_periods_parser import ExamPeriodsParser
from .data_io.exam_system_writer import ExamSystemWriter
from .data_io.faculty_parser import FacultyConstraintsParser
from .data_io.global_excluded_parser import GlobalExcludedDatesParser, merge_into
from .data_io.ics_writer import CalendarExporter
from .data_io.programs_parser import ProgramsParser
from .data_io.rooms_parser import RoomsParser
from .data_io.settings_parser import SettingsParser
from .model.study_program import StudyProgramCatalog
from .scheduling.constraints import constraints_for
from .scheduling.exam_builder import ExamBuilder, SchedulingDataError
from .scheduling.generator import ExamSystemGenerator
from .scheduling.partial import PartialThresholdChecker
from .scheduling.quality import SystemEvaluator
from .scheduling.rooms import RoomAllocator
from .scheduling.search import CandidateSearch
from .settings import SchedulingSettings

#: Requirement 5.1 of version 1.0 - a run may not take more than 30 seconds.
DEFAULT_TIME_LIMIT_SECONDS = 30.0

#: How many exam systems are written by default. The whole set is counted
#: exactly and stated in the output, but writing all of it is not possible:
#: see the note in `scheduling.generator`.
DEFAULT_MAX_SYSTEMS = 1000


class RunResult(object):
    """What one run produced, for the caller to report to the user."""

    def __init__(self, selected_programs, courses, exams, candidates,
                 total_systems, report, output_path, settings, rooms=(),
                 availability=None, calendar_paths=(), roster=None):
        self.selected_programs = selected_programs
        self.courses = courses
        self.exams = exams
        self.candidates = candidates
        self.total_systems = total_systems
        self.report = report
        self.output_path = output_path
        self.settings = settings
        self.rooms = list(rooms)
        self.availability = availability
        self.calendar_paths = list(calendar_paths)
        self.roster = roster

    @property
    def systems_written(self):
        return len(self.candidates)

    @property
    def total_systems_text(self):
        if self.total_systems is None:
            return "unknown (the exact count exceeded the counting budget)"
        return "{:,}".format(self.total_systems)


class ScheduleForgeApp(object):
    """Reads the data files, finds the exam systems, writes them out."""

    def __init__(self, courses_path, periods_path, programs_path, output_path,
                 rooms_path=None, faculty_path=None, settings_path=None,
                 calendar_directory=None, settings=None, count_only=False,
                 catalog=None, global_excluded_path=None, enrollment_path=None):
        self.courses_path = courses_path
        self.periods_path = periods_path
        self.programs_path = programs_path
        self.output_path = output_path
        self.rooms_path = rooms_path
        self.faculty_path = faculty_path
        self.settings_path = settings_path
        self.global_excluded_path = global_excluded_path
        self.enrollment_path = enrollment_path
        self.calendar_directory = calendar_directory
        self.settings = settings
        self.count_only = count_only
        #: None means "derive it from the loaded courses file" (`run` does
        #: that once the courses are parsed); a caller may still pass one in
        #: to override that, which the tests use.
        self.catalog = catalog

    def read_settings(self):
        """The settings of the run: the file, or the defaults, or what was given."""
        if self.settings is not None:
            return self.settings
        if self.settings_path:
            return SettingsParser(self.settings_path).parse()
        return SchedulingSettings(max_candidates=DEFAULT_MAX_SYSTEMS,
                                  time_limit_seconds=DEFAULT_TIME_LIMIT_SECONDS)

    def run(self):
        """Perform a complete run and return a `RunResult`.

        Raises `DataFileError` on a bad data file, `SettingsError` on a bad
        setting and `SchedulingDataError` when the data cannot be scheduled.
        """
        settings = self.read_settings()
        courses = CoursesParser(self.courses_path).parse()
        periods = ExamPeriodsParser(self.periods_path).parse()
        if self.global_excluded_path:
            merge_into(periods, GlobalExcludedDatesParser(self.global_excluded_path).parse())
        catalog = (self.catalog if self.catalog is not None
                  else StudyProgramCatalog.from_courses(courses))
        selected = ProgramsParser(self.programs_path, catalog).parse()
        rooms = RoomsParser(self.rooms_path).parse() if self.rooms_path else []
        availability = (FacultyConstraintsParser(self.faculty_path).parse()
                        if self.faculty_path else None)
        roster = (EnrollmentParser(self.enrollment_path).parse()
                 if self.enrollment_path else None)

        exams = ExamBuilder(courses, periods, selected).build()
        if not exams:
            raise SchedulingDataError(
                "none of the courses of the selected study programs is "
                "evaluated by an exam, so there is nothing to schedule")

        generator = ExamSystemGenerator(exams, periods,
                                        constraints_for(settings, roster),
                                        availability,
                                        diversify=bool(settings.sort_criteria))
        blocked = generator.decomposition.exams_without_dates()
        if blocked:
            raise SchedulingDataError(
                "no date is left for %s; its instructor is not available on any "
                "date of the exam period"
                % ", ".join("%s %s" % (exam.course.number, exam.course.name)
                            for exam in blocked))

        total = generator.total_systems()
        allocator = RoomAllocator(rooms, settings.default_students) if rooms else None
        if settings.require_rooms and allocator is None:
            raise SchedulingDataError(
                "the settings ask every exam to be seated, but no rooms file "
                "was given")

        if self.count_only:
            return RunResult(selected, courses, exams, [], total, None, None,
                             settings, rooms, availability, roster=roster)

        pruner = PartialThresholdChecker(
            exams, generator.depth_of_position(), settings,
            allocator.total_capacity if allocator is not None else None,
            settings.default_students, roster)
        generator.pruner = pruner if pruner.is_needed else None

        evaluator = SystemEvaluator(settings, allocator)
        search = CandidateSearch(generator, evaluator, settings, allocator, roster)
        candidates = search.run()

        writer = ExamSystemWriter(self.output_path, catalog)
        writer.write(candidates, selected, exams, lambda: search.report, total,
                     settings)

        calendars = []
        if self.calendar_directory and candidates:
            best = candidates[0]
            exporter = CalendarExporter(best.allocation, catalog)
            calendars = exporter.write(self.calendar_directory, best.system,
                                       selected)

        return RunResult(selected, courses, exams, candidates, total,
                         search.report, self.output_path, settings, rooms,
                         availability, calendars, roster)
