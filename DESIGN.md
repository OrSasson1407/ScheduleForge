# ScheduleForge - software design document

Part I (sections 1 to 7) describes version 1.0: the main parts of the software,
the main classes, their role, and the methods and variables that belong to them.
Part II (sections 8 and 9) describes the user interface added in version 2.0,
its menus, the idea behind its design and examples of its use, as requirement
7.3 asks. Part III (sections 10 to 13) describes version 3.0: the threshold
requirements, the sorting, the extension of section 4 and the settings screen.
Part IV (sections 14 to 16) describes three later additions to the screens:
dragging an exam to another day, a colour tag per study program, and real-time
collaborative editing. Part V (sections 18 and 19) describes the visual
redesign of the screens - the token system, its components, and where it was
adapted rather than copied from the mockups it started from, and why. Part VI
(sections 20 to 22) describes the search finding the genuinely best exam
systems rather than the first ones found, a walk that could wrongly report
itself complete and how that was fixed, and the study program catalogue no
longer being built into the code. Part VII (sections 23 to 35) describes
eleven upgrades chosen from a longer list of candidates: reading a course
schedule from a spreadsheet, a display time of day laid over the search's
own date-only placement, a printable timetable, comparing two found systems
side by side, undo/redo of a hand edit, searching and filtering the calendar,
a layout that holds up on a phone, an accessibility pass, notification drafts
of a schedule change, a viewer role for the collaboration room, and a history
of how the search itself performed. Part VIII (sections 36 to 40) describes
entering courses, rooms and staff constraints straight into the screen
instead of through a file, building an exam period from nothing, a bug this
surfaced in editing a period's dates, and the checks that refuse a search
over data that is not yet fit to be searched with. Part IX (sections 41 to
45) describes access control: three kinds of account - an admin, editors,
and a read-only viewer for students - a new registration and approval flow
for editor accounts, and why that flow needed the collaboration server of
part IV to grow a second, unrelated job rather than staying a browser-only
check the way the first pass at this feature started out. Part X (sections
46 to 52) describes two changes made at the same time, for the same reason -
this was no longer one class's worth of accounts and no longer a demo:
places, so more than one institution can use the same deployment without
seeing each other's data, a viewer role split into a teacher and a student
each reading a narrower slice of a place's schedule, and everything that
phrase "no longer a demo" required underneath - a real database, sessions
that expire, a password reset that survives being asked twice, and an
actual path to a server another person could depend on rather than one
that only ever ran on the machine that built it. Part XI (sections 53 to
57) describes the one piece of part X that did not survive contact with an
actual deployment: Postgres, whose free tier turned out to expire 30 days
after creation, replaced with Firestore, whose free tier does not expire at
all - the database swapped out from underneath `server/store.js` a second
time, what had to change to move from rows to documents, and the real
Blueprint bugs and a real, live walkthrough of standing the whole thing up
that only doing it for real, not just building toward it, ever surfaced.
The code holds the internal documentation that completes all eleven. Part
XII (sections 58 to 63) describes six account-security upgrades chosen
together from a longer list, because they cluster into one coherent posture
rather than six unrelated features: cookie-based sessions replacing the
bearer token part IX built, and the CSRF defense that transport requires; a
password policy that checks strength beyond length and remembers an
account's last five passwords so none of them can simply be reused; a session/device
list an account can see and revoke from; the `placeAdmin` role, an
administrator scoped to one place rather than every place; and a
self-service "forgot password" email flow alongside the admin-mediated reset
part X already had. Part XIII (sections 64 to 69) describes five further
scheduling factors chosen from a brainstormed list of gaps in the model of
part III: institution-wide blackout dates on top of the per-instructor ones
of the version 3.0 extension, a minimum gap between moed Aleph and moed Bet
of the same course, a cap on how many exams of one study program and year
fall inside any short window of days, real per-student enrollment conflicts
the aggregate program-and-year model of requirement 1.2 cannot see on its
own, and time-of-day turned from the purely cosmetic layer of section 24
into a real constraint the search itself can be asked to enforce.

The requirements of the extension of section 4 are specified in a document of
their own, `REQUIREMENTS-V3-EXTENSION.md`, as requirement 4.2 asks; the five
scheduling factors of part XIII are specified the same way, in
`REQUIREMENTS-SCHEDULING-EXTENSION.md`.

---

# Part I - version 1.0, the engine

## 1. Structure

The software is built in four layers, each one a package. A layer only knows the
layers below it, which is what keeps the changes of the next versions local
(requirement 4.3).

```
main.py                 command line interface (version 1.0: files only)
        |
schedule_forge.app      ScheduleForgeApp - the use case, free of interface code
        |
schedule_forge.data_io  parsers of the data files, writer of the output
schedule_forge.scheduling  exam building, constraints, decomposition, generation
        |
schedule_forge.model    the objects of the problem domain
```

The design is object oriented (requirement 4.2): every concept of section C of
the requirements document - course, exam period, exam, exam system - is a class,
and every job - parsing, building, constraining, generating, writing - is a
class of its own.

## 2. The model layer (`schedule_forge/model`)

| Class | Role | Main members |
| --- | --- | --- |
| `Semester`, `Moed`, `Requirement`, `Evaluation` | The closed value sets of Appendix A, as enums. `parse()` turns a token of a data file into a member and rejects everything else, so an illegal value cannot enter the model. | `parse()`, `display_name`, `order` |
| `StudyProgram`, `StudyProgramCatalog` | The 10 study programs of requirement 1.1 and the limit of 5 selected programs. The catalogue is data, so a future version can load it from a file. | `MAX_SELECTED_PROGRAMS`, `contains()`, `name_of()` |
| `ProgramEnrollment` | One `program, year, semester, requirement` line of a course: the fact that a course is taught in a program, in a year, as obligatory or elective. | `slot` (the `(program, year)` pair the conflict rule works on) |
| `Course` | A course: `number`, `name`, `instructor`, its `enrollments`, its `evaluation`. | `enrollments_in()`, `is_taught_in_any()` |
| `ExcludedDates`, `ExamPeriod` | The dates of one `(semester, moed)` pair and the dates removed from it (Saturdays, holidays). | `available_dates()` (computed once and cached), `is_excluded()` |
| `Exam` | One exam to schedule: a course in one semester and one moed. `slots` maps every `(program, year)` of the selected programs to the requirement of the course there - the only data the conflict rule needs. | `key`, `period_key`, `slots` |
| `ScheduledExam` | An exam placed on a date. It is a value that is never changed, so one object can be shared by many exam systems. | `exam`, `date` |
| `ExamSystem` | A complete conflict free placement of all the exams. Holds them in the order of the exam list of the generator. | `grouped_by_period()`, `sorted_by_date()` |

A course whose evaluation is `Exam` produces one `Exam` object per moed of its
semester, because moed Aleph and moed Bet are placed independently of each other
and are printed separately (requirement 2.3.3).

The classes on the hot path (`Exam`, `ScheduledExam`, `ExamSystem`, `Course`,
`ProgramEnrollment`) declare `__slots__` and precompute the keys that are asked
for again and again, because the generator touches them millions of times.

## 3. The data_io layer (`schedule_forge/data_io`)

| Class | Role |
| --- | --- |
| `RecordFileReader` | Implements the physical format shared by the data files: UTF-8 text, records separated by `$$$$`, empty lines ignored. Returns records of `Line` objects that carry the line number. |
| `CoursesParser` | Interprets a course record and builds `Course` objects. Checks the 5 digit number, the four fields of a program line, the year set `{1,2,3,4}` and the enum values. |
| `ExamPeriodsParser` | Builds `ExamPeriod` objects. Understands both forms of an excluded line - a single date and a range - and the optional comment after them. |
| `ProgramsParser` | Reads the user selection (requirement 2.2) and enforces the three rules of requirement 1.1: 5 digits, a program of the catalogue, at most 5 programs. |
| `DataFileError` | The single error type of the layer. Its message always names the file and the line, so a user can repair the input without reading the code. |
| `ExamSystemWriter` | Writes the systems as readable text (requirements 2.3, 3.2) while they are produced, so the memory used does not grow with the number of systems. |

## 4. The scheduling layer (`schedule_forge/scheduling`)

| Class | Role | Main members |
| --- | --- | --- |
| `ExamBuilder` | Turns courses plus periods plus the selected programs into the list of exams to schedule: keeps the `Exam` courses of the selected programs only, fills `slots`, and creates one exam per moed. Reports a semester that has no exam period. | `build()` |
| `Constraint` | The interface of a scheduling rule. `conflicts(first, second)` asks whether two exams may never share a date; `allows(exam, date, exams_on_date)` is the same rule seen from a partial system. `SAME_DATE_ONLY` states that the whole rule is a matter of two exams sharing a date. | `conflicts()`, `allows()`, `describe()` |
| `NoTwoExamsSameDayInYearAndProgram` | The one critical conflict of version 1.0 (requirement 1.2): two exams may not share a date when they share a `(program, year)` slot, unless both are elective there. Version 1.0 compares dates only, not hours. | `conflicts()` |
| `ProblemDecomposition` | Splits the exams into independent components (section 4.1) and multiplies their counts into the exact number of exam systems. | `components`, `total_systems()` |
| `Component` | One connected group of exams with its own small date space. Every exam is a bit mask over that space. Counts its solutions and produces them one at a time. | `count()`, `iter_solutions()`, `is_clique`, `is_tree` |
| `ExamSystemGenerator` | Produces the conflict free exam systems, and states how many exist. | `generate(max_systems, time_limit_seconds)`, `total_systems()`, `report` |
| `GenerationReport` | Why the generation ended - `complete`, `reached limit` or `timed out` - how many systems were produced and out of how many. | `describe()`, `total`, `is_complete` |

### 4.1 The engine: independent components

Two exams restrict each other only when a constraint forbids them to share a
date. Exams that no constraint relates are independent: every placement of the
one goes with every placement of the other. The conflict relation therefore
splits the exams into connected components, and

```
    exam systems = solutions(component 1) x ... x solutions(component m)
```

In real data the components are exactly what one expects - the exams of one
study year of one program inside one moed - so they hold a handful of exams
each, while the whole problem holds dozens. On the example data of `data/` the
28 exams fall into 20 components of at most 3 exams.

Three properties follow, and they are the whole engine:

1. **The number of exam systems is known without enumerating anything.** It is
   the product of the component counts. For a component whose exams all exclude
   each other - the normal case, one study year - the count is the falling
   factorial `D(D-1)...(D-k+1)` of its `k` exams over its `D` free dates. For a
   component without a cycle it is `D(D-1)^(k-1)`. Any other shape is counted by
   a search that adds `popcount(free dates)` at its last level instead of
   walking them one by one. The example data reports 3.9 * 10^34 possible exam
   systems in under a millisecond.
2. **The search never crosses a component.** Producing one more system costs one
   step of the last component plus the copy of the placement, and never a walk
   over all the exams. Because every component is counted first, a component
   that no assignment satisfies is found once, before the enumeration starts,
   instead of being rediscovered for every placement of the other exams.
3. **Inside a component the search is bitwise.** The component numbers its own
   dates from 0, every exam becomes a bit mask of the dates it may take, and
   "which dates are still free for this exam" is `mask & ~used`, one operation,
   instead of a walk over the exams already placed.

### 4.2 How the systems are produced

1. The exams are ordered by semester, moed and course number - a stable order
   that makes the output readable and the runs reproducible.
2. The components are walked like an odometer: the last one turns on every step,
   the one before it only when the last one has gone round. Inside a component
   the dates are taken in order, so the first exam system of a run is the one
   that places every exam as early as it can.
3. A `ScheduledExam` is built once per (exam, date) pair and then reused, so a
   further system costs one list of references and nothing else.
4. Only one system is alive at a time: it is handed to the writer and dropped.

### 4.3 What the engine assumes

The decomposition holds for constraints whose whole rule is that two exams may
not share a date; such a constraint declares `SAME_DATE_ONLY` and answers
`conflicts()`. `ProblemDecomposition` refuses any other constraint instead of
quietly leaving it out of the search, so a future rule of another shape (a gap
of days between two exams, hours of the day) fails loudly and is added on
purpose. Nothing else in the engine has to know which rules exist.

The engine is verified against a plain search over all the exams: on 3000
random problems - including problems whose exam periods overlap - both produce
the very same set of exam systems, and the counted number equals the number
produced, over all three counting paths.

## 5. The application layer

`ScheduleForgeApp` performs one run: parse the three files, build the exams,
count and generate the systems, write them, return a `RunResult` with the
numbers the interface prints. It holds no input or output code of its own, so
version 2.0 can drive the same object from a graphical interface, and `main.py`
- the file based interface of requirement 3.1 - stays a thin argument parser.
`--count-only` stops after the count, which needs no search at all.

## 6. Performance (requirement 5.1)

| Step | Cost on the example data (28 exams, 3 programs) |
| --- | --- |
| Reading the three data files | a few milliseconds |
| Decomposition and the exact count of all the systems | under 1 millisecond |
| Producing exam systems | about 960,000 systems per second |
| Producing and writing exam systems | about 45,000 systems per second, 2.9 KB each |

The default run - 1000 exam systems - takes about 0.02 seconds, far inside the
30 seconds of requirement 5.1, and the run is stopped by the time limit in any
case. What bounds a long run is the size of the output file, not the search.

The number of exam systems grows exponentially with the number of exams (`D`
free dates and `N` exams allow up to `D^N` systems), so no file can hold all of
them. The software therefore states the exact number of possible systems and
writes the first `--max-systems` of them; the summary of the output file says
whether the enumeration was exhaustive or was stopped.

## 7. Prepared changes for the next versions

| Expected change | Where it is absorbed |
| --- | --- |
| More rules of the "not on the same date" kind (a repeating student, a whole program) | A new `Constraint` class handed to `ExamSystemGenerator`; the decomposition takes it into account on its own. |
| A rule of another shape (a gap of days, hours of the day) | The constraint declares that it is not `SAME_DATE_ONLY`; the engine refuses it until the search is extended for it, so it can never be silently ignored. |
| Sorting and filtering of the results (version 3.0) | The generator already yields `ExamSystem` objects lazily; a filter is placed between the generator and the writer. |
| Another output format (HTML, CSV, a screen) | Another writer class beside `ExamSystemWriter`; the application only needs the object it is given. |
| A graphical interface (version 2.0) | A new interface on top of `ScheduleForgeApp`, which is already free of interface code. |
| A changed data file format | The parsers of `data_io` only; `RecordFileReader` holds the physical format in one place. |
| Another study program | `StudyProgramCatalog`, one line of data. |

---

# Part II - version 2.0, the user interface

Version 2.0 opens the software to the eye: the same scheduling problem, now
entered on screens and shown as a calendar instead of being read from and
written to files. Requirement 7.3 asks the design document to hold a chapter on
the user interfaces, the menus, the idea behind the UI/UX design and examples of
use; that is this part.

The interface is a React application written in TypeScript, under `web/`. It
runs on its own in the browser, with no server behind it, so a run needs one
command and no installation on a faculty machine. Requirement 4.1 names C++ or
Python; the interface departs from it on the decision of the team and needs the
approval of the course staff. The engine of version 1.0 stays exactly as it is
under `schedule_forge/`.

## 8. The screens

### 8.1 What the application is built from

