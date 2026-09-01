"""Generation of the conflict free exam systems (requirement 1.2).

The generator does not search over all the exams at once. It first splits them
into independent components (see `decomposition`), and then walks the Cartesian
product of the component solutions like an odometer: the last component turns on
every step, the one before it only when the last one has gone round.

Two properties follow from that, and they are the whole point of the engine:

* the exact number of exam systems is the product of the component counts. It
  is known before a single system is built, so the software can state how large
  the set of possibilities really is instead of guessing;
* producing one more exam system costs one step of the last component plus the
  copy of the placement - it does not cost a walk over all the exams.

The number of exam systems still grows exponentially with the number of exams
(D free dates and N exams allow up to D**N systems), so the systems are produced
lazily and the caller states how many it wants and how long it may take;
requirement 5.1 gives the default budget.
"""

import time

from ..model.exam import ExamSystem, ScheduledExam
from .constraints import NoTwoExamsSameDayInYearAndProgram
from .decomposition import ProblemDecomposition


class GenerationReport(object):
    """What the generator did: how many systems, out of how many, and why it stopped."""

    COMPLETE = "complete"
    REACHED_LIMIT = "reached limit"
    TIMED_OUT = "timed out"

    __slots__ = ("produced", "status", "seconds", "total")

    def __init__(self, total=None):
        self.produced = 0
        self.status = self.COMPLETE
        self.seconds = 0.0
        self.total = total

    @property
    def is_complete(self):
        return self.status == self.COMPLETE

    @property
    def total_text(self):
        if self.total is None:
            return "an unknown number of"
        return "{:,}".format(self.total)

    def describe(self):
        if self.status == self.COMPLETE:
            return ("all %d possible exam systems were generated (%.2f seconds)"
                    % (self.produced, self.seconds))
        if self.status == self.REACHED_LIMIT:
            return ("the first %d of %s possible exam systems were generated "
                    "(%.2f seconds)"
                    % (self.produced, self.total_text, self.seconds))
        return ("%d of %s possible exam systems were generated before the time "
                "limit of the run was reached (%.2f seconds)"
                % (self.produced, self.total_text, self.seconds))


class ExamSystemGenerator(object):
    """Produces the conflict free exam systems of a list of exams."""

    #: How many systems are produced between two readings of the clock.
    _TIME_CHECK_INTERVAL = 512

    def __init__(self, exams, periods, constraints=None, availability=None,
                 pruner=None, diversify=False):
        self.exams = list(exams)
        self.periods = periods
        self.constraints = (list(constraints) if constraints is not None
                            else [NoTwoExamsSameDayInYearAndProgram()])
        self.availability = availability
        # When the user asks for the best exam systems, the components and
        # their dates are shuffled, so a search bounded by a budget samples a
        # different slice of the space on every run instead of always the
        # same corner of it (see `ProblemDecomposition`). Plain listing
        # (versions 1.0 and 2.0) leaves it off, which is also what keeps the
        # guarantee that the very first system places every exam as early as
        # it can.
        self.decomposition = ProblemDecomposition(self.exams, self.periods,
                                                  self.constraints, availability,
                                                  shuffle=diversify)
        #: Optional: throws a half built system away as soon as a count over the
        #: whole system is broken (version 3.0, see `scheduling.partial`).
        self.pruner = pruner
        self.report = GenerationReport(self.total_systems())
        self._scheduled = {}

    def total_systems(self):
        """The exact number of possible exam systems, or None when unknown.

        Costs no search: it is the product of the counts of the components.
        """
        return self.decomposition.total_systems()

    def components(self):
        return self.decomposition.components

    def candidate_dates(self, exam):
        """The dates that exam may take, earliest one first.

        The dates of its exam period, without the ones its instructor is not
        available on.
        """
        return self.decomposition.dates_of_exam[self.exams.index(exam)]

    def generate(self, max_systems=None, time_limit_seconds=None):
        """Yield `ExamSystem` objects until they run out, or a budget is spent.

        `max_systems` limits how many systems are produced, `time_limit_seconds`
        how long the generation may run. Both may be None, meaning no limit.
        """
        started = time.time()
        report = GenerationReport(self.total_systems())
        self.report = report
        deadline = (started + time_limit_seconds
                    if time_limit_seconds is not None else None)

        try:
            for system in self._walk(report, max_systems, deadline):
                yield system
        finally:
            report.seconds = time.time() - started

    def depth_of_position(self):
        """Which component every exam belongs to, by its index in the exam list."""
        depths = [0] * len(self.exams)
        for depth, component in enumerate(self.decomposition.components):
            for position in component.positions:
                depths[position] = depth
        return depths

    def _walk(self, report, max_systems, deadline):
        components = self.decomposition.components
        depth_count = len(components)
        if not self.exams or depth_count == 0:
            return
        if self.total_systems() == 0:
            # One component alone has no solution, so no exam system exists.
            # Finding that out here costs nothing; a search over all the exams
            # would rediscover it once for every placement of the other exams.
            return

        pruner = self.pruner
        if pruner is not None:
            pruner.reset()
        placement = [None] * len(self.exams)
        scheduled_of = self._scheduled_exam
        iterators = [None] * depth_count
        iterators[0] = components[0].iter_solutions()
        last = depth_count - 1
        produced = 0
        examined = 0
        depth = 0
        applied_to = -1

        while depth >= 0:
            solution = next(iterators[depth], None)
            if solution is None:
                depth -= 1
                continue

            if pruner is not None:
                while applied_to >= depth:
                    pruner.unapply(applied_to)
                    applied_to -= 1

            component = components[depth]
            positions = component.positions
            dates = component.dates
            pairs = [(positions[place], dates[solution[place]])
                     for place in range(len(positions))]
            for position, date in pairs:
                placement[position] = scheduled_of(position, date)

            if pruner is not None:
                examined += 1
                if not pruner.apply(depth, pairs):
                    # Every system below this placement breaks the same count.
                    pruner.unapply(depth)
                    if deadline is not None and not examined % self._TIME_CHECK_INTERVAL:
                        if time.time() >= deadline:
                            report.status = GenerationReport.TIMED_OUT
                            return
                    continue
                applied_to = depth

            if depth != last:
                depth += 1
                iterators[depth] = components[depth].iter_solutions()
                continue

            produced += 1
            report.produced = produced
            yield ExamSystem(list(placement))

            if max_systems is not None and produced >= max_systems:
                report.status = GenerationReport.REACHED_LIMIT
                return
            if deadline is not None and not produced % self._TIME_CHECK_INTERVAL:
                if time.time() >= deadline:
                    report.status = GenerationReport.TIMED_OUT
                    return

    def _scheduled_exam(self, position, date):
        """A `ScheduledExam` per exam and date, built once and then reused.

        `ScheduledExam` is a value that is never changed, so the same object can
        appear in many exam systems. It keeps the cost of one more system at the
        copy of the placement list.
        """
        key = (position, date)
        scheduled = self._scheduled.get(key)
        if scheduled is None:
            scheduled = ScheduledExam(self.exams[position], date)
            self._scheduled[key] = scheduled
        return scheduled
