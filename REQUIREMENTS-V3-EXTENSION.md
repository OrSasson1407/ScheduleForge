# Software requirements document - the extension of version 3.0

## A. Introduction

Sections 2 and 3 of the version 3.0 document make the software find the exam
systems that are worth looking at. This document specifies the extension of
section 4: what the software does with an exam system once it has been chosen,
and what it needs in order to choose one that a faculty can actually run.

Three capabilities are specified, and one addition to the interface:

1. **Room allocation** - the exams of a chosen system are seated in the rooms of
   the campus, and a system that cannot be seated is not offered.
2. **Calendar export** - a chosen exam system is written as standard `.ics`
   files, one per study program and study year, which a student imports into
   Google Calendar or Apple Calendar.
3. **Staff constraints** - the dates on which the instructor of a course cannot
   be present are read from a file, and no exam of that course is placed on one
   of them.
4. **Day and night mode** - the screens can be shown light or dark.

The three capabilities answer the same need, seen from the three sides of an
exam season: the rooms it needs, the people who have to be there, and the
students who have to know when to come. The scheduling of version 1.0 assumed
all three away.

Every capability is available both in the version with the screens and in the
file based version, as requirement 1.1 of version 3.0 asks.

## B. Detailed requirements

### 1. General

1.1. The three capabilities are available in the graphical version (an
extension of V2.0) and in the file based version (an extension of V1.0).

1.2. The two new data files follow the format of Appendix A of version 1.0:
UTF-8 text, records separated by a line holding four `$` signs.

1.3. Both new files are optional. Without a rooms file the software schedules
exactly as version 2.0 did and gives no rooms; without a staff constraints file
no instructor is treated as unavailable.

### 2. Room allocation

2.1. The software reads a rooms data file. Every record holds the name of a
room, the number of seats it has, and, optionally, where it is.

2.2. The number of students of a course is read from the courses file, as an
optional last line of a course record. A course that does not state it is given
the number in `default_students` of the settings.

2.3. For a given exam system, every exam is allocated the rooms it is held in:

2.3.1. A room holds at most one exam on a given date. Two exams of one date
therefore never overlap in a room, in the same way that two exams of one study
year never overlap on a date in version 1.0.

2.3.2. The rooms an exam is given have at least as many seats together as the
exam has students.

2.3.3. An exam that needs more seats than the largest free room has is spread
over more than one room.

2.3.4. The total number of students examined on one date may not be larger than
the number of seats in the rooms that are free on that date. That follows from
2.3.1 and 2.3.2 and is stated here because it is the rule the user thinks in.

2.4. The allocation is deterministic: the exam with the most students is seated
first, and it is given the smallest room it fits in, so that the large rooms
stay free for the exams that need them.

2.5. When the software cannot seat every exam of a system, it says which exams
were left without a room, how many seats they need and how many were free.

2.6. `require_rooms` is a threshold requirement in the sense of section 2 of
version 3.0: when it is on, an exam system whose exams cannot all be seated is
disqualified, exactly like a system that breaks 2.5 of that section.

2.7. The rooms of every exam are shown on the output screen, are written into
the output file, and are carried into the calendar files of requirement 3.

### 3. Calendar export

3.1. A chosen exam system can be written as `.ics` files that follow RFC 5545.

3.2. One file is produced per study program and study year: a student of
software engineering, year 2, receives the exams of that year and nothing else.

3.3. Every exam is one all-day event. The software schedules dates and not
hours, so an event that claimed an hour would state something the software does
not know.

3.4. An event holds:
    the course number and the course name, and the moed, in its title;
    the course, the instructor, the semester and moed, the study program and
    year, and whether the course is obligatory or elective, in its description;
    the rooms of the exam, in its location, when rooms were allocated.

3.5. An event carries a stable identifier built from the course, the moed, the
program and the year, so that importing the file again updates the exams
already in the calendar instead of adding them a second time.

3.6. In the graphical version every calendar is one button press; in the file
based version a directory is given and the files of the best exam system found
are written into it.

### 4. Staff constraints

4.1. The software reads a staff constraints data file. Every record holds the
name of an instructor and the dates that instructor is not available on, each
of them a single date or a range of dates, with an optional comment.

