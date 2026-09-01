"""Examination rooms (the room allocation module of version 3.0)."""


class Room(object):
    """One room an exam can be held in: how many seats it has, and where."""

    __slots__ = ("name", "capacity", "location")

    def __init__(self, name, capacity, location=""):
        self.name = name
        self.capacity = capacity
        self.location = location

    def __repr__(self):
        return "Room(%s, %d)" % (self.name, self.capacity)


class RoomBooking(object):
    """The rooms one exam was given, on the date it was placed on."""

    __slots__ = ("exam", "date", "rooms")

    def __init__(self, exam, date, rooms):
        self.exam = exam
        self.date = date
        self.rooms = list(rooms)

    @property
    def seats(self):
        return sum(room.capacity for room in self.rooms)

    def __repr__(self):
        return "RoomBooking(%s, %s, %s)" % (
            self.exam.course.number, self.date,
            ", ".join(room.name for room in self.rooms))


class RoomAllocation(object):
    """The result of allocating rooms to a whole exam system."""

    __slots__ = ("bookings", "failures")

    def __init__(self, bookings, failures):
        #: RoomBooking per exam, keyed by the exam key.
        self.bookings = bookings
        #: Readable reasons, one per exam that could not be seated.
        self.failures = list(failures)

    @property
    def is_complete(self):
        return not self.failures

    def rooms_of(self, exam):
        booking = self.bookings.get(exam.key)
        return booking.rooms if booking is not None else []