```
web/src
  main.tsx                 the entry point
  App.tsx                  the two screens, the menu, and what joins them
  screens/InputScreen      requirement 2 - everything the run needs
  screens/OutputScreen     requirement 3 - the exam systems, one at a time
  components/FilesSection    2.1  loading the data files
  components/ProgramsSection 2.2, 2.3  choosing and inspecting study programs
  components/PeriodsSection  2.4  viewing and editing the exam periods
  components/YearCalendar    2.4.1, 3.1  the year calendar both screens use
  engine/                  the engine of version 1.0, in TypeScript
  state/storage.ts         5.1  the internal storage of the software
```

`App` holds the data and the selection and hands them down; no component of the
screens holds scheduling logic of its own, exactly as `ScheduleForgeApp` holds
no interface code. That is the same separation as in version 1.0, seen from the
other side.

### 8.2 The engine inside the browser

`web/src/engine` carries the engine of version 1.0 over to TypeScript: the same
parsers of Appendix A, the same conflict rule, the same decomposition into
independent components, the same closed forms for the count, and the same
odometer over the components. It is what lets the output screen state "system X
out of Y" with the true Y, and what makes a step to the next system cost a
fraction of a millisecond (requirements 3.3 and 5.2).

The port is checked against the Python engine: on the example data of `data/`
both report exactly 39,454,663,351,049,363,592,301,142,016,000,000 possible exam
systems.

`ExamSystemStream` is the one class the screens use. It produces a system only
when it is asked for, and keeps the systems already visited, so "next" and
"previous" are immediate in both directions.

### 8.3 The menu

The menu is the pair of tabs in the header: **Input screen** and **Output
screen**. There is nothing else to learn, because the software does exactly two
things. The output tab produces the systems when they are not ready yet, and is
disabled while the data is not complete, so a tab is never a dead end. The
output screen carries a "Back to input" button, so the loop between the screens
is closed from both sides.

### 8.4 The input screen

| Section | Requirement | What the user does |
| --- | --- | --- |
| 1. Data files | 2.1, 2.1.1 | Loads the courses file and the exam periods file, each with one button press. |
| | 2.1.2 | "Load file (replace)" throws away what is stored and takes the new file. |
| | 2.1.3 | "Load file (add to data)" keeps what is stored and adds the records of the file to it; a record of a course number, or of an exam period, that is already there is updated. |
| 2. Study programs | 2.2 | Picks up to five programs out of the list on the screen - not out of a file. The list is the catalogue of version 1.0 plus any program that only the courses file knows. When five are picked, the rest are disabled, which is how the limit is shown rather than explained. |
| | 2.3.1 | Every picked program is listed with its number and its name. |
| | 2.3.2 | "Show courses" opens a program and lists all of its courses, split by year and then by semester, each one tagged Obligatory or Elective and with its evaluation. |
| 3. Exam periods | 2.4.3 | A table of the exam periods, with the start date and the end date of each one in a date field that can be moved. |
| | 2.4.1 | Under it, the year calendar of the whole exam season, showing at a glance what is available, what is excluded and what is outside every period. |
| | 2.4.2 | A click on a day of a period takes it out of the exam calendar; a click on an excluded day puts it back. Putting back a day inside an excluded range - the middle day of Purim, say - splits the range and leaves the rest of it excluded. |
| Produce | 1.1 | One button, disabled until a courses file, an exam periods file and at least one program are there, so it is never pressed too early. |

Requirement 2.5 - filters and sorts of the exam systems - is stated in the
document as a future extension of version 3.0 and is not part of this version.

### 8.5 The output screen

| Element | Requirement |
| --- | --- |
| The bar at the top: "Previous system", the counter, "Next system" | 3.2 |
| "Exam system X out of Y", with the true Y | 3.3 |
| The year calendar of the whole exam season, holding one system | 3.1 |
| An exam, drawn on its day, showing course number, shortened course name, Obligatory or Elective, and the programs it affects; the full name, the programs and the moed are in its tooltip | 3.4 |
| "Save this system", which writes the system to a readable text file | 3.5 |

### 8.6 The idea behind the design

The exam season is a thing people already read as a calendar: a lecturer asks
what the week of the 8th looks like, not what the date of course 83117 is. So
both screens show the same year calendar, and the same colours mean the same
thing on both: white is a day an exam may fall on, red is a day taken out of the
season, grey is a day outside every exam period. A user who learned to read the
calendar on the input screen already knows how to read the output.

Three more decisions carry the rest of it:

* **Editing where the thing is seen.** A day is excluded by clicking that day,
  not by filling a form somewhere else, so the change and its effect are in the
  same place. The count of available days in the table above changes with it.
* **Blue is obligatory, green is elective**, everywhere - in the course lists of
  a program and on the exams of a system. Nothing has to be memorised twice.
* **Nothing is hidden behind a mode.** The state of the data is written where it
  is used: "18 courses loaded from courses.txt", "Selected 3 of 5", "20 days
  available", "system 6 out of 39,454,...". A user always sees what the software
  will work with.

Names are shortened where a cell cannot hold them, as requirement 3.4 allows,
and the full text is always one hover away.

### 8.7 Examples of use

**Producing the exam systems of three programs.** The user presses "Load file
(replace)" under "Courses file" and picks `data/courses.txt`; the section says
"18 courses loaded from courses.txt". The same is done for
`data/exam_periods.txt`. In "Study programs" the user ticks 83101, 83102 and
83108; the header says "Selected 3 of 5" and the three appear under "Your
selection". "Produce the exam systems" moves to the output screen, which shows
"Exam system 1 out of 39,454,663,351,049,363,592,301,142,016,000,000" and 28
exams drawn on the calendar of the season.

**Looking for a system without an exam on a certain day.** The user presses
"Next system" and watches the calendar change. When a system fits, "Save this
system" writes it to `exam-system-6.txt`.

**Taking a day out of the exam season.** On the input screen the user finds
29-01-2026 in the calendar and clicks it. The day turns red and crossed out, and
the row of FALL moed Aleph in the table above goes from 20 available days to 19.
Pressing "Produce the exam systems" again produces the systems of the season
without that day.

**Moving the end of an exam period.** In the exam periods table the user changes
the end date of FALL moed Aleph from 20-02-2026 to 25-02-2026; the available
days go to 25 and the calendar paints the new days white at once.

**Coming back the next day.** The browser is opened again and the screen says
that the data was taken from the internal storage of the software, with the time
it was stored. The files do not have to be loaded again (requirement 5.1).

### 8.8 Storage and responsiveness

Everything the user built - the loaded data, the days excluded by hand, the
moved period ends, the selected programs - is written to the internal storage of
the browser on every change and read back when the software is opened
(requirement 5.1). Loading a file replaces it.

No screen action waits for a search (requirement 5.2). The count of all the
systems is a product of small numbers and is ready before the output screen is
drawn; one step of "next" or "previous" produces or recalls a single system.
Changing the data on the input screen throws away the systems that were produced
from the old data, so a stale system can never be shown.

## 9. Prepared changes for version 3.0

| Expected change | Where it is absorbed |
| --- | --- |
| Filters and sorts of the exam systems (requirement 2.5) | Between `ExamSystemStream` and the output screen: the stream already produces systems one at a time and the screen already asks for them by number. |
| More scheduling rules | `conflicts()` in `web/src/engine/decomposition.ts`, next to the constraint classes of version 1.0. |
| Another way of showing a system (a list, a printout) | Another component beside `YearCalendar`; the screen hands it the same `ExamSystem`. |
| Another store for the data (a server, a database) | `web/src/state/storage.ts` alone; nothing else knows where the data comes from. |

---

# Part III - version 3.0, choosing between the exam systems

Version 1.0 could say how many exam systems exist. Version 2.0 could show them.
Version 3.0 is about which of them is worth having: the user states what
disqualifies a system (section 2 of the requirements), and what makes one system
better than another (section 3). Section 4 - the extension - adds what a faculty
needs before a system can actually be run: rooms, the availability of the staff,
and a calendar the students can import.

Everything in this part exists twice, because requirement 1.1 asks for it in
both interfaces: in Python under `schedule_forge/`, and in TypeScript under
`web/src/engine/`. The two are written the same way on purpose, and both were
run on the same data to check that they agree.

## 10. The engine of version 3.0

### 10.1 One idea for every rule between two exams

Version 1.0 knew one rule about a pair of exams: not on the same date. Section 2
adds two more - at least k days between two obligatory exams of a study year
(2.1), and at least k days between any two exams of a study year (2.2). All
three say the same kind of thing, so the engine keeps one number for a pair of
exams: **how many days have to separate them**.

```
required_gap(first, second) = 0   the two do not restrict each other
                            = 1   the rule of version 1.0
                            = k   a threshold the user turned on
```

Every rule answers `required_gap`, the generator keeps the largest answer, and
nothing else in the engine had to change: the decomposition still splits the
exams into independent components, because a rule that asks for a distance still
relates exactly the same pairs.

Inside a component every distance the rules ask for has a mask of its own -
`gap_masks[days][date]` is the set of dates that are less than `days` days from
that date - so placing an exam removes the whole window of dates that are now
too close to it in one operation.

Two consequences are worth stating:

* The closed forms that count a component in one step - the falling factorial
  and the tree formula - only hold when every distance is 1. As soon as a
  threshold asks for more, the count is done by a bounded search, because the
  dates of an exam period are not consecutive days: Saturdays and holidays are
  missing from them, while the requirement counts the days between two exams
  including Saturdays and holidays.
* The exact number of exam systems is still exact, and it is the number
  *before* the thresholds that count over a whole system. The reports name it
  that way and never pretend otherwise.

**A third unconditional rule, added later and not from the requirements
document: the same instructor cannot give two exams at once.** It was asked
for directly, after live, manual entry of courses and rooms straight through
the Input screen (undocumented here as its own part so far) made it easy to
build a schedule where nothing else would have caught this - two courses of
one instructor, in different study programs or years, so requirement 1.2 has
no opinion about them either. `required_gap` reads:

```
required_gap(first, second) = 0   the two do not restrict each other
                            = 1   the rule of version 1.0, or the same instructor
                            = k   a threshold the user turned on
```

It is checked ahead of `first.slots`, because it does not depend on which
study program or year either exam belongs to - two exams of the same
instructor conflict whether or not a single student could ever sit both of
them. And it is unconditional for the same reason the rule of version 1.0 is:
an instructor being asked to administer two exams on the same date is not a
preference to weigh against others, it is a scheduling impossibility, so
there is no `k` to turn it off with. `web/src/engine/decomposition.ts` and
`schedule_forge/scheduling/constraints.py` (`NoInstructorTwoExamsSameDay`,
next to `NoTwoExamsSameDayInYearAndProgram`) both add it in exactly the one
place each engine already funnels every pairwise rule through, which is also
why nothing else had to change: the drag & drop legality check
(`web/src/engine/edit.ts`, part IV, section 14) already calls the same
`requiredGap`, so a drag respects the new rule automatically, with no code of
its own written for it.

Checked in the browser by running a real search on the example data and
confirming, on every date that held more than one exam (16 of them, up to 4
exams on a single date), that no instructor's name repeated. Checked in
Python by two new tests (`TestInstructorConflict` in `tests/test_version3.py`)
- one instructor kept apart across two unrelated programs and years, one pair
of different instructors confirmed still free to share a date - and the full
suite (88 tests) passing. Fixing this also surfaced a latent issue in three of
the test files' own helper functions, which had every test exam default to
one shared, hard-coded instructor name: harmless before this rule existed,
since nothing depended on two different courses having different instructors,
but exactly the shape of collision the new rule now looks for. The default
was changed to one instructor per course number instead, so a test that is
not itself about this rule does not trip over it by accident.

One visible side effect on the example data: `main.py`'s own count of every
possible exam system before the thresholds, previously exact and printed
instantly, now sometimes reports "unknown (the exact count exceeded the
counting budget)". That is not a regression - an instructor who teaches
courses across several study programs and years now links exams that used to
sit in separate, small components (10.1 above) into one larger one, and a
bigger component is more likely to fall outside the closed forms that count
in one step. The count itself is still exact whenever it is given at all; it
is only sometimes no longer free.

### 10.2 The thresholds that count over a whole system

2.3 (collisions between elective courses of a program), 2.4 (the span of the
obligatory exams of a study year), 2.5 (exams on one day) and the room capacity
are not about a pair of exams, so they cannot become a distance and cannot enter
the decomposition.

Checking them on finished systems only does not work, and the reason is worth
recording: the generator walks the components like an odometer, so the first
components stay where they are for a very long time. A first measurement of the
example data examined 200,000 systems in 16 seconds and accepted **none** of
them - every one of those systems carried the same bad placement of the first
components.

`scheduling/partial.py` (`engine/partial.ts`) therefore checks the counts while
the walk goes, on the exams placed so far:

* the exams on a date, the seats a date needs and the collisions between
  elective courses only grow as more components are placed, so a partial system
  that already breaks one of them is dropped together with everything below it;
* the span of the obligatory exams of a study year is checked as soon as the
  last component holding an exam of that year has been placed.

`apply` and `unapply` are exact opposites, so the counters follow the walk up and
down without being rebuilt. With the same data and the same thresholds the run
then found its 200 systems in **0.02 seconds**.

### 10.3 A walk that spreads out, for the sorting

Sorting a list of exam systems is only worth something when the list holds
different systems. The odometer, left alone, produces systems that differ in one
exam, so the first measurement of the sorted list showed 200 systems that all
scored 3.41 on the average gap - nothing to choose between.

When the user asks for a sorting, the walk therefore moves a **different
component every time** and lets the components below it start again from their
first placement. The cost is the same, the systems are spread over the whole
set, and the list to sort became one whose average gap runs from 4.95 to 7.68 -
so the criterion of section 3 now picks a system that really is twice as
comfortable. A set of the systems already produced keeps a spread out walk from
offering the same system twice.

Plain listing - versions 1.0 and 2.0, and any run without a sorting - keeps the
old walk, so "the first N exam systems" still means the first N.

### 10.4 The classes

| Class | Role |
| --- | --- |
| `SchedulingSettings` / `Settings` | Everything the user decides outside of the data: the five thresholds and their k, whether rooms are required, the criteria of section 3 in the order of preference, and how far the search may go. |
| `SettingsParser` | Reads the settings file of the file based version: `name = value`, `#` for a comment. |
| `MinimumDaysBetweenObligatoryExams`, `MinimumDaysBetweenExams` | Thresholds 2.1 and 2.2, as rules that answer `required_gap`. They hold inside one exam period: moed Aleph and moed Bet are two sittings of the same exam, and a student takes one of them. |
| `PartialThresholdChecker` | The counts over a whole system, kept while the walk goes (10.2). |
| `SystemEvaluator` / `measure` | Measures one exam system: the five numbers that both the thresholds of section 2 and the criteria of section 3 are read from. |
| `CandidateSearch` / `runSearch` | The run: produce, measure, keep or drop, and sort. `sort_by` orders the list again without searching again. |
| `RoomsParser`, `RoomAllocator`, `RoomAllocation` | The room allocation module (extension 2). |
| `FacultyConstraintsParser`, `FacultyAvailability` | The staff constraints (extension 4). |
| `CalendarExporter` / `calendarsOf` | The `.ics` files, one per study program and year (extension 3). |

### 10.5 One run, three steps

```
   the rules of version 1.0 and the thresholds 2.1, 2.2   -> inside the search
   the staff constraints                                  -> dates removed before it
   the thresholds 2.3, 2.4, 2.5 and the room capacity     -> while the walk goes
   the criteria of section 3                              -> a sort of what was kept
```

