"""The scheduling rules that relate two exams to each other.

Every rule of version 1.0, of section 2 of version 3.0, and the instructor
rule below, that relates a pair of exams says the same kind of thing: these
two exams have to be at least `g` days apart. `g = 1` is the rule of version
1.0 (not on the same date) and the instructor rule (the same instructor
cannot give two exams at once) - both unconditional - and a larger `g` is a
threshold requirement the user turned on.

`required_gap(first, second)` is therefore the whole pairwise interface: it
returns 0 when the two exams do not restrict each other at all, and otherwise
the number of days that has to separate them. The generator asks every rule and
keeps the largest answer, so the rules simply add up.
"""

from ..model.enums import Requirement


class Constraint(object):
    """Interface of a scheduling rule about a pair of exams.

    A rule whose whole content is "these two exams have to be `g` days apart"
    sets `PAIRWISE_DAY_DISTANCE` to True. The generator builds its decomposition
    on that promise and refuses a rule that does not make it, instead of
    silently leaving the rule out of the search.
    """

    #: Is the whole rule a distance in days between two exams?
    PAIRWISE_DAY_DISTANCE = False

    def required_gap(self, first, second):
        """0 when unrelated, else the least number of days between the two."""
        raise NotImplementedError

    def conflicts(self, first, second):
        """May these two exams never share a date?"""
        return self.required_gap(first, second) >= 1

    def allows(self, exam, date, exams_on_date):
        """May `exam` be placed on `date`, next to the exams already there?

        The rule of version 1.0 seen from a partial exam system. It answers for
        one date, so it covers the `g = 1` part of a rule; the generator uses
        `required_gap` and covers all of it.
        """
        for placed in exams_on_date:
            if self.conflicts(exam, placed):
                return False
        return True

    def describe(self):
        raise NotImplementedError


def _shared_slots(first, second):
    """The (program, year) pairs both exams belong to, with both requirements."""
    first_slots = first.slots
    second_slots = second.slots
    if len(second_slots) < len(first_slots):
        first_slots, second_slots = second_slots, first_slots
    for slot, requirement in first_slots.items():
        other = second_slots.get(slot)
        if other is not None:
            yield slot, requirement, other


class NoTwoExamsSameDayInYearAndProgram(Constraint):
    """Requirement 1.2 - the critical conflict of version 1.0.

    Two exams may not share a date when both are taught in the same study
    program and in the same study year, unless both of them are elective there.
    Conflicts are checked by date alone, hours are not part of the software.
    """

    PAIRWISE_DAY_DISTANCE = True
    SAME_DATE_ONLY = True

    def required_gap(self, first, second):
        for _, requirement, other in _shared_slots(first, second):
            both_elective = (requirement is Requirement.ELECTIVE and
                             other is Requirement.ELECTIVE)
            if not both_elective:
                return 1
        return 0

    def describe(self):
        return ("no two exams of the same study year and study program on the "
                "same date, unless both courses are elective")


class NoInstructorTwoExamsSameDay(Constraint):
    """The same instructor cannot give two exams at once.

    Unconditional, like `NoTwoExamsSameDayInYearAndProgram` above: not a
    threshold requirement the user turns on, because an instructor being
    asked to administer two exams on the same date is not a preference to
    weigh against others, it is a scheduling impossibility - the same way two
    exams of one student's own program and year cannot share a date either.
    """

    PAIRWISE_DAY_DISTANCE = True

    def required_gap(self, first, second):
        if first.course.instructor == second.course.instructor:
            return 1
        return 0

    def describe(self):
        return "no instructor gives two exams on the same date"


class MinimumDaysBetweenObligatoryExams(Constraint):
    """Requirement 2.1 of version 3.0.

    At least `days` days between two exams of obligatory courses of the same
    study program and the same study year. The count is in calendar days and
    includes Saturdays and holidays, as the requirement says.

    The rule holds inside one exam period: moed Aleph and moed Bet are two
    sittings of the same exam, and a student takes one of them, so the days
    between an exam of one moed and an exam of the other say nothing.
    """

    PAIRWISE_DAY_DISTANCE = True

    def __init__(self, days):
        self.days = days

    def required_gap(self, first, second):
        if first.period_key != second.period_key:
            return 0
        for _, requirement, other in _shared_slots(first, second):
            if (requirement is Requirement.OBLIGATORY and
                    other is Requirement.OBLIGATORY):
                return self.days
        return 0

    def describe(self):
        return ("at least %d days between two exams of obligatory courses of "
                "the same study year and study program" % self.days)


class MinimumDaysBetweenExams(Constraint):
    """Requirement 2.2 of version 3.0.

    At least `days` days between two exams of the same study program and the
    same study year, whether the courses are obligatory or elective. Like 2.1,
    the rule holds inside one exam period.
    """

    PAIRWISE_DAY_DISTANCE = True

    def __init__(self, days):
        self.days = days

    def required_gap(self, first, second):
        if first.period_key != second.period_key:
            return 0
        for _ in _shared_slots(first, second):
            return self.days
        return 0

    def describe(self):
        return ("at least %d days between two exams of the same study year and "
                "study program" % self.days)


class MinimumGapBetweenMoeds(Constraint):
    """At least `days` days between moed Aleph and moed Bet of the same course.

    The gap rules above deliberately skip this pair (`period_key` differs), on
    the grounds that a student only sits one moed. This rule is the opposite
    case: the instructor grading moed Aleph, or the department preparing the
    room and paperwork for moed Bet, needs a real gap between the two
    sittings themselves, regardless of which students take which.
    """

    PAIRWISE_DAY_DISTANCE = True

    def __init__(self, days):
        self.days = days

    def required_gap(self, first, second):
        if first.course.number != second.course.number:
            return 0
        if first.semester != second.semester:
            return 0
        if first.moed == second.moed:
            return 0
        return self.days

    def describe(self):
        return ("at least %d days between moed Aleph and moed Bet of the same "
                "course" % self.days)


class SharedStudentsSameDay(Constraint):
    """No two exams that a real, enrolled student takes both of may share a date.

    Unconditional, like `NoTwoExamsSameDayInYearAndProgram`: real evidence that
    a student sits both exams is not a preference to weigh, it is a scheduling
    impossibility, the same as it is for that rule's own (program, year)
    aggregate. Registered only when a roster was actually loaded (an optional
    input) - `ProblemDecomposition._required_gap` already takes the *max* gap
    across every registered rule, so this correctly forces apart a pair the
    (program, year) rule's elective/elective exception would otherwise allow
    same-day, the moment real evidence proves they share a student, with no
    change needed to that rule at all.
    """

    PAIRWISE_DAY_DISTANCE = True

    def __init__(self, roster):
        self.roster = roster

    def required_gap(self, first, second):
        if self.roster.shares_students(first.course.number, second.course.number):
            return 1
        return 0

    def describe(self):
        return "no two exams that share a real, enrolled student on the same date"


def constraints_for(settings=None, roster=None):
    """The rules of a run: the rule of version 1.0, plus the thresholds that are on."""
    rules = [NoTwoExamsSameDayInYearAndProgram(), NoInstructorTwoExamsSameDay()]
    if settings is not None:
        if settings.min_days_between_obligatory:
            rules.append(MinimumDaysBetweenObligatoryExams(
                settings.min_days_between_obligatory))
        if settings.min_days_between_any:
            rules.append(MinimumDaysBetweenExams(settings.min_days_between_any))
        if settings.min_gap_between_moeds:
            rules.append(MinimumGapBetweenMoeds(settings.min_gap_between_moeds))
    if roster is not None:
        rules.append(SharedStudentsSameDay(roster))
    return rules
