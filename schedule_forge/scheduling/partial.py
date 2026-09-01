"""Throwing an exam system away while it is still half built (version 3.0).

The thresholds 2.3, 2.4, 2.5 and the room capacity are counts over a whole exam
system, so they cannot become rules between two exams and cannot enter the
decomposition. Checking them only on a finished system, however, does not work:
the generator walks the components like an odometer, so the first exams stay
where they are for a very long time, and a bad placement of an early component
would be carried by every one of the millions of systems that follow it.

The counts are therefore checked as the walk goes, on the exams placed so far:

* the number of exams on a date, the number of seats a date needs and the
  collisions between elective courses only ever grow as more components are
  placed, so a partial system that already breaks one of them can be dropped
  together with everything below it;
* the span of the obligatory exams of a study year (2.4) is checked as soon as
  the last component holding an exam of that year has been placed.

`apply` and `unapply` are exact opposites, so the counters follow the walk up
and down without being rebuilt.
"""

from ..model.enums import Requirement


class PartialThresholdChecker(object):
    """Keeps the counts of the exams placed so far and judges them."""

    def __init__(self, exams, depth_of_position, settings, total_capacity=None,
                 default_students=30):
        self.exams = list(exams)
        self.max_exams_per_day = settings.max_exams_per_day
        self.max_collisions = settings.max_elective_collisions
        self.min_span = settings.min_obligatory_span
        self.total_capacity = total_capacity
        self.students = [exam.course.students_or(default_students)
                         for exam in self.exams]
        self.elective_programs = [
            sorted(set(program for (program, _), requirement in exam.slots.items()
                       if requirement is Requirement.ELECTIVE))
            for exam in self.exams]
        self.groups_by_depth = self._groups_by_depth(depth_of_position)
        self.reset()

    @property
    def is_needed(self):
        """False when nothing here has to be checked, so the walk stays plain."""
        return bool(self.max_exams_per_day or self.max_collisions is not None or
                    self.min_span or self.total_capacity is not None)

    def reset(self):
        self.date_count = {}
        self.date_students = {}
        self.elective_count = {}
        self.collisions = {}
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
            self.current_date.pop(position, None)

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
