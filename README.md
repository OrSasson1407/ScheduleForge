# ScheduleForge

[![GitHub repo](https://img.shields.io/badge/GitHub-OrSasson1407%2FScheduleForge-181717?logo=github)](https://github.com/OrSasson1407/ScheduleForge)
[![CI](https://github.com/OrSasson1407/ScheduleForge/actions/workflows/ci.yml/badge.svg)](https://github.com/OrSasson1407/ScheduleForge/actions/workflows/ci.yml)

Exam scheduling tool for the Faculty of Engineering: it reads the courses, the
exam periods and the study programs the user selected, and produces the conflict
free exam systems.

The repository holds the three versions, and version 3.0 works in both
interfaces:

* **version 3.0** - the threshold requirements that disqualify an exam system,
  the criteria that sort the systems that are left, and the extension: room
  allocation, calendar (`.ics`) export, staff constraints, a night mode, dragging
  an exam to another day with the illegal days blocked, a colour tag per study
  program, and real-time collaboration with a mutex on the exam being dragged.
  Eleven further upgrades - importing a spreadsheet, a display time of day,
  a printable timetable, comparing two systems side by side, undo/redo,
  searching the calendar, a mobile-friendly layout, an accessibility pass,
  notification drafts of a schedule change, a viewer role for collaboration,
  and a search performance dashboard - are described in `DESIGN.md`, part VII.
  Five further scheduling factors - institution-wide blackout dates, a
  minimum gap between moed Aleph and moed Bet of the same course, a cap on
  exams of one program and year within a sliding window, real per-student
  enrollment conflicts, and time-of-day as an opt-in constraint the search
  itself can enforce rather than only a display choice - are specified in
  `REQUIREMENTS-SCHEDULING-EXTENSION.md` and described in `DESIGN.md`,
  part XIII.
* **version 2.0** - `web/`, the visual interface: an input screen, a settings
  screen and an output screen that shows the exam systems on a year calendar.
* **version 1.0** - `schedule_forge/` and `main.py`, the engine and its file
  based command line interface.

`REQUIREMENTS-V3-EXTENSION.md` specifies the extension of section 4 and
`REQUIREMENTS-SCHEDULING-EXTENSION.md` specifies the five factors above;
`DESIGN.md` describes the design of all of it.

---

# Version 2.0 - the screens

A React application in TypeScript. It runs in the browser, but needs the
small Node server of `server/` (below) for anything that has to be shared
between browsers rather than kept to the one that made it: signing in,
real-time collaboration, and publishing a schedule for students to see.
Without the server running, the software still loads, but no one can get
past the sign-in screen.

## Running

```bash
cd web
```

```bash
npm install
```

```bash
npm run dev
```

The browser opens at `http://localhost:5173`. `npm run build` writes a static
site to `web/dist` that can be opened from any web server.

## Using it

The header holds three tabs - **Input**, **Settings**, **Output** - matching
the three groups the requirements themselves fall into: everything requirement
2 asks the user to provide, what requirement sections 2 and 3 of version 3.0
let the user tune, and what the search produces.

1. **Input.** A dense two column page rather than one long scroll: data files
   and study programs on the left, exam periods and an exclusion calendar on
   the right.
   * *Data files* - "Replace" reads a courses file or an exam periods file in
     the format of Appendix A - `data/courses.txt` and `data/exam_periods.txt`
     are examples - "Add" adds the records of a file to the ones already
     loaded instead of replacing them. The rooms file and the staff
     constraints file (version 3.0) are loaded here too, and are optional.
     "Import CSV" reads the courses file or the exam periods file from a
     spreadsheet instead - save it as CSV first (Excel, Google Sheets: File >
     Download/Save As > CSV); the screen states the column layout each one
     expects. Every value is checked the same way and rejected with the same
     wording as a badly formed Appendix A file. Two more files, both optional
     (`DESIGN.md`, part XIII): institution-wide excluded dates, in the same
     Appendix A format as the staff constraints file but with no instructor
     to name, and a real per-student enrollment roster - a plain
     `StudentID,CourseNumber` CSV, the only data file in this software with no
     Appendix A text form of its own, since it is genuinely tabular per-fact
     data rather than the hand-typed records the other files hold.
   * *Study programs* - up to five are picked from the list, built entirely
     from whatever program numbers the loaded courses file mentions (nothing
     is built into the software itself - an empty list here means no courses
     file has been loaded yet). Every picked program gets a colour tag (click
     the dot next to it to change it) and can be opened to show its courses by
     year and semester, with Obligatory or Elective and the evaluation of each
     one.
   * *Exam periods* - the table moves the start and the end of every exam
     period; the exclusion calendar below it is a dense grid of every real
     day the periods span, one small square per day, and a click takes a day
     out of the exam season or puts it back.

   "Produce the exam systems" sits in a bar fixed to the foot of the page.

2. **Settings.** The threshold requirements of version 3.0, each with its own
   k and its own icon, plus two more from the five scheduling factors of
   `DESIGN.md` part XIII - a minimum gap between moed Aleph and moed Bet of
   the same course, and a cap on exams of one program and year within a
   sliding window - and the criteria the systems are sorted by, dragged
   into the order of preference with the up/down arrows next to their rank.
   The five criteria of version 3.0 are on by default, so a plain run
   already looks for the best systems instead of merely the first ones that
   happen to pass; the two new criteria that match the two new thresholds
   are available to add but start off, so turning on a new threshold never
   silently changes the sort order of a run that never asked for it.
   Changing only the sorting orders the list again without searching again;
   changing a threshold or a criterion's direction does search again,
   because when at least one criterion is on, the search keeps looking for
   a better system until it runs out of systems, time, or its examine
   budget - never stopping merely because it has found `max_candidates` of
   them (`DESIGN.md`, part VI). A fourth card, **Hour of Day**, gives every
   exam of a found system a display time of day, spread across the time
   slots typed there; by default the search itself still schedules by date
   alone, never by hour, exactly as it always has (`DESIGN.md`, part VII,
   section 24) - a separate "Enforce time slots during search" toggle,
   off by default, turns that into a real constraint instead: two exams
   that need different times may then only share a date if a slot is
   actually free for each of them (`DESIGN.md`, part XIII, section 68).
   Institution-wide blackout dates and a real per-student enrollment file
   are loaded from the input screen's file section, both optional. While
   connected to a collaboration room as a viewer, this whole screen is
   read-only.
3. **Output.** A sidebar splits the system on screen into six readings of the
   same data, never six different systems: **Overview** - the week by week
   calendar, a strip of KPI cards (average gap, worst elective collisions,
   room utilisation, the busiest day), a search box, and the legend that
   highlights or dims by study program; **Metrics** - every number of section
   3 at once; **Rooms** - which room every exam was given, and what could not
   be seated; **Compare** - every metric of the system on screen against any
   other system the search kept, side by side; **Benchmarks** - a history of
   how long past searches took and how much of the search space they covered,
   kept in this browser only; **Export** - every `.ics` calendar as its own
   card, and, once an edit has actually moved an exam, a notification draft
   per affected study program and year, opened in your own mail client (this
   software holds no student email address and sends nothing itself).
   "Previous system" / "Next system", undo/redo of a hand edit, "Save this
   system" and "Print / Save PDF" stay reachable in the bars above and below
   the sidebar whichever tab is open.

   Every exam block can be **dragged to another day**: while it is in the air,
   only the days that keep it legal - the threshold requirements, the other
   exams, the room capacity, the instructor's availability - light up green,
   and dropping it there edits the system on the spot. "Reset to the system
   that was found" discards every edit at once; the ↶/↷ buttons undo or redo
   one edit at a time. The search box above the calendar dims every exam
   whose course number, name or instructor does not match, and composes with
   the study program legend rather than replacing it.

The icon in the header switches between day and night mode; night is the
default look the interface was designed around.

Everything that was loaded and edited is kept in the internal storage of the
browser, so a later run does not have to load the files again.

`DESIGN.md`, part II, describes the earlier screens and the idea behind their
design; part IV describes the drag & drop legality, the colour tags and the
collaboration protocol; part V describes this visual design system; part VII
describes the eleven upgrades above and how each one was verified.

The layout adapts down to a phone-sized screen, and every control keyboard
focus lands on is clearly outlined, so the software does not need a mouse or
a wide monitor to be usable.

## Real-time collaboration

Several people can edit the same exam system together: a drag one of them
makes is seen by everyone else the moment it lands, a threshold or sorting
change on the settings screen reaches every connected screen, and an exam
someone else is currently dragging is shown locked and cannot be dragged by
anyone else until they let go (the mutex). Joining a room asks for a role,
**editor** or **viewer**: a viewer sees every live move and every settings
change but cannot drag an exam or change a threshold themselves - the
Settings screen goes read-only, and the calendar's exam chips are not
draggable - enforced both on the screen itself and, independently, by the
relay server, so it holds even for a viewer that tries to bypass their own
browser. Everyone in the room sees who is an editor and who is a viewer.

This needs the small server of `server/`, which keeps its data in Firestore
rather than a file - chosen specifically because its free tier is free
indefinitely, no card, no expiration. For local development, that means the
Firebase Local Emulator Suite rather than a real Firebase project;
`DEPLOYMENT.md`'s "Local development" section has the setup (the Firebase
CLI, a JVM) and the full environment variable list (`server/.env.example`).
Once the emulator is running:

```bash
cd server
```

```bash
npm install
```

```bash
npm start
```

It listens on `ws://localhost:8787` for collaboration and, on the same port,
to plain HTTP requests for signing in and publishing a schedule (below). For
collaboration specifically, it holds nothing but a live relay: no scheduling
rule is checked there, since the browser already knows every rule and only
asks the server to arbitrate who may drag which exam right now. Everyone who
wants to edit the same exam system opens the "🤝 Collaborate" panel in the
header, gives the server address (the default is right for everyone on the
same machine or network as the server), agrees on a room code out loud, picks
a name and picks whether to join as an editor or a viewer. A room lives only
in memory, so restarting the server forgets it - enough for one classroom
session. The accounts, places and published schedules the next section
describes are not room state and do persist across a restart, in the
database.

## Accounts, places and roles

The whole application sits behind a sign-in screen. An admin creates
**places** - a university, a high school, a college, anything - and every
other account belongs to exactly one. Who signs in, and which place they
belong to, decides what they see:

- **editor** - everything described above, unchanged, scoped to their own
  place; publishing only ever reaches that place's students and teachers.
- **teacher** - one read-only page: every exam they teach, matched by the
  instructor name they registered with.
- **student** - one read-only page: every exam that applies to the study
  program and year they registered with.
- **admin** - one page: every place (create more from here), and every
  editor account that has registered, pending ones first, with Approve /
  Reject / Reset password actions. A teacher or student needs no approval to
  start using their account, since there is nothing a read-only account
  could do that approval would be protecting.
- **place admin** (`DESIGN.md`, part XII) - the same page as an admin, but
  scoped to one place: only that place's accounts, only its own pending
  editors to approve or reject. Created by the global admin from the new
  "Place Admins" panel, for an institution that wants to manage its own
  editors without seeing every other institution on the same deployment.

A new editor stays **pending**, unable to sign in, until an admin approves
them - and since that approval has to be visible on whichever computer the
new editor signs in from next, which is not necessarily the one they
registered on, it is the server that holds every account, not either
browser's own storage.

A fresh database has exactly one account, `admin`, whose password is set the
first time the server starts (`DEPLOYMENT.md`, "Deploying to Render" step
5). Set `SEED_DEMO_ACCOUNTS=true` instead for a classroom trial and it seeds
four fixed demo accounts - `admin`/`admin123`, `editor`/`editor123`,
`teacher`/`teacher123`, `student`/`student123` - never do this in production,
since those passwords are public (they're in this README).

Real hardening backs this (`DESIGN.md`, part X and, for the second round
below, part XII): a session lives in an `HttpOnly` cookie rather than a
token a script on the page could read, with a sliding 24-hour expiry; a
login is rate-limited and an account locks out for 15 minutes after 5 wrong
passwords in a row; a chosen password is checked against a common-password
list and against the account's own username, and cannot be one of an
account's last five; every account can see and revoke its own signed-in
sessions from the account menu; and a forgotten password has two paths
back - self-service, a one-hour single-use link emailed to the address on
file, or an admin (global, or that account's own place admin) resetting it
to a random temporary password relayed out of band. Either way the account
chooses its own new password on next sign-in. What is still missing - HTTPS
is your deployment's job, not this code's (`DEPLOYMENT.md`) - is listed in
full in `DESIGN.md`, part XII.

**Deploying this for real, past a laptop on one network**: two accounts, not
one - a Firebase project for the database (free, no card, no expiration)
alongside the Render account that hosts the server and the web app.
`DEPLOYMENT.md` has the full walkthrough for both, in order.

---

# Version 1.0 - the command line

## Requirements

Python 3.6 or newer. No third party package is used.

## Running

```bash
python main.py --courses data/courses.txt --periods data/exam_periods.txt --programs data/programs.txt --output output/exam_systems.txt
```

All four paths have the defaults shown above, so a plain run also works:

```bash
python main.py
```

Extra options:

| Option | Meaning | Default |
| --- | --- | --- |
| `--settings FILE` | the threshold requirements and the sorting criteria | none, so no threshold |
| `--rooms FILE` | the rooms of the campus; exams are then given rooms | none |
| `--faculty FILE` | the dates every instructor is not available on | none |
| `--global-excluded FILE` | dates no exam of any course may be held on, for the whole institution | none |
| `--enrollment FILE` | a `StudentID,CourseNumber` CSV of real enrollment, for conflicts the program/year model alone cannot see | none |
| `--calendars DIR` | write one `.ics` per study program and year of the best system | none |
| `--max-systems N` | keep at most the N best exam systems (`0` = no limit) | 1000 |
| `--time-limit S` | stop the search after S seconds (`0` = no limit) | 30 |
| `--count-only` | only report how many exam systems are possible | off |

A full run of version 3.0:

```bash
python main.py --settings data/settings.txt --rooms data/rooms.txt --faculty data/faculty_constraints.txt --calendars output/calendars
```

## How many exam systems are there?

The number of possible exam systems grows exponentially with the number of exams
(an exam period of D free dates and N exams allows up to D^N systems), so
writing every one of them is not physically possible for a real faculty. The
software therefore does two separate things:

* it **counts** all of them exactly, without enumerating anything - on the
  example data, 39,454,663,351,049,363,592,301,142,016,000,000 systems, reported
  in under a millisecond (`--count-only`);
* it **writes** the best `--max-systems` of them, by the sorting criteria that
  are on (all five, by default), stopping at the examine budget or the time
  limit of requirement 5.1. Not stopping the moment it has found enough is the
  whole point: the search keeps looking for a better system for as long as its
  budget allows, so what gets written is genuinely the best it found, not the
  first ones it happened to come across (`DESIGN.md`, part VI). The summary at
  the end of the output file always says how many systems were examined, how
  many of those passed the threshold requirements, and how many of those were
  kept.

The count is exact because the exams split into independent groups - the exams
of one study year of one program - and the number of systems is the product of
the numbers of each group. `DESIGN.md`, section 4, describes the engine; on the
example data it produces about 960,000 exam systems per second when merely
listed, and the run is then bounded by the size of the output file rather than
by the search - ranking every one of them against the best found so far costs
more, so a ranked run is bounded by the examine budget or the time limit
instead.

## Tests

```bash
python -m unittest discover -s tests
```

## Input files

The format is the one of Appendix A of the requirements document: UTF-8 text,
records separated by a line holding `$$$$`.

* `data/courses.txt` - one record per course: name, 5 digit number, instructor,
  one or more `program,year,semester,requirement` lines, evaluation.
* `data/exam_periods.txt` - one record per exam period: `semester, moed`, then
  `start date, end date`, then the excluded dates (a single date or a range,
  each with an optional comment).
* `data/programs.txt` - the study programs the user selected, up to five 5 digit
  numbers out of the catalogue of requirement 1.1.
* `data/rooms.txt` - one record per room: name, number of seats, location
  (version 3.0, optional).
* `data/faculty_constraints.txt` - one record per instructor: the name, then the
  dates that instructor is not available on (version 3.0, optional).
* `data/settings.txt` - the threshold requirements and the sorting criteria, one
  `name = value` per line (version 3.0, optional).
* a global excluded dates file (`--global-excluded`) - the same record format
  as `faculty_constraints.txt`, but every line of every record is a date line:
  no instructor to name, since these dates apply to the whole institution
  (`REQUIREMENTS-SCHEDULING-EXTENSION.md`, optional).
* an enrollment file (`--enrollment`) - plain CSV, `StudentID,CourseNumber`,
  one row per real enrollment fact, an optional header row
  (`REQUIREMENTS-SCHEDULING-EXTENSION.md`, optional). No example ships in
  `data/` for either of these two yet - a real one is at least a few rows of
  `StudentID,CourseNumber` for whichever courses in `courses.txt` should be
  checked against real enrollment.

A course record may hold one more line after the evaluation: how many students
the exam has to seat. Files without it are read exactly as before.

The files in `data/` are examples; replace them with the files of the course.

## Output

`output/exam_systems.txt` - one block per exam system, the exams grouped by
semester (FALL / SPRING) and by moed (Aleph / Bet) and sorted by date, each exam
line holding the date, the course number, the course name, the instructor and,
when a rooms file was given, the rooms of the exam. The head of the file states
the thresholds and the sorting that were used, and every block states what the
system is worth by the criteria of section 3.

`output/calendars/` - with `--calendars`, one `.ics` file per study program and
study year of the best exam system found.

## Layout

```
main.py                       command line interface (versions 1.0 and 3.0)
schedule_forge/app.py         the application, free of interface code
schedule_forge/settings.py    the thresholds and the sorting of version 3.0
schedule_forge/model/         courses, exams, exam periods, programs, rooms,
                               enrollment (part XIII)
schedule_forge/data_io/       parsers of the data files, output and .ics writers
schedule_forge/scheduling/    exams, rules, decomposition, thresholds, search,
                               time-slot colouring (part XIII)
tests/                        unit tests
data/                         example data files
web/                          the screens (React, TypeScript)
web/src/engine/               the same engine, carried over to the browser,
                               plus the colour tags, the drag & drop legality,
                               CSV import, hour-of-day assignment, notification
                               drafts, the benchmark history (part VII) and
                               time-slot colouring (part XIII)
web/src/screens/              the settings and output screens
web/src/components/           the input screens, the calendar, the collaboration panel
web/src/collab/               the client half of the real-time collaboration protocol
server/                       accounts, places, the published schedule and the
                               real-time collaboration relay (Node, optional -
                               part IX, part X, part XII)
```

`DESIGN.md` describes the classes and the way they work together (part I), the
screens of version 2.0 (part II), the eleven upgrades of part VII, access
control and hardening (parts IX, X, XII), and the five scheduling factors of
part XIII.
