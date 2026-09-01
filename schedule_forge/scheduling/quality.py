"""What an exam system is worth (requirement sections 2 and 3 of version 3.0).

The five threshold requirements of section 2 and the five sorting criteria of
section 3 are two readings of the same five numbers, so both are taken from one
measurement of a system:

    2.1 / 3.1  the smallest gap between two obligatory exams of a year
    2.2        the smallest gap between two exams of a year
    3.2        the average gap between two exams of a year
    2.3 / 3.3  collisions between two elective courses of a program
    2.4 / 3.4  days from the first to the last obligatory exam of a year
    2.5 / 3.5  the largest number of exams on one day

Thresholds 2.1 and 2.2 are enforced by the generator itself, which never builds
a system that breaks them; they are measured here as well, so a test can check
that the two agree. The other thresholds are counts over a whole system, so a
system is measured and only then kept or thrown away.

A gap is counted in calendar days and includes Saturdays and holidays, as the
requirement says. Gaps are counted inside one study program, one study year and
one exam period, because that is the group of exams one student sits.
"""

from ..model.enums import Requirement
from ..settings import CRITERION_DIRECTION

#: Stands for "there is no such pair", which is better than any real value.
NO_PAIR = 10 ** 6


class SystemMetrics(object):
    """The measurement of one exam system."""

    __slots__ = ("min_days_between_obligatory", "min_days_between_exams",
                 "average_days_between_exams", "elective_collisions",
                 "worst_program_collisions", "obligatory_span",
                 "max_exams_per_day")

    def __init__(self, min_days_between_obligatory, min_days_between_exams,
                 average_days_between_exams, elective_collisions,
                 worst_program_collisions, obligatory_span, max_exams_per_day):
        #: 3.1 - smallest gap between two obligatory exams of a program year.
        self.min_days_between_obligatory = min_days_between_obligatory
        #: The same for exams of any kind (threshold 2.2).
        self.min_days_between_exams = min_days_between_exams
        #: 3.2 - average gap between two exams of a program year.
        self.average_days_between_exams = average_days_between_exams
        #: 3.3 - collisions between two elective courses, over all programs.
        self.elective_collisions = elective_collisions
        #: The collisions of the program that has the most of them (2.3).
        self.worst_program_collisions = worst_program_collisions
        #: 3.4 - days from the first to the last obligatory exam of a year,
        #: taken from the group that is packed the tightest.
        self.obligatory_span = obligatory_span
        #: 3.5 - the largest number of exams that fall on one day.
        self.max_exams_per_day = max_exams_per_day

    def value_of(self, criterion):
        return getattr(self, criterion)

    def describe(self):
        return ("smallest gap between obligatory exams: %s, average gap: %.2f, "
                "elective collisions: %d, tightest span of obligatory exams: %s, "
                "most exams on one day: %d"
                % (_or_dash(self.min_days_between_obligatory),
                   self.average_days_between_exams, self.elective_collisions,
                   _or_dash(self.obligatory_span), self.max_exams_per_day))


def _or_dash(value):
    return "-" if value >= NO_PAIR else str(value)


class SystemEvaluator(object):
    """Measures exam systems, and says which of them pass the thresholds."""

    def __init__(self, settings, room_allocator=None):
        self.settings = settings
        self.room_allocator = room_allocator

    def measure(self, system):
        """The `SystemMetrics` of one exam system."""
        groups, by_date, elective_by_program = self._collect(system)

        min_obligatory = NO_PAIR
        min_any = NO_PAIR
        total_gap = 0
        pair_count = 0
        span = NO_PAIR

        for entries in groups.values():
            obligatory = [date for date, requirement in entries
                          if requirement is Requirement.OBLIGATORY]
            for first in range(len(entries)):
                for second in range(first + 1, len(entries)):
                    gap = abs((entries[first][0] - entries[second][0]).days)
                    total_gap += gap
                    pair_count += 1
                    if gap < min_any:
                        min_any = gap
                    if (entries[first][1] is Requirement.OBLIGATORY and
                            entries[second][1] is Requirement.OBLIGATORY and
                            gap < min_obligatory):
                        min_obligatory = gap
            if len(obligatory) >= 2:
                group_span = (max(obligatory) - min(obligatory)).days
                if group_span < span:
                    span = group_span

        collisions = 0
        worst = 0
        for dates in elective_by_program.values():
            program_collisions = 0
            for exams_on_date in dates.values():
                count = len(exams_on_date)
                program_collisions += count * (count - 1) // 2
            collisions += program_collisions
            worst = max(worst, program_collisions)

        return SystemMetrics(
            min_days_between_obligatory=min_obligatory,
            min_days_between_exams=min_any,
            average_days_between_exams=(float(total_gap) / pair_count
                                        if pair_count else 0.0),
            elective_collisions=collisions,
            worst_program_collisions=worst,
            obligatory_span=span,
            max_exams_per_day=max((len(items) for items in by_date.values()),
                                  default=0))

    def _collect(self, system):
        """The three views of a system every measurement is taken from."""
        groups = {}
        by_date = {}
        elective_by_program = {}
        for scheduled in system.scheduled_exams:
            exam = scheduled.exam
            by_date.setdefault(scheduled.date, []).append(scheduled)
            for slot, requirement in exam.slots.items():
                program, year = slot
                key = (program, year, exam.semester, exam.moed)
                groups.setdefault(key, []).append((scheduled.date, requirement))
                if requirement is Requirement.ELECTIVE:
                    dates = elective_by_program.setdefault(program, {})
                    dates.setdefault(scheduled.date, []).append(exam)
        return groups, by_date, elective_by_program

    def passes(self, metrics):
        """Do the counts over the whole system meet the active thresholds?"""
        settings = self.settings
        if (settings.max_elective_collisions is not None and
                metrics.worst_program_collisions > settings.max_elective_collisions):
            return False
        if (settings.min_obligatory_span and metrics.obligatory_span < NO_PAIR and
                metrics.obligatory_span < settings.min_obligatory_span):
            return False
        if (settings.max_exams_per_day and
                metrics.max_exams_per_day > settings.max_exams_per_day):
            return False
        return True

    def sort_key(self, metrics):
        """The key of the criteria of section 3, most important one first.

        Ascending on this key is best-first: a criterion whose larger value is
        better (CRITERION_DIRECTION +1, a wider gap) is negated so its largest
        raw value sorts first; a criterion whose smaller value is better
        (-1, fewer collisions) is kept as it is, so its smallest raw value
        sorts first. Every criterion therefore ranks genuinely best-to-worst,
        not merely "largest number first" regardless of what that number means.
        """
        return tuple(-CRITERION_DIRECTION[criterion] * metrics.value_of(criterion)
                     for criterion in self.settings.sort_criteria)
