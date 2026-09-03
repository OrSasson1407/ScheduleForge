"""Assigning each exam of a date a time slot, so that no two exams that need
different times ever get the same one (item 2 - opt-in, off unless the user
sets `time_slots`).

Neither this engine nor the search built into it has ever had a notion of
time of day: every rule up to this point reasons about dates alone. This adds
exactly one new idea - two exams on the same date need *different* times when
their (program, year) groups intersect (the same grouping requirement 1.2's
same-day rule already reads, so no new dependency) or, when a real enrollment
roster is loaded, when they share a real student (defense in depth beyond the
aggregate grouping) - and answers it with a small per-day greedy graph
coloring, reused by both:

* `PartialThresholdChecker`, during the search - a day that cannot be
  coloured with `settings.time_slots` is rejected, a real backtrack rather
  than a display nicety;
* `TimeSlotAssigner.assign`, once per accepted candidate (`search.py`,
  mirroring where `RoomAllocator.allocate` already runs) - a *stateless*
  finishing pass, deliberately not read off the pruner's own running cache:
  the pruner is one mutable object that keeps mutating past whatever
  candidate was just accepted (the search keeps walking after yielding one),
  so its cache at "the moment a candidate is judged" does not reliably
  describe *that* candidate once the search continues.
"""


class TimeSlotAssigner(object):
    """Colours the exams of a date with the fewest possible timeslot clashes."""

    def __init__(self, time_slots, roster=None):
        self.time_slots = list(time_slots)
        self.roster = roster

    def conflicts(self, first, second):
        """Do `first` and `second` need different time slots on the same date?"""
        if set(first.slots) & set(second.slots):
            return True
        if self.roster is not None:
            return self.roster.shares_students(first.course.number,
                                                second.course.number)
        return False

    def color(self, exams):
        """Exam -> slot index for one date's exams, or None if infeasible.

        Greedy, highest-degree-first, first-fit: not guaranteed optimal in
        general graph colouring, but fast, deterministic, and exact for the
        small, usually sparse conflict graphs one date's worth of exams forms.
        """
        exams = list(exams)
        if len(exams) <= 1:
            return {exam: 0 for exam in exams}

        adjacency = [[] for _ in exams]
        for i in range(len(exams)):
            for j in range(i + 1, len(exams)):
                if self.conflicts(exams[i], exams[j]):
                    adjacency[i].append(j)
                    adjacency[j].append(i)

        order = sorted(range(len(exams)), key=lambda i: -len(adjacency[i]))
        color_of = [-1] * len(exams)
        for i in order:
            used = set(color_of[j] for j in adjacency[i] if color_of[j] != -1)
            chosen = None
            for candidate in range(len(self.time_slots)):
                if candidate not in used:
                    chosen = candidate
                    break
            if chosen is None:
                return None
            color_of[i] = chosen
        return {exams[k]: color_of[k] for k in range(len(exams))}

    def assign(self, system):
        """Every `ScheduledExam` of `system` mapped to a time string.

        None if some date cannot be coloured with `self.time_slots` - should
        not happen for a system a search already enforced this during, but a
        hand-edited system, or a caller that built one without the pruner,
        gives no such guarantee, so this is checked independently rather than
        trusted.
        """
        by_date = {}
        for scheduled in system.scheduled_exams:
            by_date.setdefault(scheduled.date, []).append(scheduled)

        assignment = {}
        for scheduled_list in by_date.values():
            colors = self.color([scheduled.exam for scheduled in scheduled_list])
            if colors is None:
                return None
            for scheduled in scheduled_list:
                assignment[scheduled] = self.time_slots[colors[scheduled.exam]]
        return assignment
