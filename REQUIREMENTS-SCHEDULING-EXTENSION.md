# Software requirements document - five further scheduling factors

## A. Introduction

Sections 2 and 3 of the version 3.0 document, and the extension of section 4
(`REQUIREMENTS-V3-EXTENSION.md`), make the software find and prepare the exam
systems worth looking at. This document specifies five further factors added
to that same choosing process, each one either a hard rule the aggregate
study-program-and-year model of requirement 1.2 cannot express on its own, or
a capability the original requirements never asked the software to do at all.

Five capabilities are specified:

1. **Institution-wide blackout dates** - dates on which no exam of any course
   may be held, for the whole institution, alongside the per-instructor
   blackout dates of the version 3.0 extension.
2. **A minimum gap between the moedim of one course** - at least a stated
   number of days between moed Aleph and moed Bet of the same course, a rule
   about the course itself rather than about the students who sit it.
3. **A cap on exams of one program and year within a sliding window** - at
   most a stated number of exams of one study program and study year inside
   any span of consecutive days of a stated width.
4. **Real per-student enrollment conflicts** - a genuine student, taking two
   courses that do not even share a study program and year, is never given
   two exams on the same date, using an optional roster of real enrollment
   facts rather than the aggregate model alone.
5. **Time-of-day enforcement** - the display time of day the software already
   assigns a chosen exam system can, when turned on, become a real
   requirement the search itself is bound by, instead of only a choice made
   after a system is already found.

Every capability is optional and off by default: a run that does not turn any
of them on produces exactly the exam systems it would have produced before
this document, on both the file based version and the version with the
screens.

## B. Detailed requirements

### 1. General

1.1. All five capabilities are available in the graphical version (an
extension of V2.0/V3.0) and in the file based version (an extension of V1.0),
as requirement 1.1 of version 3.0 already asks of every capability.

1.2. Every capability is off unless the user turns it on; a run that turns
none of them on behaves exactly as a run of the software before this
document existed.

1.3. The two new data files (global excluded dates, enrollment) follow the
conventions already established for a data file of this software: the global
excluded dates file follows the record format of Appendix A of version 1.0
(UTF-8 text, records separated by a line holding four `$` signs); the
enrollment file is plain CSV, since it is one row per fact rather than a
hand-written record.

### 2. Institution-wide blackout dates

2.1. The software reads an optional data file of dates on which no exam of
any course may be held, for the whole institution - distinct from the
per-instructor staff constraints file of the version 3.0 extension, which
blocks dates for one instructor's own courses only.

2.2. Every date the file names is removed from every exam period's own
available dates, in addition to whatever dates that period already excludes
on its own.

2.3. Without this file, every exam period's available dates are exactly what
they were before this document, as if the file held no dates at all.

### 3. A minimum gap between the moedim of one course

3.1. When this threshold is on, at least `k` days separate any exam of moed
Aleph from any exam of moed Bet of the same course, in the same semester.

3.2. This is deliberately the opposite case from the gap requirements of
version 3.0 (2.1, 2.2), which hold only inside one exam period and never
relate an exam of one moed to an exam of another moed of the same course, on
the reasoning that a student sits only one of the two. This requirement holds
precisely *between* the two moedim, because it is not about the student: it
is time an instructor needs to grade one sitting, or a department needs to
prepare the room and paperwork for the other.

3.3. The requirement holds regardless of whether the two exams share a study
program and year, or any other slot, since it is a property of the course's
two sittings, not of who is scheduled into either one.

### 4. A cap on exams of one program and year within a sliding window

4.1. When this threshold is on, no more than `k` exams of one study program
and one study year fall inside any span of `w` consecutive calendar days,
where `k` and `w` are both given, and given together.

4.2. This is a genuine restriction beyond requirement 2.5 of version 3.0 (at
most `k` exams on one date): four exams of one program and year, one per day
across four consecutive days, satisfies 2.5 at every one of those four dates
and can still be disqualified by this requirement.

4.3. The span counted includes calendar days on which no exam of that
program and year is scheduled at all, the same way the gap requirements of
2.1/2.2 already count every calendar day, including days an exam period
itself excludes.

### 5. Real per-student enrollment conflicts

5.1. The software reads an optional enrollment file: one row per fact, a
student id and a course number, meaning that student is enrolled in that
course.

5.2. Two exams whose courses share at least one real, enrolled student, per
the file of 5.1, may never be held on the same date - regardless of whether
the two courses share a study program and year, and regardless of whether
either course is obligatory or elective in whatever study programs it is
taught in.

5.3. This requirement takes precedence over the elective/elective exception
of requirement 1.2: two elective courses of the same study program and year,
which 1.2 alone would allow to share a date, may still not share one once
the enrollment file proves a real student is enrolled in both.

5.4. Without an enrollment file, this requirement does nothing, and every
other requirement of version 1.0 and its extensions - including the
elective/elective exception of 1.2 - is unaffected by its absence.

5.5. A course the enrollment file never mentions is treated as having no
known enrolled students of its own; it does not conflict with anything under
this requirement on that basis, only under whatever other requirements
already apply to it.

### 6. Time-of-day enforcement

6.1. The software already assigns a display time of day to every exam of a
chosen system, from a list of time slots the user provides (the extension of
part VII, section 24 of `DESIGN.md`). By default that assignment is made
only after a conflict-free, date-only system has already been found, and
never disqualifies a system on its own.

