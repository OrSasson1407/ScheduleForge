"""Decomposition of the scheduling problem into independent components.

Two exams restrict each other only when a rule asks them to be a number of days
apart. Exams that no rule relates are completely independent: every placement of
the one goes together with every placement of the other. The relation therefore
splits the exams into connected components, and the set of all exam systems is
the Cartesian product of the solution sets of the components:

    systems(all exams) = solutions(component 1) x ... x solutions(component m)

That single fact carries the whole engine:

* the number of exam systems is the product of the component counts, so it is
  known without enumerating anything;
* the search never backtracks across components, which removes the exponent
  that a search over all the exams at once would carry;
* a component is small (the exams of one study year of one program), so its
  solutions can be produced by a tight bitmask search.

Inside a component every exam is a bit mask over the dates of that component,
and every distance a rule asks for has a mask of its own: placing an exam on a
date removes, in one operation, the whole window of dates that are now too close
to it.

The dates an exam may take are also narrowed before the search: a date its
instructor is not available on is simply not in its mask (version 3.0). That is
a rule about one exam alone, so it costs the engine nothing.
"""


import random


def _popcount(value):
    return bin(value).count("1")


try:  # Python 3.10 and newer count the bits without building a string.
    _popcount = int.bit_count
except AttributeError:
    pass


#: How many search nodes counting a component may take before it gives up.
COUNT_NODE_BUDGET = 2000000


class Component(object):
    """One connected group of exams, together with its own date space.

    `positions` are the indexes of the exams inside the exam list of the whole
    problem. `masks[p]` holds the dates exam `p` may use as bits of the local
    date space `dates`, and `adjacent_before[p]` lists `(earlier exam, days)`
    pairs: the earlier members of the component that exam `p` has to keep that
    many days away from.

    `gap_masks[days][i]` is the set of dates that are less than `days` days away
    from `dates[i]` - what placing an exam on date `i` takes away from the exams
    that are `days` apart from it.
    """

    __slots__ = ("positions", "dates", "masks", "adjacent_before", "gap_masks",
                 "edge_count", "max_gap", "_count")

    def __init__(self, positions, dates, masks, adjacent_before, gap_masks,
                 edge_count, max_gap):
        self.positions = positions
        self.dates = dates
        self.masks = masks
        self.adjacent_before = adjacent_before
        self.gap_masks = gap_masks
        self.edge_count = edge_count
        self.max_gap = max_gap
        self._count = None

    @property
    def size(self):
        return len(self.positions)

    @property
    def is_clique(self):
        """True when every two exams of the component exclude each other."""
        size = self.size
        return self.edge_count == size * (size - 1) // 2

    @property
    def is_tree(self):
        """True when the component holds no cycle (it is always connected)."""
        return self.edge_count == self.size - 1

    def uniform_mask(self):
        """The shared mask when all the exams have the same dates, else None."""
        first = self.masks[0]
        for mask in self.masks:
            if mask != first:
                return None
        return first

    def count(self, budget=COUNT_NODE_BUDGET):
        """The exact number of solutions of this component, or None.

        None means that the shape of the component has no closed form and that
        counting it by search would cost more than `budget` steps.
        """
        if self._count is None:
            self._count = self._compute_count(budget)
        return self._count

    def _compute_count(self, budget):
        size = self.size
        shared = self.uniform_mask()
        # The closed forms below count placements that only have to differ; a
        # rule that asks for more than one day between two exams needs the
        # search, because the dates of a period are not consecutive days.
        if shared is not None and self.max_gap <= 1:
            free_dates = _popcount(shared)
            if self.is_clique:
                # Every exam takes a date of its own: a falling factorial.
                result = 1
                for taken in range(size):
                    result *= max(free_dates - taken, 0)
                return result
            if self.is_tree:
                # Root the tree anywhere: every other exam avoids its parent.
                if free_dates == 0:
                    return 0
                return free_dates * (free_dates - 1) ** (size - 1)
        return self._count_by_search(budget)

    def _count_by_search(self, budget):
        """Counts the solutions without listing them, one date set at a time."""
        size = self.size
        masks = self.masks
        adjacent = self.adjacent_before
        gap_masks = self.gap_masks
        if size == 1:
            return _popcount(masks[0])

        choice = [0] * size
        available = [0] * size
        available[0] = masks[0]
        last = size - 1
        total = 0
        nodes = 0
        depth = 0
        while depth >= 0:
            free = available[depth]
            if free == 0:
                depth -= 1
                continue
            nodes += 1
            if nodes > budget:
                return None
            lowest = free & -free
            available[depth] = free ^ lowest
            choice[depth] = lowest.bit_length() - 1

            following = depth + 1
            mask = masks[following]
            for earlier, gap in adjacent[following]:
                mask &= ~gap_masks[gap][choice[earlier]]
            if following == last:
                # The last exam adds one solution per date still free.
                total += _popcount(mask)
            else:
                available[following] = mask
                depth = following
        return total

    def iter_solutions(self):
        """Yield every solution of the component as a tuple of date indexes.

        The solutions come in the order of the dates, so the first exam system
        of the run is the one that places every exam as early as it can.
        """
        size = self.size
        masks = self.masks
        adjacent = self.adjacent_before
        gap_masks = self.gap_masks

        if size == 1:
            free = masks[0]
            while free:
                lowest = free & -free
                free ^= lowest
                yield (lowest.bit_length() - 1,)
            return

        choice = [0] * size
        available = [0] * size
        available[0] = masks[0]
        last = size - 1
        depth = 0
        while depth >= 0:
            free = available[depth]
            if free == 0:
                depth -= 1
                continue
            lowest = free & -free
            available[depth] = free ^ lowest
            choice[depth] = lowest.bit_length() - 1

            following = depth + 1
            mask = masks[following]
            for earlier, gap in adjacent[following]:
                mask &= ~gap_masks[gap][choice[earlier]]
            if following == last:
                while mask:
                    lowest_last = mask & -mask
                    mask ^= lowest_last
                    choice[last] = lowest_last.bit_length() - 1
                    yield tuple(choice)
            else:
                available[following] = mask
                depth = following


