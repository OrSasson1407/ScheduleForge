"""The settings of a run (version 3.0, requirement sections 2 and 3).

The threshold requirements of section 2 disqualify an exam system: a system that
does not meet an active threshold is not produced at all. Every threshold is
off until the user turns it on and gives it its own `k`.

The criteria of section 3 sort the systems that passed the thresholds. The user
names several of them, and the order they are named in is the order of
preference: the first criterion decides, the second breaks its ties, and so on.
"""


class SettingsError(Exception):
    """A setting was given a value it cannot take."""


#: Requirement 3 - the criteria the exam systems can be sorted by. Every one of
#: them is shown in descending order of its value, as the requirement asks.
SORT_CRITERIA = (
    "min_days_between_obligatory",   # 3.1
    "average_days_between_exams",    # 3.2
    "elective_collisions",           # 3.3
    "obligatory_span",               # 3.4
    "max_exams_per_day",             # 3.5
)

SORT_CRITERIA_TITLES = {
    "min_days_between_obligatory":
        "3.1 maximise the gap between two obligatory exams of a year",
    "average_days_between_exams":
        "3.2 maximise the average gap between two exams of a year",
    "elective_collisions":
        "3.3 minimise collisions between two elective courses of a program",
    "obligatory_span":
        "3.4 maximise the span from the first to the last obligatory exam of a year",
    "max_exams_per_day":
        "3.5 minimise the largest number of exams on one day",
}

#: Which direction of a criterion counts as "better". +1 - a larger value is
#: better (a wider gap, a wider span). -1 - a smaller value is better (fewer
#: collisions, a lighter day). Used to rank exam systems genuinely best first,
#: not merely by "largest raw number first" for every criterion alike.
CRITERION_DIRECTION = {
    "min_days_between_obligatory": 1,
    "average_days_between_exams": 1,
    "elective_collisions": -1,
    "obligatory_span": 1,
    "max_exams_per_day": -1,
}

#: All five criteria, most protective first - the default when the settings do
#: not say otherwise, so that a plain run already looks for the best systems
#: instead of merely the first ones that happen to pass the thresholds.
DEFAULT_SORT_CRITERIA = SORT_CRITERIA


class SchedulingSettings(object):
    """Everything the user decides about a run, outside of the data itself."""

    __slots__ = ("min_days_between_obligatory", "min_days_between_any",
                 "max_elective_collisions", "min_obligatory_span",
                 "max_exams_per_day", "require_rooms", "sort_criteria",
                 "max_candidates", "max_examined", "time_limit_seconds",
                 "default_students")

    def __init__(self, min_days_between_obligatory=None, min_days_between_any=None,
                 max_elective_collisions=None, min_obligatory_span=None,
                 max_exams_per_day=None, require_rooms=False, sort_criteria=None,
                 max_candidates=1000, max_examined=200000,
                 time_limit_seconds=30.0, default_students=30):
        #: 2.1 - days between two obligatory exams of the same program and year.
        self.min_days_between_obligatory = min_days_between_obligatory
        #: 2.2 - days between two exams of the same program and year.
        self.min_days_between_any = min_days_between_any
        #: 2.3 - collisions between two elective courses, per program.
        self.max_elective_collisions = max_elective_collisions
        #: 2.4 - days from the first to the last obligatory exam of a year.
        self.min_obligatory_span = min_obligatory_span
        #: 2.5 - exams on one day.
        self.max_exams_per_day = max_exams_per_day
        #: Room allocation - a system that cannot be seated is disqualified.
        self.require_rooms = require_rooms
        #: None means "not stated" - the default is every criterion, best
        #: systems first; an explicit empty list keeps sorting off on purpose.
        self.sort_criteria = (list(DEFAULT_SORT_CRITERIA) if sort_criteria is None
                              else list(sort_criteria))
        self.max_candidates = max_candidates
        self.max_examined = max_examined
        self.time_limit_seconds = time_limit_seconds
        self.default_students = default_students
        self.validate()

    def validate(self):
        for name in ("min_days_between_obligatory", "min_days_between_any",
                     "min_obligatory_span", "max_exams_per_day"):
            value = getattr(self, name)
            if value is not None and (not isinstance(value, int) or value < 1):
                raise SettingsError("%s must be a positive whole number" % name)
        if self.max_elective_collisions is not None and (
                not isinstance(self.max_elective_collisions, int) or
                self.max_elective_collisions < 0):
            raise SettingsError(
                "max_elective_collisions must be a whole number, zero or more")
        for criterion in self.sort_criteria:
            if criterion not in SORT_CRITERIA:
                raise SettingsError(
                    "'%s' is not a sorting criterion (expected one of: %s)"
                    % (criterion, ", ".join(SORT_CRITERIA)))
        if len(set(self.sort_criteria)) != len(self.sort_criteria):
            raise SettingsError("a sorting criterion is named twice")
        if self.default_students < 1:
            raise SettingsError("default_students must be a positive number")

    @property
    def has_thresholds(self):
        return any((self.min_days_between_obligatory, self.min_days_between_any,
                    self.max_elective_collisions is not None,
                    self.min_obligatory_span, self.max_exams_per_day,
                    self.require_rooms))

    @property
    def pairwise_thresholds_only(self):
        """True when every active threshold is enforced inside the search.

        The exact number of exam systems is then still the number of systems
        the software can produce; an aggregate threshold makes it an upper
        bound, because it disqualifies systems after they were built.
        """
        return not any((self.max_elective_collisions is not None,
                        self.min_obligatory_span, self.max_exams_per_day,
                        self.require_rooms))

    def describe_thresholds(self):
        """Readable lines of the thresholds that are on, for the reports."""
        lines = []
        if self.min_days_between_obligatory:
            lines.append("2.1 at least %d days between two obligatory exams of "
                         "the same program and year"
                         % self.min_days_between_obligatory)
        if self.min_days_between_any:
            lines.append("2.2 at least %d days between two exams of the same "
                         "program and year" % self.min_days_between_any)
        if self.max_elective_collisions is not None:
            lines.append("2.3 at most %d collisions between two elective "
                         "courses of a program" % self.max_elective_collisions)
        if self.min_obligatory_span:
            lines.append("2.4 at least %d days from the first to the last "
                         "obligatory exam of a year" % self.min_obligatory_span)
        if self.max_exams_per_day:
            lines.append("2.5 at most %d exams on one day" % self.max_exams_per_day)
        if self.require_rooms:
            lines.append("every exam has to be seated in the rooms of the campus")
        return lines

    def describe_sorting(self):
        return [SORT_CRITERIA_TITLES[name] for name in self.sort_criteria]
