"""Allocating rooms to the exams of a system (the module of version 3.0).

Every exam of a date is seated in rooms of its own: a room holds one exam on a
given date, so two exams never overlap in a room, exactly the way two exams of
one study year never overlap on a date. An exam that needs more seats than the
largest free room has is spread over several rooms.

The allocation is done for one exam system at a time, after its dates are fixed.
"""

from ..model.room import RoomAllocation, RoomBooking


class RoomAllocator(object):
    """Seats the exams of an exam system in the rooms of the campus."""

    def __init__(self, rooms, default_students=30):
        #: Smallest room first: an exam is given the smallest room it fits in,
        #: which keeps the large rooms free for the exams that need them.
        self.rooms = sorted(rooms, key=lambda room: (room.capacity, room.name))
        self.default_students = default_students

    @property
    def total_capacity(self):
        return sum(room.capacity for room in self.rooms)

    def students_of(self, exam):
        return exam.course.students_or(self.default_students)

    def allocate(self, system):
        """Return the `RoomAllocation` of a whole exam system."""
        by_date = {}
        for scheduled in system.scheduled_exams:
            by_date.setdefault(scheduled.date, []).append(scheduled)

        bookings = {}
        failures = []
        for date in sorted(by_date):
            self._allocate_day(date, by_date[date], bookings, failures)
        return RoomAllocation(bookings, failures)

    def can_allocate(self, system):
        """True when every exam of the system can be seated."""
        return self.allocate(system).is_complete

    def _allocate_day(self, date, scheduled_exams, bookings, failures):
        # The exam with the most students picks first: it is the one that a
        # late pick would leave without a room large enough.
        ordered = sorted(scheduled_exams,
                         key=lambda item: (-self.students_of(item.exam),
                                           item.exam.course.number))
        free = list(self.rooms)
        for scheduled in ordered:
            needed = self.students_of(scheduled.exam)
            taken = self._take_rooms(free, needed)
            if taken is None:
                failures.append(
                    "%s %s on %s needs %d seats, only %d are free that day"
                    % (scheduled.exam.course.number, scheduled.exam.course.name,
                       date.strftime("%d-%m-%Y"), needed,
                       sum(room.capacity for room in free)))
                continue
            for room in taken:
                free.remove(room)
            bookings[scheduled.exam.key] = RoomBooking(scheduled.exam, date, taken)

    def _take_rooms(self, free, needed):
        """The rooms one exam is given, or None when it cannot be seated."""
        for room in free:  # smallest first: the smallest room that holds it all
            if room.capacity >= needed:
                return [room]
        # No single room is large enough, so fill it with the largest ones.
        taken = []
        seats = 0
        for room in reversed(free):
            taken.append(room)
            seats += room.capacity
            if seats >= needed:
                return taken
        return None
