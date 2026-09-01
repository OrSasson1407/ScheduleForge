"""Finding the exam systems the user asked for (version 3.0, sections 2 and 3).

The run has three steps, and they are deliberately separate:

1. the generator produces exam systems. The thresholds that relate two exams -
   2.1 and 2.2 - are already inside it, so a system that breaks them is never
   built;
2. every system produced is measured, and the thresholds that count over a whole
   system - 2.3, 2.4, 2.5 and the room allocation - throw it away or keep it. A
   system that is kept is weighed against the worst of the best `max_candidates`
   found so far (a bounded heap) whenever at least one sorting criterion is on -
   so the search never stops merely because it filled its quota, only because
   it ran out of systems, reached `max_examined`, or ran out of time. What ends
   up kept is therefore the best `max_candidates` systems out of everything the
   search looked at, not the first ones that happened to pass;
3. what was kept is sorted by the criteria of section 3.

When no criterion is on, "best" has nothing to mean, and the search falls back
to keeping the first `max_candidates` systems that pass the thresholds.

Steps 1 and 2 are bounded: the user says how many systems to keep, how many to
look at, and how long the search may take. Step 3 is cheap and is done again
whenever the user changes the order of the criteria, which is exactly what the
requirement expects - the sorting may change during a run, the thresholds may
not.
"""

import heapq
import time


class Candidate(object):
    """One exam system that passed the thresholds, with what is known about it."""

    __slots__ = ("system", "metrics", "allocation")

    def __init__(self, system, metrics, allocation=None):
        self.system = system
        self.metrics = metrics
        self.allocation = allocation


class SearchReport(object):
    """What the search did, for the report the user reads."""

    COMPLETE = "complete"
    ENOUGH = "enough candidates"
    EXAMINED_LIMIT = "examined limit"
    TIMED_OUT = "timed out"

    __slots__ = ("examined", "accepted", "status", "seconds", "total_systems")

    def __init__(self):
        self.examined = 0
        self.accepted = 0
        self.status = self.COMPLETE
        self.seconds = 0.0
        self.total_systems = None

    @property
    def total_text(self):
        if self.total_systems is None:
            return "an unknown number of"
        return "{:,}".format(self.total_systems)

    def describe(self, kept=None):
        if self.status == self.COMPLETE:
            head = ("every one of the %s possible exam systems was examined"
                    % self.total_text)
        elif self.status == self.ENOUGH:
            head = ("%d exam systems were examined out of %s, which was enough "
                    "to fill the list" % (self.examined, self.total_text))
        elif self.status == self.EXAMINED_LIMIT:
            head = ("the first %d of %s possible exam systems were examined"
                    % (self.examined, self.total_text))
        else:
            head = ("%d of %s possible exam systems were examined before the "
                    "time limit of the run was reached"
                    % (self.examined, self.total_text))
        if kept is not None and kept < self.accepted:
            tail = ("%d of them passed the threshold requirements; the best "
                    "%d were kept" % (self.accepted, kept))
        else:
            tail = "%d of them passed the threshold requirements" % self.accepted
        return "%s; %s (%.2f seconds)" % (head, tail, self.seconds)


class CandidateSearch(object):
    """Produces, filters and sorts the exam systems of one run."""

    _TIME_CHECK_INTERVAL = 256

    def __init__(self, generator, evaluator, settings, room_allocator=None):
        self.generator = generator
        self.evaluator = evaluator
        self.settings = settings
        self.room_allocator = room_allocator
        self.report = SearchReport()
        self.candidates = []

    def run(self):
        """Fill `candidates` with the systems that passed, sorted, and report."""
        started = time.time()
        settings = self.settings
        report = SearchReport()
        report.total_systems = self.generator.total_systems()
        self.report = report

        deadline = (started + settings.time_limit_seconds
                    if settings.time_limit_seconds else None)
        ranked = bool(settings.sort_criteria)
        heap = []          # used when ranked: (worst-first key, counter, candidate)
        first_found = []   # used when not ranked: the first ones found, in order
        counter = 0
        seen = set()
        examined = 0
        accepted = 0
        status = SearchReport.COMPLETE

        for system in self.generator.generate():
            examined += 1
            candidate = self._judge(system)
            if candidate is not None:
                # A spread out walk may reach one system by two ways, and the
                # user must never be shown the same system twice.
                key = tuple(scheduled.date for scheduled in system.scheduled_exams)
                if key in seen:
                    continue
                seen.add(key)
                accepted += 1
                if ranked:
                    counter = self._offer(heap, candidate, settings.max_candidates,
                                          counter)
                else:
                    first_found.append(candidate)
                    if (settings.max_candidates and
                            len(first_found) >= settings.max_candidates):
                        status = SearchReport.ENOUGH
                        break
            if settings.max_examined and examined >= settings.max_examined:
                status = SearchReport.EXAMINED_LIMIT
                break
            if deadline is not None and not examined % self._TIME_CHECK_INTERVAL:
                if time.time() >= deadline:
                    status = SearchReport.TIMED_OUT
                    break

        candidates = [entry[2] for entry in heap] if ranked else first_found
        report.examined = examined
        report.accepted = accepted
        report.status = status
        self.candidates = candidates
        self.sort_by(settings.sort_criteria)
        report.seconds = time.time() - started
        return self.candidates

    def _offer(self, heap, candidate, limit, counter):
        """Keep `candidate` among the best `limit` seen so far.

        `heap` is a bounded min-heap: its root is always the worst of the
        candidates currently kept. Every criterion's `sort_key` is ascending is
        best, so negating it turns "smallest kept key" (the heap's natural
        root) into "worst kept candidate" - the one a better newcomer replaces.
        `counter` breaks a tie between two candidates whose key is identical,
        so two `Candidate` objects - which do not know how to compare to one
        another - are never asked to.
        """
        if not limit:
            return counter
        key = tuple(-value for value in self.evaluator.sort_key(candidate.metrics))
        if len(heap) < limit:
            heapq.heappush(heap, (key, counter, candidate))
        elif key > heap[0][0]:
            heapq.heapreplace(heap, (key, counter, candidate))
        return counter + 1

    def sort_by(self, criteria):
        """Order the candidates again, by the criteria of section 3.

        Costs a sort of the list that was already found, so the user may change
        the order of the criteria as often as they like.
        """
        self.settings.sort_criteria = list(criteria)
        self.settings.validate()
        if criteria:
            evaluator = self.evaluator
            self.candidates.sort(key=lambda item: evaluator.sort_key(item.metrics))
        return self.candidates

    def _judge(self, system):
        """Measure a system and return a `Candidate`, or None when it fails."""
        metrics = self.evaluator.measure(system)
        if not self.evaluator.passes(metrics):
            return None
        allocation = None
        if self.room_allocator is not None:
            allocation = self.room_allocator.allocate(system)
            if self.settings.require_rooms and not allocation.is_complete:
                return None
        return Candidate(system, metrics, allocation)