6.2. When time-of-day enforcement is turned on, in addition to that default
behaviour, two exams that fall on the same date and that need different
times - because they share a study program and year, or, when the
enrollment file of requirement 5 is loaded, because a real student is
enrolled in both - may only be scheduled on that shared date if a time slot
is genuinely free for each of them; a date on which this is not possible is
disqualified, exactly as a date that breaks a threshold requirement already
is.

6.3. Turning this requirement on requires at least one time slot to already
be configured; the two are otherwise independent settings, so that the
existing, purely cosmetic time-of-day assignment of 6.1 is never turned into
a hard requirement by accident merely because time slots happen to be
configured for display.

6.4. This requirement is off by default. A run that does not turn it on
schedules by date alone, exactly as every version of this software has
before this document, regardless of whether time slots are configured for
display.

### 7. Software design

7.1. The two new data files each get a parser of their own in the data
layer, following the existing convention of one parser per file
(`DESIGN.md`, section 3).

7.2. Requirements 2 and 5 add rules to the scheduling layer, in the same
place the existing rules between two exams already live; requirement 3 adds
a new such rule of its own; requirement 4 and requirement 6 are counted over
more than the one date a single rule between two exams could express, so
they are checked incrementally as a candidate system is being built up,
exactly the way the aggregate thresholds of version 3.0 (2.3, 2.4, 2.5)
already are (`DESIGN.md`, section 10.2).

7.3. Every capability of this document is implemented once for each of the
two scheduling engines this software maintains - the file based engine of
version 1.0 and the engine carried into the browser for version 2.0/3.0
(`DESIGN.md`, section 8.2) - since the second is not derived from the first
and a change to only one would leave them disagreeing.

### 8. Performance

8.1. Reading the global excluded dates file and the enrollment file costs no
more than reading any other data file of this software.

8.2. Requirement 2 costs the search nothing beyond the cost the staff
constraints file of the version 3.0 extension already has: both only ever
remove dates before the search begins.

8.3. Requirements 3 and 5 are rules between two exams, exactly like the
rules of version 1.0 and version 3.0 already are, and cost the search
nothing beyond what any other such rule already costs.

8.4. Requirements 4 and 6 are checked incrementally as a candidate system is
being built, exactly like the aggregate thresholds of version 3.0, and are
bounded by the same examine-count and time-limit settings every threshold of
this software has always been bound by.

## C. Terms

**Blackout date** (institution-wide) - a date on which no exam of any course
may be held, for the whole institution, as opposed to a staff constraint,
which blocks a date for one instructor's own courses only.

**Moed Aleph, moed Bet** - the two sittings of one course's exam a study
program's students may choose between, as already defined in version 1.0.

**Window** - a span of a stated number of consecutive calendar days.

**Enrollment fact** - a statement that one named student is enrolled in one
named course, the unit the enrollment file of requirement 5 is built from.

**Time slot** - a time of day an exam may start, as already defined in the
extension of part VII, section 24 of `DESIGN.md`.

## Appendix A - the format of the new data files

### The global excluded dates file

Follows the record format of Appendix A of version 1.0, but with no line
naming who or what the dates apply to - every line of every record is a date
line, since these dates apply to the whole institution rather than to one
instructor.

| Name | Format | Example |
| --- | --- | --- |
| New Record Separator | 4 consecutive "$" signs | `$$$$` |
| Excluded 1 | Date Comment, or Start date, End date Comment | `01-02-2026 University closure` |
| Excluded 2 (if exists) | … | `14-03-2026, 15-03-2026 Purim` |

Date: String DD-MM-YYYY.
Start Date, End Date: Date, Date, requiring Start Date <= End Date.
Comment: String (optional).

### The enrollment file

Plain CSV, not the record format of Appendix A - genuinely tabular per-fact
data, one row per enrollment fact, unlike every other data file of this
software.

| Column | Format | Example |
| --- | --- | --- |
| `StudentID` | String | `2021001` |
| `CourseNumber` | String, matching a course number of the courses file | `83112` |

A header row naming these two columns is optional and is skipped when
present. The same student and course number appearing more than once is
read as the same one fact. A course number this file names that the courses
file does not is not an error - as with an instructor's name in the staff
constraints file (version 3.0 extension, requirement 4.5), it simply
constrains nothing.

### The addition to the settings file (sections 2 and 3, file based version)

Extends the settings table of `REQUIREMENTS-V3-EXTENSION.md`'s own Appendix
A; a name that is not written keeps its default, which for a threshold means
that threshold is off.

| Name | Meaning | Example |
| --- | --- | --- |
| `min_gap_between_moeds` | requirement 3.1 | `5` |
| `max_exams_per_window` | requirement 4.1, given together with `window_days` | `2` |
| `window_days` | requirement 4.1, given together with `max_exams_per_window` | `3` |
| `time_slots` | the times of day an exam may start, earliest first | `09:00, 13:00, 16:00` |

Requirements 2 and 5's two new data files are given as their own
command-line options in the file based version (`--global-excluded`,
`--enrollment`) rather than as settings-file entries, following the same
convention the rooms file and the staff constraints file of the version 3.0
extension already use. In the file based version, requirement 6 is on
whenever `time_slots` is configured; the version with the screens keeps a
second, independent switch of its own for it, since that version's time
slots setting already has a use - the display assignment of 6.1 - with or
without requirement 6 turned on.
