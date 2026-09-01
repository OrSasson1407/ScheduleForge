"""Exporting an exam system to calendar files (the module of version 3.0).

One .ics file is written per study program and study year, so a student of, say,
software engineering year 2 imports one file into Google Calendar or Apple
Calendar and sees exactly the exams of that year.

The files follow RFC 5545: an all day event per exam - the software schedules
dates, not hours - with the course, the moed and, when rooms were allocated,
the room the exam is held in.
"""

import io
import os

PRODUCT_ID = "-//ScheduleForge//Exam Schedule 3.0//EN"


def _escape(text):
    """RFC 5545 escaping of a text value."""
    return (text.replace("\\", "\\\\").replace(";", "\\;")
            .replace(",", "\\,").replace("\n", "\\n"))


def _fold(line):
    """RFC 5545 folding: a content line is at most 75 octets."""
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return line
    pieces = []
    start = 0
    limit = 75
    while start < len(raw):
        end = min(start + limit, len(raw))
        # Never cut a UTF-8 character in half.
        while end > start and end < len(raw) and (raw[end] & 0xC0) == 0x80:
            end -= 1
        pieces.append(raw[start:end].decode("utf-8"))
        start = end
        limit = 74  # the continuation lines carry a leading space
    return "\r\n ".join(pieces)


def _stamp(moment):
    return moment.strftime("%Y%m%dT%H%M%SZ")


def _day(date):
    return date.strftime("%Y%m%d")


class CalendarExporter(object):
    """Turns one exam system into the calendar of a program and a year."""

    def __init__(self, allocation=None, catalog=None):
        self.allocation = allocation
        self.catalog = catalog

    def calendars_of(self, system, selected_programs):
        """Every calendar of a system: {(program, year): the text of a file}."""
        groups = {}
        for scheduled in system.scheduled_exams:
            for program, year in scheduled.exam.slots:
                if program not in selected_programs:
                    continue
                groups.setdefault((program, year), []).append(scheduled)

        calendars = {}
        for key in sorted(groups):
            scheduled_exams = sorted(
                groups[key],
                key=lambda item: (item.date, item.exam.course.number))
            calendars[key] = self._calendar(key, scheduled_exams)
        return calendars

    def write(self, directory, system, selected_programs):
        """Write the calendars into `directory` and return the paths written."""
        if directory and not os.path.isdir(directory):
            os.makedirs(directory)
        written = []
        for (program, year), text in self.calendars_of(
                system, selected_programs).items():
            path = os.path.join(directory, "exams-%s-year-%d.ics" % (program, year))
            with io.open(path, "w", encoding="utf-8", newline="") as handle:
                handle.write(text)
            written.append(path)
        return written

    def _calendar(self, key, scheduled_exams):
        from datetime import datetime, timedelta

        program, year = key
        name = self.catalog.name_of(program) if self.catalog else program
        now = datetime.utcnow()

        lines = ["BEGIN:VCALENDAR",
                 "VERSION:2.0",
                 "PRODID:%s" % PRODUCT_ID,
                 "CALSCALE:GREGORIAN",
                 "METHOD:PUBLISH",
                 "X-WR-CALNAME:%s" % _escape("Exams - %s - year %d" % (name, year))]
        for scheduled in scheduled_exams:
            exam = scheduled.exam
            requirement = exam.slots.get((program, year))
            rooms = self.allocation.rooms_of(exam) if self.allocation else []
            summary = "%s %s (moed %s)" % (exam.course.number, exam.course.name,
                                           exam.moed.display_name)
            description = ["Course: %s %s" % (exam.course.number, exam.course.name),
                           "Instructor: %s" % exam.course.instructor,
                           "Semester: %s, moed %s" % (exam.semester.display_name,
                                                      exam.moed.display_name),
                           "Study program: %s %s, year %d" % (program, name, year)]
            if requirement is not None:
                description.append("Type: %s" % requirement.display_name)
            if rooms:
                description.append("Rooms: %s"
                                   % ", ".join(room.name for room in rooms))

            lines.append("BEGIN:VEVENT")
            lines.append("UID:%s-%s-%s-%d@scheduleforge"
                         % (exam.course.number, exam.moed.value, program, year))
            lines.append("DTSTAMP:%s" % _stamp(now))
            lines.append("DTSTART;VALUE=DATE:%s" % _day(scheduled.date))
            lines.append("DTEND;VALUE=DATE:%s" % _day(scheduled.date + timedelta(days=1)))
            lines.append("SUMMARY:%s" % _escape(summary))
            lines.append("DESCRIPTION:%s" % _escape("\n".join(description)))
            if rooms:
                location = ", ".join(
                    room.name + (" (%s)" % room.location if room.location else "")
                    for room in rooms)
                lines.append("LOCATION:%s" % _escape(location))
            lines.append("TRANSP:OPAQUE")
            lines.append("END:VEVENT")
        lines.append("END:VCALENDAR")
        return "\r\n".join(_fold(line) for line in lines) + "\r\n"