The order is not an accident: every rule is enforced at the earliest point it
can be, which is what keeps a run of a real exam season inside its time limit.

## 11. The screens of version 3.0

### 11.1 The third screen: settings

The menu of version 2.0 grows a third tab, **Settings**, because the thresholds
and the sorting are neither data nor a result.

| Part of the screen | Requirement |
| --- | --- |
| Six cards, one per threshold, each with a check box and its own k. A card that is on is drawn in the colour of the accent, so what is active is seen without reading. | 2.1 to 2.5, and the rooms |
| The five criteria of section 3, each with a check box; a criterion that is picked shows its rank (#1, #2, …) and two links that move it up and down. | 3.1 to 3.5, and the order between them |
| Four numbers that bound the search: systems to keep, systems to examine, seconds, and the students of a course that does not state its own. | 6.2 |
| The button that produces the systems, disabled until the data is there. | |

Changing only the sorting does **not** search again: the systems that were found
are kept and the list is ordered again, which is what the requirement expects
when it says that the sorting may change during a run and the thresholds may
not.

### 11.2 What the output screen gained

* the measurement of the system on show, in the words of section 3, right under
  the navigation bar;
* the rooms of every exam, on the exam itself in the calendar and in the file
  that "Save this system" writes;
* a row of buttons, one per study program and study year, each of which writes
  that calendar as an `.ics` file - the one button press of the extension;
* a line that says how many systems were examined, out of how many, and how
  many passed the thresholds.

### 11.3 Day and night

The colour scheme is one button in the header. Both schemes are built from the
same tokens - background, panel, ink, line, accent - so nothing in the screens
had to be written twice, and the meanings of the colours stay: blue is
obligatory, green is elective, red is a day that was taken out of the season.

The choice is kept in the internal storage with the rest of the settings, and
changing it does not touch the data, the settings or the systems already found.

## 12. What was checked

* 78 unit tests in `tests/` - the parsers of the two new files and of the
  settings, the thresholds 2.1 to 2.5 one by one, the staff constraints, the
  room allocation, the sorting and the order between criteria, and the calendar
  files.
* The rule of version 1.0 was checked again against a plain search over all the
  exams, on 3000 random problems, after the engine was generalised to distances:
  both produce the very same set of exam systems, and the counted number equals
  the number produced.
* The Python engine and the TypeScript engine were run on the same data with the
  same settings. Both report 2,475,788,440,471,294,609,571,213,721,600,000
  possible exam systems before the thresholds, both find 200 systems that pass
  them in 0.02 seconds, and both put the same system first, with the same
  measurement.

## 13. Prepared changes for the versions after this one

| Expected change | Where it is absorbed |
| --- | --- |
| A threshold about a pair of exams | A rule class that answers `required_gap`; the decomposition takes it into account on its own. |
| A threshold that counts over a whole system | A counter in `PartialThresholdChecker`, which is where a count that only grows can stop a walk early. |
| Another criterion to sort by | One number in `SystemMetrics` and one name in `SORT_CRITERIA`; both screens read the list. |
| Hours of the day, not only dates | The one change that reaches the engine: a placement would become a date and an hour, and `required_gap` a distance in hours. The rest - the decomposition, the walk, the thresholds, the rooms - is written in terms of that distance. |
| Rooms that are not free all season | `RoomAllocator` gains the dates a room is free on; the allocation is already done per date. |

---

# Part IV - editing the exam system on screen

Version 3.0 finds exam systems and lets the user compare them. The three
additions of this part are about the one system that is on screen: moving one
exam by hand, telling study programs apart at a glance, and doing both of those
together with other people, live.

## 14. Dragging an exam to another day

### 14.1 The idea

The output screen already shows one exam system that the search proved legal.
Dragging an exam edits that very system: `web/src/engine/edit.ts` asks, for
every date the exam's period allows, whether putting the exam there would still
satisfy

* the pairwise rules of section 2 (`requiredGap`, the same function the
  decomposition of section 10.1 uses) against every *other* exam of the system
  as it stands now,
* the aggregate thresholds of section 2 (`measure` and `passesThresholds`,
  section 10.2) on the system with that one exam moved,
* the room capacity (`RoomAllocator.allocate`, section "room allocation") on
  the same hypothetical system, when `require_rooms` is on,
* the instructor's availability for that date.

Nothing new had to be written for the rules themselves: `legalDatesFor` calls
the very functions the search already calls, on a system of one exam changed.
That is also why the check is trustworthy - a date that lights up green is a
date the search itself would have accepted.

### 14.2 Cost

A period holds on the order of tens of dates, and each one costs one pass over
the exams to build the hypothetical system, one call to `measure`, and,
optionally, one room allocation - all of them already linear in the number of
exams. Computing every legal date therefore costs a small, bounded multiple of
one exam system, done once when the drag starts, not on every pixel the mouse
moves.

### 14.3 The mechanics

`OutputScreen` is the only place a system is edited from, and it works on
`workingSystem` - the exam system App hands it - rather than on the read-only
result of the search:

* `onDragStart` on a chip computes `legalDatesFor` and keeps the set of legal
  dates in a small piece of local state; the calendar colours a day green when
  it is in that set, and mutes every other day of the exam's own period so a
  release there is visibly refused before the browser even offers it.
* `onDrop` on a legal day calls `withExamOn`, which returns a new system with
  that one exam moved and everything else untouched, and hands it to App.
* "Reset to the system that was found" throws the edits away and goes back to
  the system the search produced, kept for exactly this in `Found`.

The metrics, the room allocation and the `.ics` calendars shown on screen are
all recomputed from `workingSystem` on every render (`useMemo`), so an edit is
reflected everywhere at once instead of only on the calendar.

## 15. A colour tag per study program

### 15.1 What it is for

An exam that is shared by two study programs - a course both take the same
semester - is one chip on the calendar; without a way to tell its programs
apart, a user has to read the small print. `web/src/engine/colors.ts` assigns
every selected program one colour out of a fixed palette chosen to stay legible
in both day and night mode, and keeps a colour a user picked by hand across a
change in the selection (`assignProgramColors` only fills the programs that do
not have one yet).

### 15.2 Where it shows

* the study programs screen: a dot next to a program in the list, and a picker
  next to it in "Your selection" to change it;
* every exam chip: one small dot per programme the exam belongs to, in `slots`
  order, so an exam of two programs shows two dots;
* the legend above the output calendar: one tag per selected program. Clicking
  a tag dims every chip that is not one of that program's, and keeps the ones
  that are at full strength; several tags may be active together, which
  highlights their union - useful when comparing two programs against the rest
  rather than looking at one alone.

The colour of a program is part of the internal storage (`programColors`), so
it survives a reload the same way the rest of the data does.

## 16. Real-time collaborative editing

### 16.1 What has to be shared, and what does not

Two things have to reach every screen the moment they change: a move of an
exam, and a change of the threshold requirements or the sorting (section 2 and
3). Neither needs a server that understands scheduling: every rule is already
checked in the browser (section 14), so the server's only job is to relay a
move or a settings change to everyone else, and to arbitrate one thing the
browser cannot arbitrate alone - **which one person is allowed to drag a given
exam right now**. That is the mutex the requirement asks for, and it is the
one piece of state the server actually owns.

### 16.2 The server (`server/index.js`)

A small Node process using the `ws` package, holding, per room code, three
things in memory: the date every exam was last moved to, who (if anyone) holds
the lock of every exam, and the last settings object it was given. It never
runs a scheduling rule; it only:

* grants a lock request when the exam is free, or already held by the same
  client (so releasing twice is harmless), and refuses it otherwise;
* accepts a move only from whoever holds the lock of that exam, then releases
  the lock and broadcasts the new date to the room;
* relays a settings change to everyone else in the room, and remembers it so a
  browser that joins later starts from what is already there;
* releases every lock a connection was holding the moment that connection
  closes, so a browser that is closed mid-drag never leaves an exam stuck.

A room lives only as long as the process does - restarting the server forgets
everything, which is enough for the classroom use this was built for and keeps
the server free of anything that would need a database.

### 16.3 The client (`web/src/collab/`)

`useCollab` is the one WebSocket connection of a browser tab, kept as React
state: which room and which other people are in it, who holds which lock (by
`clientId`, not by name - two people can share a name, they cannot share a
connection), and four outgoing actions (`requestLock`, `releaseLock`, `move`,
`sendSettings`). It does not know what an exam or a threshold is; incoming
messages are handed to whichever callbacks `App` gave it, so applying a move to
`workingSystem` or a settings change to the run configuration stays App's job,
the same separation the rest of the software keeps between "what changed" and
"what that means".

`App` owns `workingSystem` and the connection for exactly the same reason: a
peer's move has to be kept even while this browser is looking at the settings
screen, not only while the output screen happens to be mounted.

### 16.4 The mutex in practice

1. `dragstart` on a chip: if the exam is already locked by someone else, the
   drag never starts (the chip is not `draggable`, and the handler refuses it
   again defensively). Otherwise a lock request is sent immediately, before the
   legal dates are even computed, so the exam is marked as being edited on
   every other screen as early as possible.
2. While the lock is held, every other browser shows that chip dashed, faded,
   and not draggable, with whose edit it is in its tooltip.
3. `drop` on a legal day sends the move; the server releases the lock as part
   of handling it and broadcasts both the new date and the release together.
4. `dragend` without a drop (the user let go outside the calendar, or cancelled)
   releases the lock on its own, so an abandoned drag never leaves an exam
   stuck locked.

### 16.5 One assumption stated on purpose

Collaboration is scoped to *the exam system currently on screen*: everyone in a
room is expected to be looking at the same one, addressed only by exam id and
date, not by which numbered result they browsed to it from. Switching to a
different result locally is still allowed and does not disconnect anyone, but
only edits made to the system currently shown are shared - the panel says as
much. Extending this to also synchronise which result number everyone is
looking at is a small addition (one more field in the "state" message) that was
left out because nothing in the three requirements asked for it.

A remote settings change is applied to the run configuration directly, without
starting a new search: the systems already found are not thrown away just
because a threshold changed on someone else's screen, since that would be more
disruptive than useful while a room is mid-edit. Running the search again with
the new thresholds is one press of the button that was already there.

## 17. What was checked

* Two independent browser tabs, joined to the same room: a drag made in one
  appeared in the other with no action taken there, the moved exam left its
  original day and appeared on the new one, and the metrics and the room
  allocation of the second tab updated to match without a reload.
* The mutex, end to end: locking a chip in one tab made it undraggable and
  visibly locked in the other, including against a forced attempt to drag it
  anyway; releasing the lock (by finishing the move) made it draggable there
  again, immediately.
* A settings change made in one tab's Settings screen was visible, correctly
  valued, in the other tab's Settings screen without either tab reloading, and
  produced a notice naming who made it.
* The legality highlighting itself: dragging an exam lit up exactly the dates
  a hand check against the active thresholds agrees with, and muted the rest of
  its own exam period; completing a drop onto a lit date moved the exam and
  recomputed its metrics, its room, and every `.ics` export from the edited
  system, not the one the search first produced.
* The colour legend: activating a tag dimmed every chip outside that program
  and left the rest at full strength, and clearing it restored every chip,
  confirmed by counting the affected chips before and after.

---

# Part V - the visual design system

The screens were redesigned from a set of mockups produced in Stitch (three
screens plus a mark, exported as Tailwind HTML with a full colour and type
token set). This part records what was ported as it stood, what was adapted to
the software's real behaviour, and why - so that a later reviewer does not read
a difference from the mockup as an oversight.

## 18. What changed and why

**Three top-level tabs, not five.** The mockup shows one Input page - data
files, study programs, exam periods, all as cards in a two column grid - next
to Settings and Output. The screens had earlier been split into five tabs
specifically so that nothing was "one long page to scroll through"; the
mockup's two column card grid solves the same complaint a different way -
everything fits without the page growing taller than the cards need - so the
three tab structure was adopted as it stood rather than kept alongside it.

**The exclusion calendar and the output calendar are real data, not the
mockup's placeholders.** The mockup's own markup calls its exclusion calendar
"a simplistic grid representation" and its week grid "a simulated year
snippet" - both hold a handful of fabricated squares, not a real month or a
real week. `DenseExclusionCalendar` and `WeekCalendar` (sections 19.2, 14)
keep the *look* - small dense squares per month, week rows of day columns -
but compute it from the actual exam periods: every real day the periods span,
not a fixed twelve columns or a fixed three weeks. A real exam season is
usually longer than three weeks, so the week calendar scrolls through as many
weeks as it takes rather than being cropped to fit a screenshot.

**Seven day columns, not five.** The mockup's week grid shows Monday to
Friday. This software's own rule is that an exam may be placed on any day an
exam period does not explicitly exclude (requirement 1.2), and Sunday is an
ordinary teaching and exam day in the calendar this software is built for -
nothing in the engine ever assumes a five day week. Five columns would have
had no cell to draw a Sunday exam in, which is a correctness problem dressed as
a layout choice, so the week grid keeps all seven days.

**No invented exam times, and no invented "spread score".** The mockup's exam
blocks show a time of day ("09:00") and a stat card called "Spread Score:
0.912"; neither exists in the data this software works with - version 1.0
states plainly that hours are not part of the software, and nothing in
`SystemMetrics` corresponds to a spread score. Showing either would assert
something the engine does not actually know. The time was dropped, and Spread
Score was replaced with a card that is real: **Busiest Day**
(`max_exams_per_day`), already computed for threshold 2.5 and already shown
against its threshold when one is set. **Room Util.** is computed for real
too: the average, over the days that hold an exam, of the seats those exams
need divided by the total seats the loaded rooms provide.

**One accessible pairing for every primary button.** The mockup's own screens
disagree with each other about which text colour sits on the accent colour -
the input screen's call to action pairs near white text with a pale button
fill, which reads poorly, while the settings screen pairs the same accent with
a dark navy text and reads well. The software adopts the settings screen's
pairing everywhere a filled accent button appears, because a single consistent
rule beats two screens that each made their own choice.

**Night is the default.** The mockups were only ever designed dark; a light
mode is still offered (18.2), derived from the same tokens, because the
day/night toggle of version 3.0 still has to switch between two real designs -
but a new browser now starts in the theme the mockups were built for.

## 19. The token system and its components

### 19.1 Tokens

Every colour, and the handful of spacing and type values the mockup names, are
custom properties on `:root`, overridden under `:root[data-theme="light"]` and
under `prefers-color-scheme: light` for a browser that has not chosen yet -
the same switching mechanism version 3.0 already used, now carrying a second,
complete palette rather than a handful of adjusted shades. Sharp corners
(`border-radius: 0`) are the default everywhere except the small circular
colour dots and swatches, where a circle reads better as "this is a colour
picker" than a square would.

`web/src/components/Icon.tsx` wraps the Material Symbols Outlined font the
mockup used (loaded in `index.html` next to Hanken Grotesk, the mockup's
typeface); `web/src/components/Logo.tsx` redraws the mark as inline SVG - a
calendar grid fused into an anvil - instead of shipping the mockup's exported
PNG, so it stays crisp at any size and recolours through `currentColor`
instead of carrying a fixed set of baked in pixels.

### 19.2 New components

| Component | Replaces | Role |
| --- | --- | --- |
| `WeekCalendar` | `YearCalendar` (removed) | The output screen: one row per real week, seven day columns, used by nothing else. |
| `DenseExclusionCalendar` | `YearCalendar` (removed) | The exam periods screen: one dense column of day squares per real month the periods span. |
| `Icon` | - | One Material Symbols glyph. |
| `Logo` | - | The mark, as inline SVG. |

`YearCalendar` served both screens before this part; once each screen had a
calendar built for what it actually needs, nothing called the general one any
longer, so it was deleted rather than kept alongside two purpose-built
replacements.

### 19.3 What stayed exactly as it was

Every prop, every handler, every piece of state described in parts III and IV
- `workingSystem`, the collaboration hook and protocol, `legalDatesFor`, the
threshold and sorting logic, the room allocator, the `.ics` export - is
untouched by this part. Only how a screen is drawn changed; what a screen
does, and the engine underneath it, did not.

---

# Part VI - finding the best systems, not the first ones

Every earlier version of the search kept the first `max_candidates` exam
systems that passed the threshold requirements, then sorted that list. That is
"the first ones that happened to pass", not "the best ones that exist" - the
walk stopped the instant its quota was full, so a system found on step two
million could easily beat everything already kept and never be looked at. This
part replaces that with a search that genuinely looks for the best.

## 20. Two mistakes, corrected

### 20.1 First-found, not best-found

`CandidateSearch.run` (Python) and `runSearch` (TypeScript) no longer stop the
moment `max_candidates` systems have passed the thresholds. When at least one
sorting criterion is on, every passing system is weighed against the worst of
the best kept so far, in a bounded heap of size `max_candidates`
(`BoundedBest` in TypeScript; Python's own `heapq`, keyed by the negation of
`sort_key` so its natural min-heap root is always the worst-kept candidate).
The search only stops when it runs out of systems, reaches `max_examined`, or
runs out of time - never merely because it filled its quota. What ends up kept
is therefore the best `max_candidates` systems out of everything the search
actually looked at.

`accepted` (how many systems passed the thresholds) and `len(candidates)` /
`candidates.length` (how many were kept) can now differ a great deal, and the
reports say so explicitly - "105,984 passed the requirements; the best 200 were
kept" - rather than conflating the two the way a single "accepted" count used
to.

When no criterion is on, "best" has nothing to mean, and both engines fall
back to exactly the old behaviour: the first systems that pass, kept in the
order found. Requesting the best is opt-in in spirit even though it is now the
default (21.3), because it only makes sense once the user has said what "best"
means.

Both bounded-heap implementations were checked against a plain "collect
everything, sort, take the top K" reference on thousands of randomised inputs
before being wired into the real search (`web/src/engine/topk.ts`'s heap;
Python's `heapq`-based `_offer`), and again against a from-scratch brute force
enumeration of small real scheduling problems once wired in
(`tests/test_version3.py::TestBestKSelection`).

### 20.2 A criterion's direction was wrong

Every criterion of section 3 was being sorted "descending by raw value",
including `elective_collisions` and `max_exams_per_day` - which meant a system
with *more* collisions or a heavier day was ranked ahead of one with fewer,
exactly backwards from what "best" should mean for those two. `min_days_
between_obligatory`, `average_days_between_exams` and `obligatory_span` were
already correct, because for those three a larger value genuinely is better.

`CRITERION_DIRECTION` (`schedule_forge/settings.py`, `web/src/engine/
settings.ts`) now states, per criterion, whether a larger or a smaller value
counts as better; every ranking key - the heap's, the final sort's, the
metrics tiles' - is built from it, so "best" means the same thing everywhere a
system is ranked. The criterion titles were reworded to say the direction
plainly ("minimise collisions" rather than a bare description that let the
old, uniform "descending" reading pass unnoticed).

## 21. A second, unrelated bug this surfaced

### 21.1 The walk that lied about being complete

Ranking used to make the walk "spread out" by jumping to a different, already
partly explored component after every accepted system
(`depth = examined % depth_count`), on the theory that otherwise only the last
component would ever move within a bounded budget. This looked reasonable and
had been checked in isolated cases, but it broke a property the ordinary walk
depends on for correctness: the outermost component's iterator is only
supposed to be asked for its next value after every combination of every
component beneath it has been visited. The jump asked far more often than
that - so the outermost iterator ran dry after a tiny fraction of the true
space had been seen, the `while` loop ended the same way it does when the
search is genuinely exhaustive, and the report said so: "every one of the
39,454,663,...,000,000 possible exam systems was examined" after 12 seconds
and 136,800 systems. That claim cannot be true of a number that size, and once
every default run went through the ranked path (20.1), every default run made
it.

This was caught by treating the report itself as a claim to verify, not just a
number to display: 12 seconds for 10^34 systems does not survive a moment of
arithmetic, and looking into why led straight to the jump.

### 21.2 The fix: shuffle the space, do not skip around it

The jump is gone. In its place, `ProblemDecomposition` (Python) and
`decompose` (TypeScript) take a `shuffle` flag: when it is on, the components
are put in a random order and the dates inside each one are put in a random
order, once, when the decomposition is built - and the walk itself is
completely unchanged from the plain, provably-exhaustive version 1.0 algorithm
of part I. A component's iterator still only advances to its next value after
everything beneath it has been fully explored, so "the walk ended on its own"
is exactly as trustworthy a signal of exhaustiveness as it always was;
`total_systems` and every counting formula in part I are untouched, because
they only ever depended on the *count* of dates and edges in a component, not
the order those dates happen to be visited in.

What shuffling buys back some of what the jump was reaching for: because which
component sits first, and which date a component starts from, differ from run
to run, a budget-limited search does not always explore the exact same corner
of the space it would have without ranking. It does not fully solve "make
every one of twenty independent components vary within one bounded budget" -
that remains a hard problem in general, and is not attempted here - but it
never again claims to have finished when it has barely begun.

## 22. Nothing is built into the code, only into the data

The catalogue of study programs used to be a list of ten numbers and names
written directly into `schedule_forge/model/study_program.py` and
`web/src/engine/catalog.ts` - a direct transcription of requirement 1.1's own
example list, but a hard-coded one nonetheless, competing with whatever a
loaded courses file actually said. It is gone from both. `StudyProgramCatalog.
from_courses` (Python) and `programsOf` (TypeScript) now build the whole
catalogue by scanning the loaded courses file's enrolments for every program
number it mentions - nothing else. A courses file never states a program's
*name*, only its number, so an entry built this way is named after its own
number until a file says otherwise; `name_of` already fell back to the number
for an unknown program, which is exactly what this now returns for every
program, known or not.

`ScheduleForgeApp` used to build its catalogue once, in `__init__`, before any
file had been read. It now takes an optional catalogue (used by the tests to
pin down a fixed one) and otherwise derives it from the courses file inside
`run`, right after that file is parsed and before the selected-programs file is
validated against it - the only point at which "what the data says" is actually
known.

One consequence worth stating plainly: before any courses file is loaded, there
is no program to select, and the study programs screen is empty. That is not
an oversight - it is the direct, correct result of there being no data yet.

---

# Part VII - eleven requested upgrades

The user was offered twenty candidate upgrades to the software and chose
eleven of them. This part covers all eleven, in the order they are listed in
section 22's replacement, above. Every one of them lives entirely in `web/`
(and, for one of them, `server/`): none is a formal requirement of the
document, and the file based command line interface of version 1.0 has no
screen for a search box, a print button or a collaboration role to attach to,
so none of the eleven was ported to `schedule_forge/` or `main.py`. Where a
scoping decision had to be made that the requirements document does not
settle, it is stated here explicitly rather than left for a reader to notice
as a gap.

## 23. Two decisions that shaped several of the eleven

**No third party library was added for any of them.** Two features look, at
first glance, like they call for one: reading a spreadsheet, and producing a
PDF. `xlsx` (SheetJS), the package that reads `.xlsx`/`.xls` natively, turned
out to carry a high severity prototype-pollution and ReDoS vulnerability with
no fix published to the npm registry (`npm audit`, after installing it to
check) - so it was removed again, and CSV was read by a hand-rolled parser
instead (section 24), since Excel, Google Sheets and every other spreadsheet
program export to CSV in one step and the whole point of the feature is
covered without taking on that risk. A PDF is produced the same way: the
browser's own Print > Save as PDF, not a PDF-generation library, writes the
actual file (section 25) - the software only has to make sure the right
thing is on screen when Print is pressed.

**No feature invents data the software does not have.** Publish
notifications (section 30) draft a message about a schedule change but never
send one, because this software holds no student email address anywhere - a
courses file names an instructor, never a class roster - and sending mail on
someone's behalf needs a person's own explicit action, not a standing
permission a feature grants itself. Hour-of-day scheduling (section 24) never
asks the search to reason about hours, because requirement 1.2 states plainly
that the conflict rule works by date, not by hour, and Part V, section 18,
already records that an earlier mockup's invented exam times were dropped for
exactly this reason once.

## 24. Hour-of-day scheduling

### 24.1 A layer on top of the search, not a change to it

Rewriting the engine to reason about hours would mean redoing the exact
counting of part I.4.1, the bitmask conflict search, and `required_gap`
(part III, section 10.1) for a rule nothing in the requirements ever asked
for. Instead, `web/src/engine/timeAssignment.ts` assigns a time of day to
every exam of a system the search has *already* found and proved legal by
date - the same relationship `RoomAllocator` already has to a finished
system (part III, section 10.4): a display and export layer over a search
that is otherwise completely unchanged, and stays exactly as fast.

`assignTimes(system, settings, allocation)` groups a system's exams by date,
then, for every date, gives every exam one of `settings.timeSlots` ("09:00",
"13:00", "16:00" by default, configured on the Settings screen next to
"Search Bounds"). The one thing that actually has to hold physically is that
a room is never asked to host two exams at once, so where a rooms file was
loaded, two exams the room allocator gave the very same room on the very same
date are always placed in different slots, in the order the room is freed;
without a rooms file, or for an exam that could not be seated, slots are
spread round robin across the day's exams purely for a calendar that is
easier to read, since nothing then forces them apart. An exam takes
`settings.defaultExamMinutes`, because no data file states a per-course
duration and inventing one from something the file does state (its number of
students, say) would be a guess the software has no basis for.

### 24.2 Where it shows

The assigned start time is shown on every exam chip next to its course
number, and in its tooltip as a start-end range, on the output screen only -
the search, the counting, the thresholds and the criteria of section 3 never
see it. Leaving `timeSlots` empty turns the whole layer off and shows dates
alone, exactly as version 3.0 always did.

## 25. Import from a spreadsheet

### 25.1 The format, and why CSV

`web/src/engine/csvImport.ts` reads courses and exam periods from CSV, saved
by Excel, Google Sheets or any other spreadsheet program (File > Download /
Save As > CSV) - see section 23 for why CSV rather than a native `.xlsx`
reader. The parser is a small hand-rolled RFC 4180 reader (quoted fields,
embedded commas, doubled quotes for a literal quote), because the format is
simple enough not to need a dependency at all once the binary formats are out
of scope.

The two files use a long, one-row-per-fact layout - the way a spreadsheet
naturally holds this kind of data, rather than the record-per-course shape
of Appendix A:

```
Courses:       CourseNumber, CourseName, Instructor, Program, Year, Semester,
               Requirement, Evaluation, Students (optional)
Exam periods:  Semester, Moed, StartDate, EndDate,
               ExcludedStart, ExcludedEnd, Comment
```

A course taught in three programs is three rows sharing its course number,
grouped back into one `Course` with three `enrollments` by
`parseCoursesCsv`. An exam period row either defines the period itself
(`StartDate`/`EndDate` filled) or adds one excluded date or range to a period
defined earlier in the same file (`ExcludedStart` filled instead), read by
`parsePeriodsCsv`.

### 25.2 Reusing the existing validation, not duplicating it

`parseSemester`, `parseMoed`, `parseRequirement` and `parseEvaluation`
(`web/src/engine/parsers.ts`) were exported rather than re-implemented, so a
value like `"Spring"` in a CSV cell is validated by exactly the same code, and
rejected with exactly the same wording, as the same value in an Appendix A
text file - `DataFileError`, named line and all. `FilesSection.tsx` gained one
more button per loader, "Import CSV", beside the existing "Replace" and
"Add", using a `.csv` file input kept separate from the `.txt` one.

## 26. Printable PDF timetable

No file is generated by this software's own code; the browser's Print >
Save as PDF *is* the PDF writer (section 23). "Print / Save PDF", in the
output screen's footer, switches to the Overview tab (the only tab that holds
the calendar) and calls `window.print()`. A print stylesheet
(`@media print` in `web/src/styles.css`) hides everything that is not the
calendar itself - the header, the sidebar, the navigation bar, the stat strip,
the legend, the footer - and lets `.calendar-canvas` print at its natural
size on a white background rather than the screen's dark one, with
`print-color-adjust: exact` so an exam chip's colour survives onto the page.

## 27. Side-by-side system comparison

A sixth sidebar tab, **Compare**, added next to Overview / Metrics / Rooms /
Export. `ComparePanel` (in `OutputScreen.tsx`) picks one more system, out of
every one the search kept, from a `<select>`, and lays every number of
`SystemMetrics` (section 10.4) and, where a rooms file was loaded, the room
utilisation of section 8.6, side by side against the system currently on
screen. A cell is marked as the better of the two using the very same
`CRITERION_DIRECTION` table that decides what "better" means for the search
itself (part VI, section 20.2), so a green cell in this table and a system
ranked ahead of another by the sorting criteria never disagree about what
counts as an improvement.

## 28. Undo / redo of a hand edit

Dragging an exam (part IV, section 14) used to hold exactly one
`workingSystem`, replaced on every drop. It now holds a stack,
`history: ExamSystem[]`, and a pointer, `historyAt`, in `App.tsx`: the search
result the output screen started from is `history[0]`; every further edit -
local or arriving from the collaboration room - is appended after `historyAt`
and discards whatever redo states were ahead of it, exactly the way a text
editor's undo stack always does; undo and redo simply move the pointer.
"Reset to the system that was found" still exists, unchanged, as a way to
throw every edit away in one step rather than one at a time. Two buttons
(↶/↷) in the output screen's navigation bar are enabled or disabled from
`historyAt > 0` and `historyAt < history.length - 1`.

## 29. Search & filter on the calendar

A search box above the calendar (`matchingExamIds` in `OutputScreen.tsx`)
matches an exam's course number, course name or instructor against the typed
text, case-insensitively, and reuses the exact dimming mechanism the colour
legend of part IV, section 15.2 already had: an exam outside the match is
`chip-dim`, one inside it is `chip-lit`. The two filters compose rather than
compete - an exam has to satisfy both the search and the active programme
highlight to stay at full strength - so narrowing by programme and then
searching within it, or the other way around, both work.

## 30. Publish notifications

`web/src/engine/notify.ts` composes what a notification would say without
this software sending anything (section 23). `diffSystems(before, after,
programNumbers)` finds every exam whose date differs between the system that
was found and the system now on screen, for the selected study programs;
`draftsFor` groups the changes by programme and year and writes one subject
and body per group, listing every course whose date moved and to where. Each
draft becomes a `mailto:` link, opened by the browser's own mail client with
the message already written - sending it from there is a deliberate action
the user takes in their own name, the same as writing the email by hand would
have been. The Export tab shows one card per draft, and states plainly, next
to them, that nothing here is sent automatically and that no student email
address exists anywhere in the software's data.

## 31. Viewer vs. editor roles

### 31.1 What a viewer cannot do

Joining a collaboration room (part IV, section 16) now asks for a role,
editor or viewer, alongside the name. An editor keeps every ability part IV
describes; a viewer watches the same live moves and settings changes but
cannot make any: the calendar's exam chips are not `draggable`
(`isEditor` prop, threaded down to `OutputScreen`), and the whole Settings
screen is wrapped in a single `<fieldset disabled={readOnly}>`, which
disables every threshold checkbox, every sorting control and every search
bound input in one place rather than one at a time, with a banner above it
explaining why.

### 31.2 Enforced twice, for two different reasons

The client-side gate above exists so a viewer's screen never *offers* an
action that would only be refused; `server/index.js` enforces the same rule
independently, because the client that sends a message is not necessarily
the one that is honest about its own role. A `join` message now carries the
chosen role, kept per connection; a `lock` request from anyone but an editor
is refused exactly the way a lock already held by someone else is refused
(part IV, section 16.2), and a `settings` message from a viewer is silently
ignored rather than stored or relayed. `move` needed no separate check at
all: it already only succeeds for whoever holds the exam's lock, and a
viewer can never come to hold one. Every other user in a room sees who is an
editor and who is a viewer, by icon, in the collaboration panel.

## 32. Performance benchmark dashboard

`web/src/engine/benchmarks.ts` keeps a rolling history, in the browser's own
storage only, of the last 50 searches: when, how many exams, how many systems
were examined and accepted, how many were kept, how long it took, and the
average gap of the best system found - the same numbers `describeSearch`
(part III) already prints in words, kept as data instead. `App.tsx` records
one entry every time "Produce the exam systems" runs. A seventh sidebar tab,
**Benchmarks**, draws them as a small bar chart of seconds per run (pure CSS,
no charting library) followed by the full table, oldest at the top, with a
button to clear the history. Nothing here is sent anywhere, and the panel
says so.

## 33. Mobile-responsive layout

Every screen already used CSS grid and flex layouts rather than fixed pixel
positions, so most of this was adjusting breakpoints that already existed
(`grid-2` at 900px, `settings-columns` at 1000px) rather than inventing new
ones. Below 720px, the header wraps onto two rows instead of clipping, the
output sidebar turns from a left column into a horizontally scrolling strip
of icons above the calendar instead of beside it (with the large "possible
systems" count in its head hidden there, since the shorter "found" count
right below it already says the same thing more usefully on a narrow
screen), and the week calendar keeps its own horizontal scroll rather than
squeezing seven day columns into an unreadable width. One genuine bug was
introduced and caught while building this: `.app-header`'s fixed `height:
64px` does not grow to fit a header that has just been made to wrap onto two
rows, so the wrapped second row rendered on top of the content below it
instead of pushing it down; the mobile breakpoint now sets `height: auto` (a
`min-height` keeps the single-row look above 720px) - caught by comparing a
screenshot against the DOM's own computed layout rectangles before trusting
either alone.

## 34. Accessibility pass

`:focus-visible` is given an explicit accent-coloured outline globally, so
keyboard navigation is traceable across every control including the ones
that previously relied on the browser's own default; text inputs keep a
visible focus ring in addition to their existing border colour change, which
alone is a colour-only cue. `prefers-reduced-motion: reduce` collapses every
CSS transition and animation to effectively nothing for a user who has asked
for that at the operating system level. Icon-only controls that had no
accessible name - "clear search", "move criterion up/down" - carry an
`aria-label` stating what they do in words, not only in a glyph.

## 35. What was checked

Every one of the eleven was exercised in a live browser rather than only
read back from the source:

* **CSV import** - a hand-built courses CSV and a hand-built exam periods CSV
  were loaded through "Import CSV", replacing the real data files, and the
  loader's own summary line confirmed the right row counts; the production
  data files were then reloaded the same way to restore the original state.
* **Undo / redo** - a drag was made, undo returned the calendar and the
  "edited by hand" banner to exactly their pre-drag state, and redo brought
  the edit back, confirmed both by the DOM and by the buttons' own
  enabled/disabled state at every step.
* **Search & filter** - searching a course name dimmed every chip that did
  not match and lit up exactly the ones that did, out of the full set on
  screen, then clearing the search restored every chip.
* **Hour of day** - the default time slots showed on every chip and in every
  tooltip; two exams sharing a room on the same date were confirmed, by
  inspecting their bookings directly, to receive different slots, while two
  exams in different rooms correctly did not need to.
* **Compare** - selecting a second system populated a real metrics table
  against the system on screen, with the better cell of each row marked.
* **Benchmarks** - a real search run appeared in the dashboard's table and
  its bar chart with the true numbers of that run, not placeholder data.
* **Notifications** - a no-op drag (dropped back on its own date) correctly
  produced no draft, since nothing had actually changed; a real drag to a
  different date produced one correctly-worded `mailto:` draft per affected
  study programme, with the right subject, the right before/after dates and
  no draft for a programme the moved exam does not belong to.
* **Print** - the button switches to the tab holding the calendar and calls
  the browser's print function; the `@media print` rule was read back to
  confirm every non-calendar region is hidden from the printed page.
* **Viewer vs. editor roles** - two browser tabs joined the same room, one as
  editor and one as viewer. The viewer's Settings screen was confirmed
  disabled end to end (both the notice and the fieldset's own `disabled`
  state) and its calendar chips confirmed not draggable; a drag made in the
  editor's tab was confirmed to arrive in the viewer's tab and update its
  calendar, live, with no action taken there.
* **Mobile layout** - the output screen was rendered at a 375px viewport
  before and after the header-height fix of section 33, the second
  screenshot confirmed clean, non-overlapping stacking of every region, and
  the calendar was scrolled to confirm exam chips, including their assigned
  time, render legibly at that width.

`npx tsc -b` and `npm run build` (`web/`) both pass with the whole of this
part in place, and `node --check server/index.js` confirms the collaboration
server's own change is syntactically sound.

---

# Part VIII - entering data by hand

Every screen so far reads its courses, exam periods, rooms and staff
constraints from a file (part II, section 8.4; part VII, section 25 adds
CSV). This part adds a second way to reach the exact same data: typing it
directly into a live table on the Input screen itself. The two are not two
separate features that happen to sit side by side - a file load and a hand
edit write to the very same `data.courses` / `data.periods` / `data.rooms` /
`data.faculty` arrays `App.tsx` already held, so loading a file and then
opening its table shows exactly what the file said, editable from there
onward exactly as if it had been typed by hand from the start.

## 36. A table that is the data, not a form in front of it

`CoursesTable`, `RoomsTable` and `FacultyTable` (`web/src/components/`) share
one idea: there is no "save" button, because there is nothing to save to -
every keystroke calls `onChange` with the whole updated array, the same
`onCourses` / `onRooms` / `onFaculty` handlers `App.tsx` already passes
`FilesSection` for a file load, reached through three new props
(`onCoursesChange`, `onRoomsChange`, `onFacultyChange`) that skip the
file-name bookkeeping a load performs. A row not yet finished - a course
number that is not five digits yet, a capacity of `0` - is not rejected or
held back; it is simply marked with a red border (`.invalid`) so the problem
is visible while it is still being typed, and stays that way until section 39
below decides whether it is allowed to reach a search.

`FilesSection` gained one more button per data type it loads, "Enter
manually" (`edit_note`), that expands the matching table directly under the
existing "Replace" / "Add" / "Import CSV" row of its own card - one more way
to reach the same card, not a competing screen. Exam periods are the one
loader without this button: part II, section 8.4 and part VII already gave
periods a richer live editor of their own (the date fields and the exclusion
calendar), and section 38 below extends exactly that one instead of building
a second, competing editor for the same data next to it.

## 37. Courses, rooms and staff constraints as live tables

`RoomsTable` is the plain case: name, capacity, location, one row per room,
an "Add a room" button appends a blank one. `FacultyTable` is one degree more
involved, because `FacultyRules` is a `Record<instructor, ExcludedDates[]>`,
not an array - the table works on an array view of its entries instead
(`{ instructor, excluded }[]`) and rebuilds the whole record from that array
on every change, which is also what makes renaming an instructor safe: the
old key is never left behind mid-edit the way patching one key of the record
in place could leave it, because the record is not patched, it is rebuilt
fresh from whatever the rows currently say.

`CoursesTable` is the one genuinely nested case, because a course can be
taught in several study programs, years and semesters at once
(`Course.enrollments`). Its "Study programs" cell shows the enrollments
already added as small removable chips - "83101 · Year 1 · Fall ·
Obligatory" - reusing the very translation keys and lookup tables
(`REQUIREMENT_KEY`, `EVALUATION_KEY`, `SEMESTER_KEY`) `ProgramsSection`
already had for the same value sets, rather than a second copy of them - and
a compact inline form under the chips (a program number, a year, a semester,
a requirement, and a small `+`) to add one more without leaving the row.

## 38. Building an exam period from nothing, and a bug this surfaced

Part II's exam periods editor could move the dates of a period that already
existed, but nothing let a period be created in the first place without
first loading a file that already defined one. `AddPeriod`
(`web/src/components/PeriodsSection.tsx`) closes that gap: `missingCombos`
lists every `(semester, moed)` pair not yet among `periods` - up to all nine,
since neither value set is limited to what a loaded file happened to
mention - offered in a `<select>` next to a button that adds the chosen one
with sensible defaults (today, and three weeks after it) and no exclusions;
the date fields and the exclusion calendar the section already had then edit
it exactly like any period a file loaded. A delete button was added to each
row of the periods table alongside it, since a period entered by hand this
way is just as easy to remove again.

Building this surfaced a real bug in `setPeriodDates`
(`web/src/engine/edits.ts`), one that had nothing to do with periods created
by hand: moving the start or end date of *any* period, including one loaded
from a file, never pruned its `excluded` ranges to fit the new dates. An
excluded range that fell outside the shrunk period stayed in the array,
invisible - the exclusion calendar only ever shows a period's *current*
range, so a stale range simply stopped being drawn anywhere - right up until
another period's own range later grew to cover the same date, or the
original range grew back, and the "invisible" exclusion turned out to still
be there. `setPeriodDates` now clips every excluded range to the intersection
with the new `[startDate, endDate]` on every call: a range now entirely
outside the period is dropped, one only partly outside is trimmed to the
part still inside. This is deliberately destructive - growing a shrunk range
back does not resurrect the part of an exclusion that was clipped off it,
the same way a real calendar entry that was cut short does not un-cut itself
when the meeting is rescheduled longer again.

## 39. Catching bad data before the search sees it

A file that fails to parse never reaches `data.courses` and its neighbours
at all - `DataFileError` stops it first (part I, section 3; the CSV
equivalent in part VII, section 25). A live table has no such gate by
design (section 36): a half-typed row sits in exactly that state, in exactly
that array, for as long as typing takes. `web/src/engine/completeness.ts` is
what tells "still being typed" apart from "plainly wrong, and about to break
a search silently or confusingly" - a set of pure functions, each returning
the human-readable, already-translated problems it finds:

* `courseProblems` - the course number and every enrolled program number are
  five digits, the name and instructor are not empty, there is at least one
  enrolment, and a given number of students, if any, is a positive integer.
* `periodProblems` - no two periods' `[startDate, endDate]` ranges overlap
  each other, checked over every pair, not only Aleph against Bet of the
  same semester.
* `excludedDateProblems` - no two periods exclude the same calendar date,
  checked independently of `periodProblems` above: two ranges can fail to
  overlap yet still both exclude one shared date once the `setPeriodDates`
  bug of section 38 is considered, so this is not a redundant re-statement
  of the same fact, it is the check that actually catches that bug's result.
* `roomProblems` - a room's name is not empty and its capacity is a positive
  integer.
* `roomCapacityProblems` - no course's exam needs more seats than every
  loaded room could seat *combined*, the one shortfall that holds regardless
  of which date the exam is eventually given or which rooms are free that
  particular day. A shortfall that only happens on a crowded day is a
  different, schedule-dependent question, already answered where the
  schedule is actually known - the Rooms tab of the system on screen
  (part III, section 11.2) - not here.
* `facultyProblems` - an instructor's name is not empty, and every excluded
  range they have starts on or before it ends.

`dataProblems` concatenates all six lists; `App.tsx` computes it alongside
the existing readiness check (a courses file, a periods file, at least one
study program) and now requires it empty too before "Produce the exam
systems" is enabled. When it is not, every problem in it is listed, one line
each, in a small scrollable red panel above that button - naming exactly
which course, room, period pair or instructor is at fault, in the language
the user picked (part VII's translation system, `translate()` called
directly since these functions have no React tree to read a hook from - the
same pattern the engine's own error messages already use).

## 40. What was checked

* **Every table** - a course, a room and a staff constraint were each added
  by hand through its table (a course with an enrolment picked from the
  inline mini-form included), confirmed present by the loader's own summary
  line updating live, then removed again the same way, confirming the
  summary line and the underlying count both returned to exactly where they
  started.
* **Building a period from nothing** - the "add a period" dropdown was
  confirmed to offer exactly the five `(semester, moed)` combinations the
  loaded data did not already define; adding "Summer · Aleph" produced a new
  row with the correct 21-day default span, and removing it again left the
  original four periods untouched.
* **The `setPeriodDates` fix, both shapes of it** - a single-day exclusion
  was added, its period's end date shrunk past it and then restored: the day
  came back *available*, not silently excluded again, confirming the full
  removal case. Separately, the real three-day "Purim" range already in the
  example data had its period's end date shrunk to fall in the middle of the
  range: the day still inside the new range stayed excluded (a partial clip,
  not an all-or-nothing drop), and restoring the range afterward did not
  bring back the day that had been clipped off - confirming the trim is
  exactly as destructive as intended.
* **Every validation check** - an incomplete course (blank number, name,
  instructor, no study program) disabled "Produce the exam systems" and
  listed all four problems by name; a course given 5,000 students against
  1,000 total seats was refused with the exact seat counts named; two
  periods' dates edited to overlap were refused, naming both by semester and
  moed; the exact multi-step scenario section 38 describes (exclude a date
  in one period, shrink that period past it, grow a second period over the
  same date, exclude it there too) was refused once the check existed, and
  produced no problem at all once the `setPeriodDates` fix removed the stale
  exclusion at its source. Fixing every scenario above returned the button to
  enabled, and a real search still completed normally afterward. Several of
  these were confirmed again in Hebrew, including one read directly out of
  the browser's own stored data rather than off the screen, since the
  exclusion's comment text is not otherwise shown anywhere in the interface.

---

# Part IX - access control

Everything before this part is reachable by anyone who opens the software -
there was no notion of "who is using it" at all. This part adds one: a
visitor is now an admin, an editor, or a viewer, and which of the three they
are decides what they see before anything else on screen. An editor sees
exactly the application described in every part above. A viewer - a student -
sees one page: the exam schedule an editor chose to publish, read-only. An
admin sees one page of a different kind: every editor account that has ever
registered, with the approval that is the only way a new one starts working.

## 41. Three roles, and why the account list left the browser

The first pass at this feature was simpler and stayed entirely in the
browser: two hardcoded accounts, one editor and one viewer, checked against a
small array shipped inside the JavaScript bundle
(`web/src/auth/users.ts`, in an earlier form). That is enough for "an editor
sees everything, a viewer sees one page" on its own, and it was built that
way first.

It stops being enough the moment a new editor has to *register* and an admin
has to *approve* them, because those two actions now have to happen on two
different computers and still agree with each other. A registration typed
into a browser only ever reaches that browser's own `localStorage` - not a
shared drive, not even the same site visited a moment later from a different
machine, since `localStorage` is scoped to one origin *and* one browser
profile, never to "everyone who visits this URL". An admin opening the same
site on their own computer would never see a registration that happened
somewhere else; approving it would do nothing anyone else could ever observe.
A gate that only checks a local array cannot be the thing two different
people agree through - that requires one point of truth reachable from both
computers, which means a real server.

ScheduleForge already had one: the collaboration relay of section 16, a small
Node process whose only job until now was locking and broadcasting exam
moves. Rather than stand up a second server for one more feature, that same
process gained a second, unrelated job - accounts, approvals, and the
published schedule - documented below as what it is: still not a production
authentication system (no HTTPS here, no rate limiting, no password reset,
and a session token that lives only until the server restarts), but now
genuinely shared state instead of a per-browser illusion of it.

## 42. The server's half (`server/index.js`, `server/store.js`)

Section 16.2 says the collaboration server keeps "the server free of anything
that would need a database", true of everything it did until now: a room's
state is disposable, forgotten on restart, and nothing is lost that a class
could not simply redo. An account and a published schedule are not
disposable in the same way - losing every registered editor on a restart
would be a real regression, not a shrug - so this second job does need a
small persistence layer, and gets the smallest one that does the job:
`server/store.js` keeps `{ accounts, published }` as one JSON file
(`server/data.json`) next to it, read once at startup and rewritten after
every change. Nothing here is a database; a classroom's worth of accounts is
small enough that a plain file, rewritten whole each time, is simply enough.

A password is never written to that file as typed: `hashPassword` salts it
and runs it through `crypto.scryptSync`, and `verifyPassword` compares with
`crypto.timingSafeEqual` rather than `===`, so reading the file - or a stray
copy of it - does not hand out anyone's actual password, and checking one
does not leak *how much* of it matched through response timing the way a
plain string comparison would.

`server/index.js` grew an HTTP API alongside the WebSocket server it already
ran, both attached to the same `http.createServer` instance so the whole
server is still one process on one port:

* `POST /api/register` - creates an editor account with `status: "pending"`.
  Rejected with 409 if the username is already taken (an approved editor's or
  another pending one's).
* `POST /api/login` - checks the password, then the status: an unapproved
  editor gets a 403 with `reason: "pending"`, distinguished on purpose from a
  plain wrong-password 401 so the client can show a different message for
  each. On success, a random token is minted and mapped to the username in an
  in-memory `Map` - a session lives exactly as long as the collaboration
  rooms of section 16.2 do, forgotten on restart, for the same reason.
* `GET /api/me` - resolves a bearer token back to the account behind it.
  Every other authenticated route resolves the same way, from the
  `Authorization: Bearer <token>` header.
* `GET /api/editors`, `POST /api/editors/:username/approve`, `POST
  /api/editors/:username/reject` - admin-only (checked by role, not by which
  route was guessed at); reject deletes the account outright rather than
  marking it rejected, so the same username can simply register again.
* `GET /api/published`, `POST /api/published` - any signed-in account can
  read the currently published schedule; only an editor or admin can replace
  it. The body of a `POST` here is the whole `PublishedSchedule` object
  (`web/src/state/storage.ts`) - the server does not parse or understand it,
  only stores and returns it verbatim, exactly the way it never understood a
  scheduling rule in section 16.1 either.

CORS is open to any origin (`Access-Control-Allow-Origin: *`) since the web
app and this server are deliberately two different ports in development and
possibly two different hosts in a real deployment, the same reason the
collaboration WebSocket already had no origin restriction of its own.

## 43. Signing in, registering, and being approved

`web/src/auth/users.ts` now holds only the shapes - `Role` is `"admin" |
"editor" | "viewer"`, `Account` is what the server hands back - not an
account list, since there no longer is one on the client. `web/src/auth/
api.ts` is the one place that talks to the server: every function returns a
plain outcome value rather than throwing, including a distinct `"offline"`
outcome, because this server is optional infrastructure a class has to start
on its own, and a component that expected it to always be running would
break in a confusing way the moment it was not.

`AuthContext` (`web/src/auth/AuthContext.tsx`) persists only the session
token in `localStorage`, the same "never trust the stored copy on its own"
pattern the first pass at this feature already used for a username: on every
load, the token is sent to `/api/me` and whatever account comes back is what
the app trusts, not whatever role a stale token might imply. An admin
approving an editor, or revoking one by deleting their account, takes effect
the next time that editor's tab reloads or is opened fresh - not
instantaneously across an open tab, the same one-way freshness section 16
never promised for a settings change either, just resolved through a fetch
instead of a broadcast.

`LoginScreen` now holds two modes on the one card instead of a single form:
sign in, or register as an instructor, switched with a plain text button
rather than a second screen, since the two are close enough in shape (the
same username and password fields, one extra name field for registering)
that a second screen would only be a second thing to keep visually in sync
with the first. A failed attempt shows one of five distinct messages -
wrong credentials, still pending approval, the server could not be reached,
the username is already taken, or (registering) success with an explicit
"an admin still has to approve this" notice - rather than one generic
"something went wrong", because each of those actually calls for a different
next action from the person reading it.

`AdminScreen` is the one page an admin account ever reaches (`AppGate.tsx`
below routes straight to it, nothing else): every editor account, pending
ones listed first with an Approve and a Reject button each, approved ones
listed below with nothing left to do to them. It refetches the list after
every approve or reject rather than trusting an optimistic local update, on
the same reasoning as the read-after-write choice made everywhere else this
document touches shared state - the server's own record is the one that
matters, not a guess at what it now contains.

## 44. Publishing a schedule, and the one page a viewer sees

`OutputScreen` gained one more footer button, "Publish for students"
(`campaign`), next to "Save this system" and "Print". `onPublish` is handed
down from `App.tsx` as a function returning `Promise<boolean>`, so the
button can show its own success or failure state without `App` having to
know anything about how a button looks; `App.tsx`'s implementation builds a
`PublishedSchedule` (section on `state/storage.ts`, added when this feature
was first designed and unchanged in shape since) from `workingSystem` and
whatever periods, rooms, study programs and settings produced it, and sends
it with one call to `auth/api.ts`'s `publish`.

`StudentView` no longer receives a `published` prop read out of this
browser's own storage the way an earlier draft of it did - it fetches
`/api/published` itself, on mount, with its own loading and "could not reach
the server" states, plus a manual refresh button in its header, since there
is no push channel to this one page the way section 16's WebSocket pushes a
move to an open editor's screen. A student who wants to see a just-published
change presses refresh (or reopens the page); nothing here needed to be
real-time for a schedule that, once published, does not change every few
seconds the way a shared drag-and-drop edit does.

`AppGate.tsx` is the new top-level component `main.tsx` renders instead of
`App` directly: it wraps everything in `AuthProvider`, and while a session is
still being restored (the `/api/me` round trip of section 43) shows nothing
but a small loading line rather than flashing the login screen and then
immediately replacing it. Once resolved, it renders `LoginScreen` for no
account, `AdminScreen` for an admin, `StudentView` for a viewer, and `App` -
completely unchanged from every part before this one - for an editor.

## 45. What was checked

* **The server's HTTP API directly**, with `curl`, before touching the UI at
  all: registering a new editor returned `pending`; logging in as that editor
  before approval returned the distinct `pending` reason rather than a plain
  401; the admin account could list it, approve it, and log in as it
  afterward succeeded; a non-admin token was refused `/api/editors` with 403;
  publishing a schedule as an editor and then fetching it back with a
  completely different account's token returned the same object. This caught
  a real bug before it reached the browser at all: `sendJson` did not signal
  to its caller that a response had already been sent, so a request that
  matched no route inside `handleApi` triggered a second `res.writeHead`
  after the first and crashed the process with `ERR_HTTP_HEADERS_SENT`.
  Fixed by having `sendJson` return `true`, so every route handler can
  `return sendJson(...)` directly and the fallback 404 only ever fires when
  nothing else already answered.
* **The full flow in the browser, in both languages** - registered a new
  instructor account from the login card; confirmed logging in as that same
  account immediately afterward was refused with the pending message;
  switched accounts and signed in as the seeded admin account, saw the new
  registration at the top of a "waiting for approval" list, and approved it;
  signed out and back in as the now-approved instructor, reaching the
  ordinary application exactly as an editor always has; produced a set of
  exam systems and pressed "Publish for students"; signed out and back in as
  the seeded viewer account and saw that exact schedule, read-only, with
  nothing else in `App` reachable from that account. Repeated the sign-in and
  the published view in Hebrew, confirming the RTL layout and the new
  `auth.*`, `admin.*` and `studentView.*` translation keys read correctly in
  both languages.
* **Roles staying separate** - a viewer account's token was confirmed unable
  to reach `/api/editors` or approve anything, and an editor account was
  confirmed unable to reach it either, leaving it genuinely admin-only rather
  than merely hidden from the editor and viewer screens.
* `npx tsc -b` and `npm run build` both stayed clean throughout, and
  `node --check` on both `server/index.js` and `server/store.js` confirmed
  the server half parses correctly, the same baseline check section 16's own
  "what was checked" used for the collaboration server.

---

# Part X - places, and a server built to actually be depended on

Part IX's server was built for one class, running on whichever laptop
happened to start it, and said so plainly (section 41: "not a production
authentication system"). This part is the two changes that stopped being
true together, because they turned out to be the same problem seen from two
sides: the software was still shaped for exactly one institution's worth of
data (one shared course list, one shared schedule, one flat set of accounts
all reaching the same place), and it was still shaped for exactly one
person's trust in it (a file next to the server process, a session that
outlived nothing, a password nobody could ever reset). Neither could be
fixed on its own and still leave the other one true.

## 46. Places: multi-tenancy instead of one shared instance

A **place** (`auth/users.ts`'s `Place` - an id, a name, a free-text `kind`
the admin typed: "university", "high school", "college", or anything else)
is the unit everything else now belongs to. Every account except `admin`
carries a `placeId`; every editor's publish, and every teacher's or
student's read, is scoped to it. The scoping happens server-side, resolved
from the caller's own token (`server/store.js`'s `accountForToken`), never
trusted from anything the client sends - the request body for
`POST /api/published` is still just the `PublishedSchedule` object of
section 44, with nowhere in it to name a place at all, so there is no field
one editor could set to publish into a different one's schedule even by
mistake. `published`, one object under section 42's design, became one
object *per place* (`server/db.js`'s `published_schedules` table, keyed on
`place_id`) for exactly this reason.

Only an admin creates a place (`AdminScreen`'s new "Places" panel, a name
and a kind, `POST /api/places`); registering into one is the only choice
left to anyone else, made from a `<select>` on the registration card
(`LoginScreen.tsx`) populated by `GET /api/places` - public on purpose,
since a visitor has to see the list before they have an account to see it
with. A fresh deployment has no places and no accounts but `admin`
(section 48), so the very first thing an admin does with a new one is
create the place their own institution will actually use.

## 47. Two new roles, and the calendar rendering they share

Section 41's "a viewer - a student - sees one page" became two roles
instead of one, because "everyone who cannot edit" turned out to mean two
different questions once more than one course's worth of exams was in play:
a **student** wants the exams that apply to *their* study program and year;
a **teacher** wants the exams *they* teach, which is not the same slice at
all - a teacher of a required first-year course and a teacher of a
third-year elective see almost entirely different calendars from the same
published schedule.

Both are filters over the exact same `PublishedSchedule` section 44 already
built, not two different features: `StudentView` filters by
`account.program` and `account.year` matched against `exam.slots`,
`TeacherScreen` filters by `account.instructorNames` matched
case-insensitively against `exam.course.instructor`. A student supplies
their program and year themselves at registration, since only they know it;
a teacher supplies the instructor name they register under themselves too
(matched exactly, no admin-assisted linking step) - both self-service,
neither behind the approval gate section 43 built for editors specifically,
because a read-only account cannot do anything an approval would be
protecting.

Everything below the filter - the week calendar, the room and time tooltip,
the highlight legend, the exam chip itself - was one component doing the
same work twice with two different data feeds, so it was pulled out once
into `components/PublishedScheduleCalendar.tsx`, taking `published` and a
`filterExam` predicate. Both `StudentView` and `TeacherScreen` are now thin
wrappers around it: fetch the schedule, decide the predicate, hand both to
the shared component - the legend itself changed along the way too, now
built from whichever programs remain *after* filtering rather than from the
place's whole `selectedPrograms` list, so a teacher whose courses only touch
two of a place's five study programs sees a legend of exactly two, not five.

## 48. From a JSON file to Postgres

Section 42's `server/data.json` - "a classroom's worth of accounts is small
enough" - stopped being true the moment a place could mean a real
institution's worth of them, and stopped being safe regardless once a
production deployment's filesystem could not be trusted to survive a
redeploy at all (many hosts, Render included, treat a service's own disk as
disposable). `server/db.js` replaces it with Postgres: four tables
(`places`, `accounts`, `sessions`, `published_schedules`), a schema created
automatically on boot (`migrate`, plain `CREATE TABLE IF NOT EXISTS`, no
migration framework - the schema has only grown once so far, and a real
migration tool can wait until it needs to grow a second time in a way that
is not simply additive). Every function in `server/store.js` that used to
read and write the file synchronously now runs one SQL query, and every
route in `server/index.js` that called it now `await`s it - a mechanical
change everywhere, save one place it was not: `sessions` moved from an
in-memory `Map` (section 42's "forgotten on restart, for the same reason"
the collaboration rooms are) into its own table, because losing every
signed-in session on every redeploy, which a production server should
expect to happen far more often than a classroom server ever restarted, is
a real cost a demo never had to pay.

A fresh database seeds exactly one account, `admin` (`ensureBootstrapAdmin`)
- not the four fixed demo accounts of section 45's walkthrough, which now
only exist behind `SEED_DEMO_ACCOUNTS=true`, explicitly documented as never
for production, since their passwords are public (they are in this very
document). `admin`'s own password comes from `ADMIN_PASSWORD`, or, if that
is unset, a random one generated and logged exactly once at startup
(`server/log.js`, section 51) - printed nowhere else, on purpose, so there
is never a second copy of it sitting in a file or an environment variable
history to leak.

## 49. Hardening: sessions, lockout, rate limiting, and a password reset that actually resets something

Section 41's parenthetical - "no rate limiting, no password reset, a session
token that lives only until the server restarts" - was three separate gaps,
closed three separate ways:

* **Sessions expire.** A token's `expires_at` slides forward by 24 hours on
  every authenticated request (`accountForToken`'s `UPDATE ... RETURNING`,
  one query doing the check and the renewal together); idle for a day and
  the next request finds nothing to renew, the same as if the account had
  been signed out.
* **An account locks out.** Five wrong passwords in a row
  (`recordFailedLogin`) sets `locked_until` fifteen minutes out; a login
  attempt against a locked account is refused with a distinct `"locked"`
  reason before the password is even checked, and a correct login
  (`recordSuccessfulLogin`) clears the counter back to zero.
* **Login and registration are rate-limited per IP**
  (`server/rateLimit.js`), independent of the per-account lockout above - a
  lockout stops someone guessing *one* account's password; the rate limit
  stops someone trying many usernames against the same weak password, which
  a per-account counter alone would never catch.

A password reset (`AdminScreen`'s "Reset password" button,
`POST /api/accounts/:username/reset-password`, admin-only) generates a
random temporary password, shown to the admin exactly once to relay out of
band - there is still no email sending anywhere in this project, the same
choice section 41 already made and one this part did not revisit - and sets
`must_change_password`, checked on every subsequent sign-in. `AppGate.tsx`
now checks that flag before routing to any role's screen at all, showing a
new `ChangePasswordScreen` instead; `POST /api/change-password` verifies the
temporary password, sets a new one, and revokes every session the account
held (`revokeAllSessions`) - including the one the change request itself was
made with, so the natural next step is signing back in with the new
password, not continuing on a session the server has already forgotten.

## 50. Deploying for real: Docker, Render, and the constraint that comes with it

`server/Dockerfile` is the one artifact everything downstream depends on: a
plain `node:20-alpine` image, `npm ci --omit=dev`, the server's own files
copied in by name, a `HEALTHCHECK` hitting the same `/healthz` route
`render.yaml`'s `healthCheckPath` also points at. `render.yaml` is a Render
Blueprint - the database, the server (built from that Dockerfile), and the
web app (a static build of `web/`) declared as one file, so connecting the
repository creates the whole deployment in one pass; `DEPLOYMENT.md` is the
manual half a file cannot do - the Render account, the secrets a
`sync: false` value only prompts for once, wiring the two services' URLs
into each other after Render assigns them, a domain.

One constraint follows straight from section 46's own design, not from
anything new: `render.yaml` pins `numInstances: 1`. The collaboration
relay's room state (section 16.2's `Map`s of exam dates and locks) still
lives in one process's own memory, exactly as it always has - a second
instance would simply not see the first one's rooms, so two people in "the
same" room could land on different instances and never see each other's
moves at all. Rate limiting does not have this problem any more (below); the
collaboration relay does, and fixing it is a real distributed-systems
project - typically Redis pub/sub relaying a lock or a move between
instances, since a client's WebSocket connection is pinned to whichever one
it happened to land on - not attempted here, and not needed at the one
place this is currently running.

The web app itself gained one small dependency on where it is deployed that
local development never had: `auth/api.ts`'s `baseUrl` and
`CollabBar.tsx`'s `defaultServerUrl` used to assume the server sits on the
same host as the web app, just a different port - true on `localhost`, false
the moment they are two separate Render services with two separate
hostnames. Both now read a build-time Vite variable (`VITE_API_URL`,
`VITE_WS_URL`) first, falling back to the same-host guess only when it is
unset - which is why `render.yaml`'s web service declares both as
`sync: false` values to be filled in once the server's real URL exists.

## 51. Logs an operator can use, and error reporting that costs nothing to leave off

Every `console.log`/`console.warn`/`console.error` in `server/index.js`
became one call into `server/log.js` instead - one JSON object per line
(`time`, `level`, `message`, and whatever else that event carries, like a
request's path or an account's username), because a person reading this
server's logs from now on is far more likely to be a log viewer filtering on
a field than someone scrolling a terminal by eye.

`server/errorTracking.js` wraps every place an error already reached a
`catch` (a bad request, a route handler that threw, the process's own
`uncaughtException` and `unhandledRejection` - neither previously handled at
all) in one function, `captureError`, that always logs and, only if
`SENTRY_DSN` is set, also reports to Sentry. Unset is the default and a
fully supported one, not a degraded mode - nothing about running this server
requires an account with Sentry, the same design section 41 already used for
"no email sending" and section 49 for "no HTTPS in this code:" a real
capability, opt-in, with the software working exactly as well without it as
a smaller project that never needed it at all.

## 52. What was checked

* **The whole server rewrite, against a real database, not a mock** - a new
  `server/test/api.test.js` (Node's own `node:test`) runs a full
  register-approve-publish-read cycle, confirms a teacher or student
  registered into one place gets `null` back from a different place's
  `/api/published` rather than that place's own schedule, and confirms a
  password reset both revokes the session that was active before it and
  forces `must_change_password` on the next sign-in - each against a real
  Postgres, started fresh for the run, never mocked. This caught a real bug
  during development: the rate limiter counting every `/api/register` call
  the suite itself made toward the same production limit real traffic would
  share, tripping mid-suite on the sixth call - not a bug in the limiter,
  which was doing exactly its job, but a reason the limits are now
  overridable by environment variable for a test run specifically
  (`REGISTER_RATE_LIMIT`, `LOGIN_RATE_LIMIT`), left at their production
  defaults everywhere else.
* **The server's own Docker image, run for real** - built from
  `server/Dockerfile`, connected over an actual Docker network to a
  throwaway Postgres and a throwaway Redis container (not `localhost`
  shortcuts), confirmed it migrates its schema, creates the bootstrap admin,
  answers `/healthz`, and authenticates that admin - then confirmed a
  first-boot race (the server starting a beat before Postgres was truly
  ready to accept connections) crashes the process rather than retrying
  forever, and that restarting the container the way a real platform's
  supervisor would recovers cleanly.
* **Rate limiting's Redis path specifically** - run against a real Redis
  container with `REGISTER_RATE_LIMIT` lowered to 3: the first three
  registration attempts succeeded or failed on their own merits, the fourth
  was refused with 429 before it was even validated, and `redis-cli KEYS`
  confirmed the counter genuinely lived in Redis rather than the in-memory
  fallback silently taking over.
* **The full role and place walkthrough in the browser** - registered a
  student into the seeded place and confirmed their calendar showed only
  the courses of their own program and year; signed in as the seeded
  teacher and confirmed a visibly different set of exams, matching that
  teacher's own instructor name; created a second place from the admin
  screen and registered a teacher into it, confirming their published
  schedule read back `null` rather than the first place's data, matching
  what the API-level test above already established.
* `npx tsc -b`, `npm run build` and the Python suite all stayed green
  throughout, and `.github/workflows/ci.yml` gained a third job running
  `server/test/api.test.js` against a real Postgres service container -
  confirmed passing in GitHub's own Actions runner, not only locally.

---

# Part XI - Firestore, and what only deploying for real ever finds

Part X's own section 50 said Postgres's free tier was "fine for standing
this up and trying it, not something to leave unattended long-term" and
moved on. That sentence turned out to be more literal than it read: the
free database Part X's own live walkthrough actually created carried a
30-day expiration stamped on it the moment it existed, visible only once
something had actually been deployed rather than merely built toward. This
part is the fix, and everything else that only surfaced by going the rest
of the way - creating the real accounts, generating a real credential,
watching a real deploy fail and then succeed - that building the software
alone never would have shown.

## 53. Why Postgres didn't survive contact with an actual deployment

Render's free Postgres plan is real - no card needed to create it - but
time-limited in a way its paid tiers are not: deleted 30 days after
creation, with a 14-day grace period to upgrade first. Nothing in `server/`
depended on that timer, but the deployment as a whole did, silently, the
moment `render.yaml`'s database block went live - a fact `DEPLOYMENT.md`
already flagged honestly once it was discovered, but a design document
should not keep a component whose foundation is a countdown. Firebase's
Spark plan is the replacement specifically because it has no equivalent
timer: free, indefinitely, at daily limits (50K reads, 20K writes, 20K
deletes, 1 GiB storage) an application at this scale - a handful of
institutions, one schedule per place - has no realistic path to reaching.

## 54. From rows to documents

`server/db.js` no longer opens a connection pool to a SQL server; it
initializes the Firebase Admin SDK, either against a real project
(`FIREBASE_SERVICE_ACCOUNT`, a service account's full JSON key as one
environment variable) or the local emulator (`FIRESTORE_EMULATOR_HOST`),
chosen by which of the two is set. `server/store.js`'s four SQL tables
became four Firestore collections with the same shape - `places`,
`accounts`, `sessions`, `published` - keyed the same way an account's
document ID is still its own username, so "does this username exist" is
still one lookup, not a query.

Two things came out simpler than the SQL version, not just different.
First, there is no more `rowToAccount` translating `display_name` into
`displayName` - a Firestore document's fields are already whatever shape
the code wrote them in, so the mapping function that existed only to
undo SQL's own naming convention simply had nothing left to do. Second,
and a genuine correctness improvement rather than a wash: `register`
used to check `findAccount` first and insert second, the same
race-prone shape a real unique constraint on the `username` column
happened to paper over without the code ever handling the conflict it
could still have raised. Firestore's `.create()` fails outright if the
document already exists, so the check and the write are now the same
atomic operation, with the failure handled (`FIRESTORE_ALREADY_EXISTS`)
rather than merely made unlikely.

One thing came out needing more care, not less: Postgres's
`UPDATE ... RETURNING` did an atomic read-modify-write in one round trip,
which `recordFailedLogin` and `accountForToken`'s sliding session expiry
both leaned on. Firestore has no single statement shaped like that;
`db.runTransaction` is the replacement, reading the current document and
writing its update inside one transaction so two requests racing to touch
the same account or the same session still cannot interleave into a wrong
result - more code than the SQL version needed for the same guarantee, not
less, but the guarantee itself did not change.

## 55. Testing without a real cloud dependency

`server/test/api.test.js` did not change - the same eight assertions
against the same HTTP API - but what it runs against did: the Firebase
Local Emulator Suite (`server/firebase.json`, a Java-based Firestore
emulator the Firebase CLI downloads and manages) instead of a disposable
Postgres container. `server/firestore.rules` denies every client read and
write outright (`allow read, write: if false`) - not a placeholder to
tighten later, the actual intended production posture, since nothing in
this project ever reaches Firestore except through the server's own Admin
SDK, which bypasses security rules entirely by design, whether it is
talking to a real project or the emulator. The two are indistinguishable
to `server/store.js`; only `server/db.js`'s initialization branches on
which one it is pointed at.

`npm run test:ci` wraps the whole thing in `firebase emulators:exec`,
which starts the emulator, waits until it is actually ready, runs the
wrapped command, and tears the emulator down again - one command instead
of hand-rolling the start/wait/stop sequence a Postgres service container
got from GitHub Actions for free. `.github/workflows/ci.yml`'s server job
gained an `actions/setup-java` step for exactly this reason: the emulator
needs a JVM, which the Node-only job never had to think about before.

## 56. Deploying it for real

Everything above was verified against the emulator and the built Docker
image before touching Render at all - the same discipline Part X's own
section 52 already established. What follows is what only touching Render,
and Firebase's own console, for real actually found, none of it visible
from reading the code:

* **`render.yaml`'s own schema was wrong**, caught by Render's Blueprint
  validator refusing to deploy it: an environment variable cannot specify
  both `value` and `sync: false` at once, which every `sync: false` entry
  from Part X's own section 50 did. A second, separate bug followed once
  that one was fixed - an omitted `plan:` defaults to a paid tier, not
  free, for both a database and a web service, so `render.yaml` now names
  `plan: free` explicitly on `scheduleforge-server` rather than relying on
  a default that was never actually free.
* **Render asks for payment information even on the free plan**, once a
  Blueprint with a database was involved - a real requirement of the
  platform, surfaced only by actually clicking "Deploy" and hitting the
  prompt, not documented anywhere reasoning about the YAML alone would
  have found. `DEPLOYMENT.md` says so plainly, including that entering the
  card details is a step only the person deploying this can take.
* **Setting up the Firebase project itself was a real, separate, first
  walkthrough** - `console.firebase.google.com`, a new project on the
  Spark plan, a Firestore database created in production mode (matching
  `firestore.rules`'s own deny-by-default posture from the moment it
  exists), and a service account's private key generated once, downloaded
  as a JSON file, and pasted directly into Render's environment settings
  by a person, never by whatever was assisting with the deployment -
  entering an API credential into a field is not delegated, the same
  boundary this project's own passwords have been held to throughout.
* **The database migration was not a migration.** Firestore starts empty;
  nothing that existed in the Postgres deployment - the admin account, any
  place, any registration - carried over, because there was never a
  script or a step that could have moved it, only a different backend
  entirely swapped in underneath the same code. The first sign-in against
  the new database used a freshly generated bootstrap admin password,
  exactly as `ensureBootstrapAdmin` produces for any database that has
  never seen an admin account before - the mechanism worked exactly as
  designed for a first deploy, which, from Firestore's side, this was.
* **The old database, once nothing referenced it, was deleted outright**
  rather than left running toward its own 30-day expiration - `render.yaml`
  no longer has a `databases:` block at all, so there was nothing left for
  Render's own Blueprint sync to manage even if it had been left in place.

## 57. What was checked

* **The full server rewrite, against the real emulator, not a mock** - the
  same suite section 52 already ran against Postgres, unchanged in what it
  asserts, run again against Firestore: the place → editor → approve →
  publish → student flow, cross-place isolation, and the password-reset →
  forced-change flow all passed against a freshly started emulator.
* **The actual production Docker image, rebuilt and rerun** - built from
  the same `server/Dockerfile`, this time installing `firebase-admin`
  instead of `pg`; a real lockfile/npm-version mismatch surfaced here (the
  image's older bundled npm disagreeing with a lockfile a newer npm had
  written) and was fixed by pinning npm's version inside the image itself,
  not papered over by regenerating the lockfile again.
* **The whole deployment, end to end, on the real Render and Firebase
  services** - not a rehearsal: the Firebase project and Firestore
  database created from nothing, the service account key generated and
  wired into Render's environment, a Blueprint deploy that failed exactly
  as designed (loudly, before serving anything) while the previous,
  working Postgres-backed deploy kept serving traffic underneath it, a
  second deploy that succeeded once the credential was in place, a
  freshly generated admin password confirmed by actually signing in at
  the live URL, and the now-orphaned Postgres database deleted only after
  all of that was confirmed working.

---

# Part XII - Auth hardening: cookie sessions, password policy, session list, place-scoped administration, and self-service password reset

Section 41 called part IX's server "not a production authentication
system" and named the gaps plainly: no rate limiting, no password reset, a
session token that lived only until the process restarted. Part X closed
the first two - rate limiting, sessions that expire, an admin-mediated
reset - and section 49 still ended on "there is still no email sending
anywhere in this project." From a brainstormed list of twenty further
improvements, six were picked and built together, not because any one of
them was overdue on its own, but because together they are one coherent
security posture rather than six unrelated features: a session that cannot
be read by a script on the page, a password that cannot simply be guessed
or reused, a way to see and end a session without contacting an admin, an
administrator whose reach stops at their own place, and a password reset
that does not require contacting anyone at all. Cookie transport is the
foundation the other five build on cleanly, so it went first.

## 58. Cookie sessions, and the CSRF defense the transport requires

`POST /api/login` now sets the session token in an `HttpOnly` cookie
(`sf_session`) instead of returning it in the response body for the client
to hold in `localStorage` the way section 42 described; `POST /api/logout`
clears it. Every authenticated route resolves the caller from that cookie
(`accountFromRequest`) rather than an `Authorization: Bearer` header, and
every client call in `web/src/auth/api.ts` adds `credentials: "include"` so
the browser attaches the cookie itself - no code anywhere reads or sets the
session value directly any more, the whole point of moving it out of
`localStorage` in the first place: a script an attacker got onto the page
through some other hole can no longer simply read the session and walk off
with it.

That protection is not free. A cookie is attached to a request
automatically by the browser, including a request a *different* site
persuaded the browser to make - the exact attack a bearer token sitting in
`localStorage` was structurally immune to, since nothing but this
application's own JavaScript could ever attach it. Two things close that
gap: `Access-Control-Allow-Credentials: true` paired with `ALLOWED_ORIGIN`
set to the web app's real origin rather than a wildcard (a wildcard origin
is not legal for a credentialed request at all, so this is enforced, not
merely configured), and every mutating request required to carry
`X-Requested-With: ScheduleForge` - a header a plain cross-site form cannot
set, and one a cross-site `fetch` cannot add without first passing the very
same origin check at the CORS preflight stage. Together they are this
API's whole CSRF defense, and `server/index.js`'s own header comment says
so plainly: cookie transport is "a real difference against XSS, at the cost
of needing genuine CORS/CSRF care instead of the false safety a bearer
token gave for free."

## 59. A password policy that checks strength beyond length, and a history that remembers

`server/passwordPolicy.js` rejects a password that equals or contains the
account's own username, or matches an entry of an embedded, roughly
200-entry set of the passwords that show up at the top of every published
breach-analysis list, year after year - no third-party library, the same
stance section 25.1's CSV parser already took on that kind of dependency,
and no network call needed for a fixed list this small. The reasoning
follows current guidance (NIST 800-63B) rather than the older instinct to
force a digit or a symbol: what actually predicts a password being guessed
is whether it is already on every attacker's list, not whether it satisfies
an arbitrary complexity rule that mostly just pushes people toward
predictable substitutions. `wasUsedBefore` checks a newly chosen password
against the current hash and the account's last five (`previousPasswords`,
pushed on every user-chosen change, capped at five) using the same
`verifyPassword` comparison section 42 already used to avoid a plain
string check. Both checks run at registration and at any change the
account itself chose; the admin-generated temporary password of section 49
is exempt, since it is random, single-use, and immediately superseded by a
password the checks *do* apply to.

## 60. A session/device list

`GET /api/sessions` lists every session belonging to the caller -
`{id, userAgent, createdAt}`, plus which one is the request's own -
and `DELETE /api/sessions/:id` ends one of them. The `id` shown is not the
session token itself: `createSession` now stores a separate, random public
`id` alongside the token that is the Firestore document's own key, so a
session can be listed and revoked (`sessionIdFor`, `listSessions`,
`revokeSession` in `server/store.js`) without the response ever containing
the one value that would let someone impersonate it. `revokeSession`
matches on `username` as well as `id`, which is the actual thing stopping
one account from ending a session that belongs to someone else -
`AccountMenu.tsx` is the one new piece of UI this needed, replacing the
bare sign-out button three screens' headers had duplicated, with "this
device" labelled on the matching row.

## 61. Institution-scoped sub-admins

A new role, `placeAdmin`, sits between `admin` (every place) and the three
roles part X already scoped to one place. `isGlobalAdmin(account)` and
`canAdminister(account, placeId)` replace the scattered
`account.role !== "admin"` checks section 42 described, and
`POST /api/places/:placeId/admins` (global-admin-only) creates one,
mirroring `register`'s shape but skipping the pending-approval step an
admin creating another admin does not need.

Building this surfaced a real authorization-ordering bug, caught by the
project's own test suite before it ever reached production: the first pass
at the approve/reject/reset-password endpoints looked up the target account
first and returned 404 if it did not exist, only checking the caller's
authorization afterward - which meant an unauthorized or even unauthenticated
caller could learn whether a given username existed at all, purely from
whether the response was a 403 or a 404. `tests/validation.test.js`'s
existing "approve is refused for a non-admin" case expected a 403 and got a
404 instead, which is what caught it. The fix reorders all three endpoints
to check `isGlobalAdmin(account) || account.role === "placeAdmin"`
unconditionally, before any lookup of the target happens at all, and only
then looks the target up and checks `canAdminister` for the finer-grained
per-place question - the same "authorization first, existence second"
ordering a well-built system should default to, restored here after
getting it backwards once.

## 62. Self-service password reset by email

`server/email.js` sends through Resend's HTTP API directly (a plain
`fetch`, no SDK); `RESEND_API_KEY` unset logs the reset link instead of
emailing it, the same "optional external service, fully usable without it"
shape section 51 already used for `SENTRY_DSN` and section 49's
`REDIS_URL` - a class or a local checkout needs nothing new to exercise the
whole flow end to end, only a real deployment that wants real email needs
the account. `POST /api/forgot-password` always answers with the same
generic response whether or not the given address matched an account, so
the response itself never reveals which addresses are registered; when it
does match, a single-use token good for one hour is written to a new
`passwordResets` collection and consumed inside a Firestore transaction
(`consumePasswordReset`), closing a race two near-simultaneous uses of the
same link would otherwise open. `POST /api/reset-password/confirm` runs
the same strength and history checks section 59 added, and revokes every
session on the account exactly as an admin-mediated reset already did.

## 63. What was checked

* **New and rewritten server test files, against the real emulator** -
  `server/test/sessions.test.js`, `password-policy.test.js`,
  `place-admin.test.js` and `forgot-password.test.js` are new; `api.test.js`,
  `validation.test.js` and `rate-limit.test.js` were rewritten to carry a
  session cookie the way a browser would instead of a bearer header, and
  `validation.test.js`'s existing place-admin case is what caught section
  61's ordering bug before this ever reached a browser.
* **A manual pass in the browser** - registered a new account (now
  requiring an email), confirmed the session lived in a cookie rather than
  `localStorage`, opened the sessions list from a second browser profile and
  revoked the first session from there, triggered forgot-password with no
  `RESEND_API_KEY` set locally and confirmed the logged reset link genuinely
  reset the password, and, as the global admin, created a place admin and
  confirmed that account's `/api/accounts` and approve/reject calls only
  ever reached its own place's data.
* **A real deployment bug, caught by the live service, not by inspection** -
  `server/Dockerfile` copies its files in by explicit name rather than
  `COPY . .`, and the two files this part added (`email.js`,
  `passwordPolicy.js`) were not added to that list; the first production
  deploy crashed on boot with `Error: Cannot find module './passwordPolicy'`
  - Render kept serving the previous, working build throughout, so nothing
  was down while this was found and fixed - and a second deploy, plus a
  live `/healthz` check against the running service, confirmed the fix.
* `npx tsc -b`, `npm run build`, the Python suite and
  `server/test:ci` all stayed green throughout.

---

# Part XIII - Five new exam-scheduling factors

Every rule up to part III's section 10 reasons about a course's students
only in aggregate - the (program, year) it is taught in - because that is
what requirement 1.1's catalogue and Appendix A's data files carry, and
every threshold since has stayed inside that same model. From a
brainstormed list of gaps in it - things the aggregate model genuinely
cannot see, and things the requirements never asked the software to do at
all - five were picked: institution-wide blackout dates, a minimum gap
between moed Aleph and moed Bet of the same course, a cap on how many exams
of one program and year fall inside any short window of days, real
per-student enrollment conflicts, and time-of-day turned from a purely
cosmetic display layer into a real constraint the search itself can be
asked to enforce.

Each one is built on **both** scheduling engines this project maintains -
the Python engine (`schedule_forge/`), section 4's tested reference
implementation, and `web/src/engine/`, the hand-mirrored TypeScript engine
`App.tsx` calls directly in the browser (section 8.2) - since, as section
8.2 already says, neither one is derived from the other; a change to
either alone would leave them silently disagreeing. Every new setting
described below is unset or off by default, so a run that never asks for
any of this behaves exactly as it did before this part, on both engines,
verified by every pre-existing test in both suites staying green throughout.

## 64. Institution-wide blackout dates

A second, optional excluded-dates input, distinct from the per-instructor
staff constraints of the version 3.0 extension: dates on which no exam of
any course may be held at all, for the whole institution, rather than one
instructor. `GlobalExcludedDatesParser` and `merge_into` (Python),
`parseGlobalExcluded` and `applyGlobalExcluded` (TypeScript) reuse the
existing `ExcludedDates`/`ExamPeriod` shape as-is - no new model class on
either side, since a period's own excluded-dates list is already exactly
the right shape for a date that happens to come from a different source.
The two engines genuinely differ in one small way here, not by mistake:
Python's `ExamPeriod.available_dates()` caches its result the first time
anything asks for it, so the merge has to happen before anything does;
TypeScript's `availableDates` is a pure function recomputed on demand, so
no such ordering exists to get wrong there.

## 65. Minimum gap between moed Aleph and moed Bet of the same course

`MinimumGapBetweenMoeds` (`schedule_forge/scheduling/constraints.py`) and a
top-level check inside `requiredGap` (`decomposition.ts`) both deliberately
do **not** key on `period_key` - the opposite of the existing 2.1/2.2 gap
rules (section 10.1), which explicitly skip a pair whose moed differs, on
the reasoning that a student only ever sits one of the two. This rule is
for the people around the exam rather than the student sitting it: the
instructor grading moed Aleph, or the department preparing the room and
the paperwork for moed Bet, genuinely needs real time between the two
sittings themselves regardless of who takes which. A new setting,
`min_gap_between_moeds`, and a matching soft sort criterion (maximise the
gap) round it out the way every threshold since section 10 has been
mirrored by one.

## 66. A cap on exams of one program and year within a sliding window

Aggregate, not pairwise - today's "at most k exams on one day" (2.5) says
nothing about four exams spread one per day across four straight days,
which is exactly the gap this closes. It lives in the incremental pruner
(`PartialThresholdChecker`/its TypeScript mirror, section 10.2) rather than
the pairwise rule list, using the exact discipline every threshold there
already established: a running structure kept in lock step with the
search's own placement and backtracking (`apply`/`unapply`), checked only
at the moment a newly placed exam could possibly be the one that broke it,
since a count here only ever grows as the walk goes forward. Two settings,
required together (`max_exams_per_window`, `window_days`), and a matching
soft criterion, `worst_window_count` (minimise the worst window found).

## 67. Real per-student enrollment conflicts

No rule anywhere in this engine, before this section, has ever known an
individual student exists - only the (program, year) group requirement 1.2
already reads. A new, entirely optional input changes that: one row per
`StudentID,CourseNumber` fact - genuinely tabular per-fact data, unlike the
hand-typed Appendix A record files the rest of `data_io` reads, so Python's
own `csv` module is used directly here rather than the project's usual
hand-rolled record reader - builds an `EnrollmentRoster` mapping a course
number to the real students enrolled in it. A new pairwise rule,
`SharedStudentsSameDay`, forbids two exams from sharing a date the instant
the roster proves a real student sits both of them.

Because the decomposition already takes the *maximum* gap across every
registered rule (section 4.1), this correctly overrides the existing
elective/elective same-day exception of requirement 1.2 with no change to
that rule at all: a pair the aggregate model would otherwise wave through
gets forced apart the moment real evidence says otherwise. No roster
loaded, and nothing about existing behaviour changes on either engine -
verified directly, not merely assumed, by a test asserting the identical
pair is still allowed to collide when the roster argument is left out.

## 68. Time-of-day as a real, search-enforced constraint

Section 24.1 called hour-of-day "a layer on top of the search, not a
change to it," and that was true without exception until now - the search
has never had any concept of time of day at all, on either engine; a time
was only ever assigned to an already-chosen, date-only system, purely for
display. This section adds the opposite as an option: two exams on the
same date that need different times - their (program, year) groups
intersect, the same grouping the existing elective-collision heuristic
already reads, or a loaded roster proves they share a real student, the
same defence in depth section 67 already uses - may now only share that
date if a time slot is actually free for each of them.

A small greedy per-day graph colouring answers that (`TimeSlotAssigner` in
Python, `timeSlots.ts` on the web), and it is reused two genuinely
different ways rather than one: as a real feasibility gate inside the same
incremental pruner section 66 uses, during the search itself - a date that
cannot be coloured with the configured slots is rejected outright, a real
backtrack, not a display choice - and as a **stateless** finishing pass
for whichever system actually needs to be shown or exported, deliberately
never cached anywhere. The pruner is one mutable object that keeps
mutating past whatever candidate it just accepted as the search continues
walking, so nothing about its state at the moment a candidate was judged
reliably describes that candidate any more by the time a person is looking
at it - and a system a person has since hand-edited on the output screen
(section 14) has no such guarantee to begin with, so it has to be
recoloured fresh regardless of where the cache question even arises.

Designing the TypeScript side of this surfaced a genuine
backward-compatibility hazard, not merely a theoretical one:
`Settings.timeSlots` already shipped non-empty by default
(`["09:00", "13:00", "16:00"]`), to drive the cosmetic pass section 24
already gave every existing user. Gating the new hard constraint on
"`timeSlots` is non-empty" would have silently turned it on, and its
performance cost, for every user of this software the moment it shipped,
with no opt-in at all. The fix is a second, independent setting,
`enforceTimeSlots` (off by default): `timeSlots` keeps exactly its old
meaning, and this new flag alone decides whether it is enforced or merely
cosmetic. Python needed no equivalent second flag, since it never shipped
a non-empty default there to protect in the first place - the same feature
landing with two different shapes on its two engines, on purpose, because
the two engines were not starting from the same place.

None of this is free: the greedy colouring reruns on a date's accumulated
exams on every `apply` that touches that date, potentially many times over
one search rather than once per finished system. It is bounded by the same
examine-count and time-limit budgets every other threshold in section 10.2
already relies on, but the practical effect on a genuinely large input may
be "the search examines fewer systems in the same budget" rather than a
slowdown that shows up anywhere obvious - worth a real benchmark before
turning this on for a large faculty's worth of exams, not merely trusting
that the existing budgets will make it someone else's problem.

## 69. What was checked

* **Both suites, in full, after every feature** - not only at the end:
  430 Python tests (`python -m unittest discover -s tests`), including a
  new `test_time_slots.py` and `test_enrollment_parser.py`, and extended
  `test_constraints.py`, `test_settings_parser.py`, `test_scheduling.py`
  and `test_version3.py`; 662 TypeScript tests (`npx vitest run`) and a
  clean `npx tsc -b`, including a new `timeSlots.test.ts` and extended
  `partial.test.ts`, `quality.test.ts`, `decomposition.test.ts`,
  `edit.test.ts`, `csvImport.test.ts`, `model.test.ts` and
  `settings.test.ts` - both suites stayed fully green after each of the
  five factors, one at a time, not merely once everything was in place.
* **The pruner's incremental state directly, not only end to end** - both
  section 66's window counters and section 68's per-date colouring cache
  have a dedicated test that calls `apply` then `unapply` and asserts the
  internal structure is back to empty, the same direct coverage the
  aggregate thresholds of section 10.2 already had before this part.
* **A second backward-compatibility trap, unrelated to section 68's own,
  found while wiring the two new soft sort criteria in** - `SORT_CRITERIA`
  and `DEFAULT_SORT_CRITERIA` were the same array on both engines before
  this part; simply appending the new 3.6 and 3.7 criteria to that shared
  array would have silently added them to every run's default sort order,
  changing tie-breaking for a run that never asked for either. Both engines
  now keep an explicit, smaller default subset, independent of the full
  list `SORT_CRITERIA` still exposes for validation and the settings
  screen to offer as a choice.
* **The web app confirmed to still load cleanly** - reaches its sign-in
  screen with no new console errors - but the new input-screen and
  settings-screen controls themselves (the two new file loaders, the two
  new threshold cards, the `enforceTimeSlots` toggle) were not given a
  full visual pass in the browser in this pass, since that needs the
  Firestore emulator and the auth server of part XII running locally, not
  merely the static `web/` dev server this repository can run alone.