4.2. An exam of a course is never placed on a date on which the instructor of
that course is not available.

4.3. The rule is about one exam alone. It therefore narrows the dates that exam
may take, and does not relate two exams to each other; the exact number of
possible exam systems stays exact.

4.4. When the constraints leave a course without any date at all, the software
says which course it is and stops, instead of reporting that no exam system
exists.

4.5. The name of the instructor in the constraints file is the name in the
courses file. An instructor the courses file does not know constrains nothing.

### 5. Day and night mode

5.1. The screens can be shown in a light or a dark colour scheme.

5.2. The choice is one button press, and it is remembered in the internal
storage of the software together with the rest of the settings.

5.3. Changing the colour scheme changes nothing about the data, the settings or
the exam systems that were found.

### 6. Software design

6.1. The capabilities keep the design of the earlier versions: the rules that
relate two exams stay in the scheduling layer, the two new files get a parser
each in the data layer, and the room allocation and the calendar export are
classes of their own that work on a finished exam system.

6.2. Room allocation and calendar export run on an exam system after its dates
are fixed, so they do not enter the search and do not change its cost.

### 7. Performance

7.1. Reading the two new files costs no more than reading the files of version
1.0.

7.2. The staff constraints cost the search nothing: they only remove dates
before it starts.

7.3. Allocating the rooms of one exam system is linear in the number of exams
of a date and in the number of rooms. When `require_rooms` is on, the allocation
runs for every system that reached it, so the search states a time limit.

7.4. Writing the calendars of one exam system is linear in the number of exams.

## C. Terms

**Room** - a place an exam is held in, with a name, a number of seats and,
optionally, a location.

**Room allocation** - a mapping from every exam of an exam system to the rooms
it is held in, with no room holding two exams on one date.

**Seat** - one place for one student in one room.

**Staff constraint** - a date, or a range of dates, on which a named instructor
cannot be present at an exam.

**Calendar file** - a file in the iCalendar format (RFC 5545), holding the exams
of one study program and one study year of one exam system.

## Appendix A - the format of the new data files

### The rooms file

| Name | Format | Example |
| --- | --- | --- |
| New Record Separator | 4 consecutive "$" signs | `$$$$` |
| Room name | String | `Hall 1101-A` |
| Capacity | Whole number, one or more | `250` |
| Location (if exists) | String | `Building 1101, ground floor` |

### The staff constraints file

| Name | Format | Example |
| --- | --- | --- |
| New Record Separator | 4 consecutive "$" signs | `$$$$` |
| Instructor name | String | `Prof. R. Cohen` |
| Unavailable 1 | Date Comment, or Start date, End date Comment | `02-02-2026 Conference` |
| Unavailable 2 (if exists) | … | `09-02-2026, 11-02-2026 Abroad` |

Date: String DD-MM-YYYY.
Start Date, End Date: Date, Date, requiring Start Date <= End Date.
Comment: String (optional).

### The addition to the courses file

A course record may hold one more line after the evaluation:

| Name | Format | Example |
| --- | --- | --- |
| Students (if exists) | Whole number, one or more | `220` |

A course record without it is read exactly as in version 1.0, so the files of
the earlier versions are still legal.

### The settings file (sections 2 and 3, file based version)

One `name = value` per line; `#` starts a comment; a name that is not written
keeps its default, which for a threshold means that the threshold is off.

| Name | Meaning | Example |
| --- | --- | --- |
| `min_days_between_obligatory` | threshold 2.1 | `3` |
| `min_days_between_any` | threshold 2.2 | `2` |
| `max_elective_collisions` | threshold 2.3 | `1` |
| `min_obligatory_span` | threshold 2.4 | `10` |
| `max_exams_per_day` | threshold 2.5 | `5` |
| `require_rooms` | every exam has to be seated | `yes` |
| `sort` | the criteria of section 3, most important first | `min_days_between_obligatory, max_exams_per_day` |
| `max_candidates` | how many exam systems to keep | `200` |
| `max_examined` | how many exam systems to look at | `200000` |
| `time_limit_seconds` | how long the search may take | `30` |
| `default_students` | students of a course that does not state its own | `60` |