class ProblemDecomposition(object):
    """Splits the exams into independent components.

    The engine works on rules that ask two exams to be a number of days apart -
    they declare `PAIRWISE_DAY_DISTANCE` and answer `required_gap(first,
    second)`. That covers the rule of version 1.0 and the pairwise thresholds
    2.1 and 2.2 of version 3.0; a rule of another shape (hours of the day, a
    count over the whole system) has to extend the engine, and is rejected here
    instead of being quietly left out.

    `availability` is optional and states the dates an instructor cannot be
    present on; those dates are taken out of the exams of that instructor.

    `shuffle` reorders the components themselves and the dates inside each one,
    so that a search bounded by a budget - see `scheduling.generator` - samples
    a different cross-section of the space on every run instead of always
    starting from the same corner of it. It never changes which systems exist,
    only the order a search visits them in, so the exact count `total_systems`
    returns, and whether a walk that finishes on its own has truly seen every
    system, are unaffected either way.
    """

    def __init__(self, exams, periods, constraints, availability=None,
                 shuffle=False):
        self.exams = list(exams)
        self.periods = periods
        self.constraints = list(constraints)
        self.availability = availability
        self.shuffle = shuffle
        for constraint in self.constraints:
            if not getattr(constraint, "PAIRWISE_DAY_DISTANCE", False):
                raise TypeError(
                    "%s does not declare PAIRWISE_DAY_DISTANCE; the generator "
                    "only handles rules that ask two exams to be a number of "
                    "days apart" % type(constraint).__name__)
        self.dates_of_exam = [self._dates_of(exam) for exam in self.exams]
        self.components = self._build()

    def total_systems(self):
        """The exact number of exam systems, or None when a count is unknown.

        A component that no date assignment satisfies makes the whole product
        zero, and that answer is exact even when another component could not be
        counted, so it is looked for first.
        """
        total = 1
        unknown = False
        for component in self.components:
            count = component.count()
            if count == 0:
                return 0
            if count is None:
                unknown = True
            else:
                total *= count
        return None if unknown else total

    def exams_without_dates(self):
        """The exams that have no date left at all, for a readable message."""
        return [exam for exam, dates in zip(self.exams, self.dates_of_exam)
                if not dates]

    def _dates_of(self, exam):
        period = self.periods.get(exam.period_key)
        if period is None:
            return []
        dates = period.available_dates()
        if self.availability is not None:
            dates = self.availability.dates_for_exam(exam, dates)
        return dates

    def _build(self):
        gaps = self._conflict_graph()
        groups = self._connected_groups(gaps)
        if self.shuffle:
            random.shuffle(groups)
        return [self._make_component(positions, gaps) for positions in groups]

    def _conflict_graph(self):
        """For every exam, the exams it is related to and the days between them.

        Two exams are compared only when their periods actually overlap, so
        exams that could never fall on nearby dates are never related.
        """
        count = len(self.exams)
        dates_of_exam = self.dates_of_exam
        spans = [(dates[0], dates[-1]) if dates else None for dates in dates_of_exam]
        gaps = [{} for _ in range(count)]
        for first in range(count):
            if spans[first] is None:
                continue
            for second in range(first + 1, count):
                if spans[second] is None:
                    continue
                gap = self._required_gap(self.exams[first], self.exams[second])
                if gap <= 0:
                    continue
                # Dates further apart than the rule asks for can never break it.
                if (spans[first][0] - spans[second][1]).days >= gap:
                    continue
                if (spans[second][0] - spans[first][1]).days >= gap:
                    continue
                gaps[first][second] = gap
                gaps[second][first] = gap
        return gaps

    def _required_gap(self, first, second):
        return max((constraint.required_gap(first, second)
                    for constraint in self.constraints), default=0)

    def _connected_groups(self, gaps):
        """The connected components of the conflict graph, in exam order."""
        seen = set()
        groups = []
        for start in range(len(self.exams)):
            if start in seen:
                continue
            seen.add(start)
            group = [start]
            queue = [start]
            while queue:
                current = queue.pop()
                for neighbour in gaps[current]:
                    if neighbour not in seen:
                        seen.add(neighbour)
                        group.append(neighbour)
                        queue.append(neighbour)
            group.sort()
            groups.append(group)
        return groups

    def _make_component(self, positions, gaps):
        """Give the component its own, small, date space and its bit masks."""
        dates = sorted(set(date for position in positions
                           for date in self.dates_of_exam[position]))
        if self.shuffle:
            random.shuffle(dates)
        index_of_date = dict((date, index) for index, date in enumerate(dates))

        masks = []
        for position in positions:
            mask = 0
            for date in self.dates_of_exam[position]:
                mask |= 1 << index_of_date[date]
            masks.append(mask)

        place_of_exam = dict((exam, place)
                             for place, exam in enumerate(positions))
        adjacent_before = []
        edge_count = 0
        max_gap = 0
        for place, position in enumerate(positions):
            earlier = sorted(
                (place_of_exam[neighbour], gap)
                for neighbour, gap in gaps[position].items()
                if place_of_exam[neighbour] < place)
            adjacent_before.append(earlier)
            edge_count += len(earlier)
            for _, gap in earlier:
                max_gap = max(max_gap, gap)

        return Component(positions, dates, masks, adjacent_before,
                         self._gap_masks(dates, adjacent_before), edge_count,
                         max_gap)

    def _gap_masks(self, dates, adjacent_before):
        """Per distance a rule asks for, the dates every date takes away."""
        needed = set(gap for earlier in adjacent_before for _, gap in earlier)
        masks = {}
        for gap in needed:
            per_date = []
            for first in dates:
                mask = 0
                for index, second in enumerate(dates):
                    if abs((second - first).days) < gap:
                        mask |= 1 << index
                per_date.append(mask)
            masks[gap] = per_date
        return masks
