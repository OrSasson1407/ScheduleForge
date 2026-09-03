"""Throwing an exam system away while it is still half built (version 3.0).

The thresholds 2.3, 2.4, 2.5, 2.7 and the room capacity are counts over a whole
exam system, so they cannot become rules between two exams and cannot enter the
decomposition. Checking them only on a finished system, however, does not work:
the generator walks the components like an odometer, so the first exams stay
where they are for a very long time, and a bad placement of an early component
would be carried by every one of the millions of systems that follow it.

The counts are therefore checked as the walk goes, on the exams placed so far:

* the number of exams on a date, the number of seats a date needs, the
  collisions between elective courses, and the exams of a (program, year)
  falling inside any `window_days`-day span (2.7) only ever grow as more
  components are placed, so a partial system that already breaks one of them
  can be dropped together with everything below it;
* the span of the obligatory exams of a study year (2.4) is checked as soon as
  the last component holding an exam of that year has been placed.

Item 2 (opt-in time-of-day enforcement) lives here too, on the same footing:
a date's exams only ever grow during the walk, so the greedy colouring in
`time_slots.TimeSlotAssigner` is re-run on the accumulated exams of a touched
date on every `apply`, and a date that cannot be coloured is rejected the same
way a broken count is.

`apply` and `unapply` are exact opposites, so the counters follow the walk up
and down without being rebuilt.
"""

import bisect
from datetime import timedelta

from ..model.enums import Requirement
from .time_slots import TimeSlotAssigner


class PartialThresholdChecker(object):
    """Keeps the counts of the exams placed so far and judges them."""

    def __init__(self, exams, depth_of_position, settings, total_capacity=None,
                 default_students=30, roster=None):
        self.exams = list(exams)
        self.max_exams_per_day = settings.max_exams_per_day
        self.max_collisions = settings.max_elective_collisions
        self.min_span = settings.min_obligatory_span
        self.max_exams_per_window = settings.max_exams_per_window
        self.window_days = settings.window_days
        self.total_capacity = total_capacity
        self.students = [exam.course.students_or(default_students)
                         for exam in self.exams]
        self.elective_programs = [
            sorted(set(program for (program, _), requirement in exam.slots.items()
                       if requirement is Requirement.ELECTIVE))
            for exam in self.exams]
        #: Every (program, year) an exam belongs to, for the window check
        #: below - unlike `elective_programs`, this holds obligatory and
        #: elective slots alike, since a student's exam load is not lighter
        #: just because a course happens to be elective for them.
        self.window_slots = [sorted(exam.slots.keys()) for exam in self.exams]
        self.groups_by_depth = self._groups_by_depth(depth_of_position)
        #: Item 2 - unset time_slots leaves this off entirely.
        self.time_slots = settings.time_slots
        self.time_slot_assigner = (TimeSlotAssigner(settings.time_slots, roster)
                                   if settings.time_slots else None)
        self.reset()

    @property
    def is_needed(self):
        """False when nothing here has to be checked, so the walk stays plain."""
        return bool(self.max_exams_per_day or self.max_collisions is not None or
                    self.min_span or self.max_exams_per_window or
                    self.time_slots or self.total_capacity is not None)

    def reset(self):
        self.date_count = {}
        self.date_students = {}
        self.elective_count = {}
        self.collisions = {}
        self.window_dates = {}
        self.exams_on_date = {}
        self.current_date = {}
        self.applied = {}

    def apply(self, depth, pairs):
        """Add the exams of one component; False when a count is now broken."""
        self.applied[depth] = pairs
        ok = True
        for position, date in pairs:
            self.current_date[position] = date
            count = self.date_count.get(date, 0) + 1
            self.date_count[date] = count
            if self.max_exams_per_day and count > self.max_exams_per_day:
                ok = False
            if self.total_capacity is not None:
                seats = self.date_students.get(date, 0) + self.students[position]
                self.date_students[date] = seats
                if seats > self.total_capacity:
                    ok = False
            if self.max_collisions is not None:
                for program in self.elective_programs[position]:
                    key = (program, date)
                    already = self.elective_count.get(key, 0)
                    self.elective_count[key] = already + 1
                    total = self.collisions.get(program, 0) + already
                    self.collisions[program] = total
                    if total > self.max_collisions:
                        ok = False
            if self.max_exams_per_window:
                for key in self.window_slots[position]:
                    dates = self.window_dates.setdefault(key, [])
                    bisect.insort(dates, date)
                    if self._window_violates(dates, date):
                        ok = False
            if self.time_slot_assigner is not None:
                exams_today = self.exams_on_date.setdefault(date, [])
                exams_today.append(self.exams[position])
                if self.time_slot_assigner.color(exams_today) is None:
                    ok = False
        if ok and self.min_span:
            ok = self._spans_are_wide_enough(depth)
        return ok

    def unapply(self, depth):
        """Take the exams of one component back out of the counts."""
        pairs = self.applied.pop(depth, None)
        if not pairs:
            return
        for position, date in reversed(pairs):
            self.date_count[date] -= 1
            if self.total_capacity is not None:
                self.date_students[date] -= self.students[position]
            if self.max_collisions is not None:
                for program in reversed(self.elective_programs[position]):
                    key = (program, date)
                    left = self.elective_count[key] - 1
                    self.elective_count[key] = left
                    self.collisions[program] -= left
            if self.max_exams_per_window:
                for key in reversed(self.window_slots[position]):
                    dates = self.window_dates[key]
                    dates.pop(bisect.bisect_left(dates, date))
            if self.time_slot_assigner is not None:
                self.exams_on_date[date].remove(self.exams[position])
            self.current_date.pop(position, None)

    def _window_violates(self, dates, new_date):
        """Requirement 2.7 - does any window that now holds `new_date` overflow?

        Every window that could contain `new_date` starts at one of the dates
        already at or before it (in the same sorted list) and within
        `window_days - 1` of it - counts only ever grow during the walk, so a
        window that does not contain the exam just placed could not have
        broken here; it would already have been caught on an earlier `apply`.
        """
        span = timedelta(days=self.window_days - 1)
        index = bisect.bisect_left(dates, new_date)
        while index >= 0 and (new_date - dates[index]).days <= self.window_days - 1:
            start = dates[index]
            end = start + span
            first = bisect.bisect_left(dates, start)
            last = bisect.bisect_right(dates, end)
            if last - first > self.max_exams_per_window:
                return True
            index -= 1
        return False

    def _spans_are_wide_enough(self, depth):
        """Requirement 2.4, for the study years this component completes."""
        for positions in self.groups_by_depth.get(depth, ()):
            dates = [self.current_date[position] for position in positions]
            if (max(dates) - min(dates)).days < self.min_span:
                return False
        return True

    def _groups_by_depth(self, depth_of_position):
        """The obligatory exams of a study year, by the component that ends it.

        A group is checked once, right after the last of its exams was placed.
        """
        groups = {}
        for position, exam in enumerate(self.exams):
            for (program, year), requirement in exam.slots.items():
                if requirement is not Requirement.OBLIGATORY:
                    continue
                key = (program, year, exam.semester, exam.moed)
                groups.setdefault(key, []).append(position)

        by_depth = {}
        for positions in groups.values():
            if len(positions) < 2:
                continue  # a single exam has no span to speak of
            last_depth = max(depth_of_position[position] for position in positions)
            by_depth.setdefault(last_depth, []).append(positions)
        return by_depth
