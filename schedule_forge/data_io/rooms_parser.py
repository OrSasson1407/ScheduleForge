"""Parser of the rooms file (the room allocation module of version 3.0).

Record layout, one line each, in the format of Appendix A:
    room name / capacity / location (optional)
"""

from ..model.room import Room
from .errors import DataFileError
from .record_reader import RecordFileReader


class RoomsParser(object):
    """Builds `Room` objects out of the rooms data file."""

    def __init__(self, path):
        self.path = path

    def parse(self):
        records = RecordFileReader(self.path).read_records()
        if not records:
            raise DataFileError(self.path, "the rooms file holds no records")
        rooms = []
        seen = set()
        for record in records:
            room = self._parse_record(record)
            if room.name in seen:
                raise DataFileError(self.path, "room '%s' appears twice"
                                    % room.name, record[0].number)
            seen.add(room.name)
            rooms.append(room)
        return rooms

    def _parse_record(self, record):
        if len(record) < 2:
            raise DataFileError(
                self.path,
                "a room record needs at least 2 lines (name and capacity) but "
                "holds %d" % len(record), record[0].number)
        capacity_line = record[1]
        try:
            capacity = int(capacity_line.text)
        except ValueError:
            raise DataFileError(self.path, "capacity '%s' is not a number"
                                % capacity_line.text, capacity_line.number)
        if capacity < 1:
            raise DataFileError(self.path, "capacity %d is not a positive number"
                                % capacity, capacity_line.number)
        location = record[2].text if len(record) > 2 else ""
        return Room(record[0].text, capacity, location)
