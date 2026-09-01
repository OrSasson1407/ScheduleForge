"""Writing the exam systems to a human readable file (requirements 2.3, 3.2).

Once the generator produces a system in a fraction of a microsecond, writing the
systems is what a long run spends its time on. Two facts keep it cheap:

* which exams belong to which (semester, moed) block never changes between the
  systems - only the dates do - so the blocks are planned once;
* an exam appears on a limited number of dates, so the text of a line is built
  once per (exam, date) pair and then reused by every system that holds it.

A system that carries a room allocation is written with the rooms of every exam,
which do change from system to system, so those lines are built each time.
"""

import io
import os
from datetime import datetime
from operator import itemgetter

DATE_FORMAT = "%d-%m-%Y"
_WIDE_RULE = "=" * 78
_SYSTEM_RULE = "#" * 78
_BLOCK_RULE = "  " + "-" * 74
_COLUMNS = "  %-12s %-8s %-32s %s\n" % ("DATE", "COURSE", "COURSE NAME",
                                        "INSTRUCTOR")
_COLUMNS_WITH_ROOMS = "  %-12s %-8s %-26s %-16s %s\n" % (
    "DATE", "COURSE", "COURSE NAME", "INSTRUCTOR", "ROOMS")


class ExamSystemWriter(object):
    """Writes the generated exam systems as plain, readable text.

    The systems are written while they are produced, so that the memory the
    software needs does not grow with the number of systems.
    """

    def __init__(self, path, catalog=None):
        self.path = path
        self.catalog = catalog
        self._lines = {}

    def write(self, candidates, selected_programs, exams, report_provider,
              total_systems=None, settings=None):
        """Write every candidate and return how many were written.

        A candidate holds the exam system, its measurement and, when rooms were
        loaded, its room allocation. `report_provider` is called after the run
        ended and returns the report printed in the closing summary.
        """
        directory = os.path.dirname(os.path.abspath(self.path))
        if directory and not os.path.isdir(directory):
            os.makedirs(directory)

        plan = self._plan_blocks(exams)
        follows_plan = None
        written = 0
        with io.open(self.path, "w", encoding="utf-8") as handle:
            self._write_header(handle, selected_programs, exams, total_systems,
                               settings)
            for candidate in candidates:
                if follows_plan is None:
                    follows_plan = self._follows_the_plan(candidate.system, exams)
                written += 1
                self._write_system(handle, written, candidate, plan, follows_plan)
            self._write_summary(handle, written, report_provider())
        return written

    def _plan_blocks(self, exams):
        """The (semester, moed) blocks and the exams that belong to each one.

        The plan holds positions inside the exam list; the writer falls back to
        the general grouping of `ExamSystem` when a system does not follow that
        list, so a caller that builds systems of its own stays correct.
        """
        blocks = {}
        for position, exam in enumerate(exams):
            blocks.setdefault(exam.period_key, []).append(position)
        ordered = sorted(blocks.items(), key=lambda item: (item[0][0].order,
                                                           item[0][1].order))
        return [(key, positions) for key, positions in ordered]

    def _block_header(self, period_key, with_rooms):
        semester, moed = period_key
        return ("\n  %s, moed %s\n%s\n%s"
                % (semester.display_name, moed.display_name, _BLOCK_RULE,
                   _COLUMNS_WITH_ROOMS if with_rooms else _COLUMNS))

    def _follows_the_plan(self, system, exams):
        """Does a system hold the exams of the plan, in the order of the plan?

        Checked on the first system only: the systems of one run all come from
        the same generator, and a caller that builds its own gets the general
        path for all of them.
        """
        scheduled_exams = system.scheduled_exams
        if len(scheduled_exams) != len(exams):
            return False
        for position, exam in enumerate(exams):
            if scheduled_exams[position].exam is not exam:
                return False
        return True

    def _write_system(self, handle, index, candidate, plan, follows_plan):
        system = candidate.system
        allocation = candidate.allocation
        handle.write("%s\nEXAM SYSTEM #%d   (%d exams)\n%s\n"
                     % (_SYSTEM_RULE, index, len(system), _SYSTEM_RULE))
        if candidate.metrics is not None:
            handle.write("  %s\n" % candidate.metrics.describe())
        if allocation is not None and not allocation.is_complete:
            handle.write("  rooms: %d exam(s) could not be seated\n"
                         % len(allocation.failures))

        with_rooms = allocation is not None
        if follows_plan:
            scheduled_exams = system.scheduled_exams
            for period_key, positions in plan:
                rows = [(scheduled_exams[position].date,
                         self._line(scheduled_exams[position], allocation))
                        for position in positions]
                rows.sort(key=itemgetter(0))
                handle.write(self._block_header(period_key, with_rooms))
                handle.write("".join([row[1] for row in rows]))
        else:
            for period_key, block in system.grouped_by_period():
                handle.write(self._block_header(period_key, with_rooms))
                handle.write("".join([self._line(s, allocation) for s in block]))
        handle.write("\n")

    def _line(self, scheduled, allocation=None):
        """The text of one exam line.

        Without rooms the text depends on the exam and its date alone, so it is
        built once per pair and then reused.
        """
        if allocation is not None:
            course = scheduled.exam.course
            rooms = allocation.rooms_of(scheduled.exam)
            names = ", ".join(room.name for room in rooms) if rooms else "-"
            return "  %-12s %-8s %-26s %-16s %s\n" % (
                scheduled.date.strftime(DATE_FORMAT), course.number,
                course.name[:26], course.instructor[:16], names)

        line = self._lines.get(scheduled)
        if line is None:
            course = scheduled.exam.course
            line = "  %-12s %-8s %-32s %s\n" % (
                scheduled.date.strftime(DATE_FORMAT), course.number, course.name,
                course.instructor)
            self._lines[scheduled] = line
        return line

    def _write_header(self, handle, selected_programs, exams, total_systems,
                      settings):
        handle.write(_WIDE_RULE + "\n")
        handle.write("ScheduleForge - exam systems - version 3.0\n")
        handle.write("Produced on %s\n"
                     % datetime.now().strftime("%d-%m-%Y %H:%M"))
        handle.write(_WIDE_RULE + "\n")
        handle.write("Selected study programs (%d):\n" % len(selected_programs))
        for number in selected_programs:
            name = self.catalog.name_of(number) if self.catalog else ""
            handle.write("    %s %s\n" % (number, name))
        handle.write("Exams to schedule: %d\n" % len(exams))
        if total_systems is not None:
            handle.write("Exam systems without the threshold requirements: "
                         "{:,}\n".format(total_systems))
        if settings is not None:
            thresholds = settings.describe_thresholds()
            handle.write("Threshold requirements: %s\n"
                         % ("none" if not thresholds else ""))
            for line in thresholds:
                handle.write("    %s\n" % line)
            sorting = settings.describe_sorting()
            handle.write("Sorted by: %s\n" % ("nothing" if not sorting else ""))
            for position, line in enumerate(sorting):
                handle.write("    %d. %s\n" % (position + 1, line))
        handle.write(_WIDE_RULE + "\n\n")

    def _write_summary(self, handle, written, report):
        handle.write(_WIDE_RULE + "\n")
        handle.write("SUMMARY\n")
        handle.write("Exam systems in this file: %d\n" % written)
        handle.write("%s\n" % report.describe(written))
        handle.write(_WIDE_RULE + "\n")
