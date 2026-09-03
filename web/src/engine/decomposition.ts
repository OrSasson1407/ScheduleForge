/**
 * The engine, carried over from the Python version of the software.
 *
 * Every rule that relates two exams - the rule of version 1.0, the pairwise
 * thresholds 2.1 and 2.2 of version 3.0, and the instructor rule below - says
 * the same kind of thing: these two exams have to be at least g days apart.
 * g = 1 is "not on the same date". `requiredGap` answers with 0 when two
 * exams do not restrict each other.
 *
 * The instructor rule: the same instructor cannot give two exams at once, so
 * any two exams whose `course.instructor` is the same string never share a
 * date - unconditionally, the same way the rule of version 1.0 is, not a
 * threshold the user turns on. It is checked here rather than only narrowing
 * an instructor's *own* available dates (`isInstructorAvailable`, used when
 * building `datesOfExam` below) because that only keeps one exam off a date
 * the instructor is never free on; it says nothing about two of that
 * instructor's own exams landing on the same date as each other.
 *
 * Exams that no rule relates are independent, so the exams split into connected
 * components and
 *
 *     exam systems = solutions(component 1) x ... x solutions(component m)
 *
 * The number of exam systems is therefore the product of the component counts
 * and is known without enumerating anything.
 *
 * The dates an exam may take are narrowed before the search: a date its
 * instructor is not available on is simply not among them (version 3.0). That
 * is a rule about one exam alone, so it costs the engine nothing.
 */

import {
  EnrollmentRoster,
  Exam,
  ExamPeriod,
  FacultyRules,
  availableDates,
  fromIso,
  isInstructorAvailable,
  periodKey,
  sharesStudents,
} from "./model";
import { Settings } from "./settings";

/** 0 when the two exams do not restrict each other, else the days between them. */
export function requiredGap(
  first: Exam,
  second: Exam,
  settings?: Settings,
  roster?: EnrollmentRoster
): number {
  let gap = 0;

  if (first.course.instructor === second.course.instructor) {
    gap = Math.max(gap, 1);
  }

  // 2.6 - moed Aleph and moed Bet of the same course, unlike 2.1/2.2 below,
  // which deliberately skip this pair (a student only sits one of the two).
  if (
    settings?.minGapBetweenMoeds &&
    first.course.number === second.course.number &&
    first.semester === second.semester &&
    first.moed !== second.moed
  ) {
    gap = Math.max(gap, settings.minGapBetweenMoeds);
  }

  // Item 1 - unconditional, like the instructor rule above: real evidence a
  // student sits both exams is not a preference to weigh, it is a scheduling
  // impossibility. This is the *max* of every rule's answer, so it correctly
  // forces apart a pair the 1.2 elective/elective exception below would
  // otherwise allow same-day, the moment a roster proves they share a
  // student - with no change needed to that exception at all.
  if (roster && sharesStudents(roster, first.course.number, second.course.number)) {
    gap = Math.max(gap, 1);
  }

  const samePeriod =
    first.semester === second.semester && first.moed === second.moed;
  for (const slot of first.slots) {
    const other = second.slots.find((candidate) => candidate.key === slot.key);
    if (!other) continue;

    // Requirement 1.2 of version 1.0, in every exam period.
    if (!(slot.requirement === "Elective" && other.requirement === "Elective")) {
      gap = Math.max(gap, 1);
    }
    if (!samePeriod || !settings) continue;
    // 2.1 and 2.2 hold inside one exam period: moed Aleph and moed Bet are two
    // sittings of the same exam, and a student takes one of them.
    if (
      settings.minDaysBetweenObligatory &&
      slot.requirement === "Obligatory" &&
      other.requirement === "Obligatory"
    ) {
      gap = Math.max(gap, settings.minDaysBetweenObligatory);
    }
    if (settings.minDaysBetweenAny) {
      gap = Math.max(gap, settings.minDaysBetweenAny);
    }
  }
  return gap;
}

/** One connected group of exams, with its own small space of dates. */
export interface Component {
  /** Indexes of the member exams inside the whole exam list. */
  positions: number[];
  /** The dates the members may use. */
  dates: string[];
  /** Per member, the indexes into `dates` it may take. */
  allowed: number[][];
  /** Per member, `[earlier member, days between them]`. */
  adjacentBefore: [number, number][][];
  /** `dayGap[i][j]` - how many days there are between two of `dates`. */
  dayGap: number[][];
  edgeCount: number;
  maxGap: number;
  /** The exact number of solutions, or null when it could not be counted. */
  count: bigint | null;
}

export interface Decomposition {
  components: Component[];
  /** The exact number of exam systems, or null when a count is unknown. */
  total: bigint | null;
  /** Per exam, the dates it may take. */
  datesOfExam: string[][];
  /** Per exam, the component it belongs to. */
  depthOfPosition: number[];
}

/** How many search steps counting one component may take before it gives up. */
const COUNT_NODE_BUDGET = 2_000_000;

/** Fisher-Yates, in place. */
function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function decompose(
  exams: Exam[],
  periods: ExamPeriod[],
  settings?: Settings,
  faculty?: FacultyRules,
  /**
   * Reorders the components and the dates inside each one, so a search
   * bounded by a budget (see `generator.ts`) samples a different slice of the
   * space on every run instead of always the same corner of it. It never
   * changes which systems exist, only the order a search visits them in.
   */
  randomize = false,
  roster?: EnrollmentRoster
): Decomposition {
  const byKey = new Map(periods.map((p) => [periodKey(p.semester, p.moed), p]));
  const datesOfExam = exams.map((exam) => {
    const period = byKey.get(periodKey(exam.semester, exam.moed));
    if (!period) return [];
    const dates = availableDates(period);
    if (!faculty) return dates;
    return dates.filter((iso) => isInstructorAvailable(faculty, exam.course.instructor, iso));
  });

  const gaps: Map<number, number>[] = exams.map(() => new Map<number, number>());
  for (let first = 0; first < exams.length; first += 1) {
    if (!datesOfExam[first].length) continue;
    for (let second = first + 1; second < exams.length; second += 1) {
      if (!datesOfExam[second].length) continue;
      const gap = requiredGap(exams[first], exams[second], settings, roster);
      if (gap <= 0) continue;
      // Dates further apart than the rule asks for can never break it.
      const firstSpan = datesOfExam[first];
      const secondSpan = datesOfExam[second];
      if (daysBetween(secondSpan[secondSpan.length - 1], firstSpan[0]) >= gap) continue;
      if (daysBetween(firstSpan[firstSpan.length - 1], secondSpan[0]) >= gap) continue;
      gaps[first].set(second, gap);
      gaps[second].set(first, gap);
    }
  }

  const groups = connectedGroups(exams.length, gaps);
  if (randomize) shuffle(groups);

  const depthOfPosition = new Array<number>(exams.length).fill(0);
  const components = groups.map((positions, depth) => {
    for (const position of positions) depthOfPosition[position] = depth;
    return makeComponent(positions, datesOfExam, gaps, randomize);
  });

  let total: bigint | null = 1n;
  for (const component of components) {
    if (component.count === 0n) {
      total = 0n;
      break;
    }
    if (component.count === null) total = null;
    else if (total !== null) total *= component.count;
  }
  return { components, total, datesOfExam, depthOfPosition };
}

function daysBetween(from: string, to: string): number {
  return Math.round((fromIso(to).getTime() - fromIso(from).getTime()) / 86400000);
}

function connectedGroups(size: number, gaps: Map<number, number>[]): number[][] {
  const seen = new Set<number>();
  const groups: number[][] = [];
  for (let start = 0; start < size; start += 1) {
    if (seen.has(start)) continue;
    seen.add(start);
    const group = [start];
    const queue = [start];
    while (queue.length) {
      const current = queue.pop()!;
      for (const neighbour of gaps[current].keys()) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        group.push(neighbour);
        queue.push(neighbour);
      }
    }
    group.sort((a, b) => a - b);
    groups.push(group);
  }
  return groups;
}

function makeComponent(
  positions: number[],
  datesOfExam: string[][],
  gaps: Map<number, number>[],
  randomize = false
): Component {
  const dates = [...new Set(positions.flatMap((position) => datesOfExam[position]))].sort();
  if (randomize) shuffle(dates);
  const indexOfDate = new Map(dates.map((date, index) => [date, index]));
  const allowed = positions.map((position) =>
    datesOfExam[position].map((date) => indexOfDate.get(date)!)
  );

  const dayGap = dates.map((first) => dates.map((second) => Math.abs(daysBetween(first, second))));

  const placeOf = new Map(positions.map((position, place) => [position, place]));
  let edgeCount = 0;
  let maxGap = 0;
  const adjacentBefore = positions.map((position, place) => {
    const earlier: [number, number][] = [];
    for (const [neighbour, gap] of gaps[position]) {
      const other = placeOf.get(neighbour)!;
      if (other < place) {
        earlier.push([other, gap]);
        maxGap = Math.max(maxGap, gap);
      }
    }
    earlier.sort((a, b) => a[0] - b[0]);
    edgeCount += earlier.length;
    return earlier;
  });

  const component: Component = {
    positions,
    dates,
    allowed,
    adjacentBefore,
    dayGap,
    edgeCount,
    maxGap,
    count: null,
  };
  component.count = countSolutions(component);
  return component;
}

function isUniform(component: Component): boolean {
  const first = component.allowed[0];
  return component.allowed.every(
    (dates) => dates.length === first.length && dates.every((date, index) => date === first[index])
  );
}

function countSolutions(component: Component): bigint | null {
  const size = component.positions.length;
  // The closed forms count placements that only have to differ; a rule that
  // asks for more than one day needs the search, because the dates of a period
  // are not consecutive days.
  if (component.maxGap <= 1 && isUniform(component)) {
    const free = BigInt(component.allowed[0].length);
    if (component.edgeCount === (size * (size - 1)) / 2) {
      let result = 1n;
      for (let taken = 0n; taken < BigInt(size); taken += 1n) {
        result *= free > taken ? free - taken : 0n;
      }
      return result;
    }
    if (component.edgeCount === size - 1) {
      if (free === 0n) return 0n;
      return free * (free - 1n) ** BigInt(size - 1);
    }
  }
  return countBySearch(component);
}

/** Is this date far enough from every earlier exam that constrains it? */
function isFree(component: Component, chosen: number[], depth: number, date: number): boolean {
  for (const [earlier, gap] of component.adjacentBefore[depth]) {
    if (component.dayGap[date][chosen[earlier]] < gap) return false;
  }
  return true;
}

function countBySearch(component: Component): bigint | null {
  const size = component.positions.length;
  if (size === 1) return BigInt(component.allowed[0].length);

  const last = size - 1;
  const chosen = new Array<number>(size).fill(-1);
  let total = 0n;
  let nodes = 0;

  const search = (depth: number): boolean => {
    for (const date of component.allowed[depth]) {
      if (!isFree(component, chosen, depth, date)) continue;
      nodes += 1;
      if (nodes > COUNT_NODE_BUDGET) return false;
      chosen[depth] = date;
      if (depth === last - 1) {
        // The last exam adds one solution per date that is still free, so its
        // dates are counted instead of being walked one by one.
        let free = 0;
        for (const candidate of component.allowed[last]) {
          if (isFree(component, chosen, last, candidate)) free += 1;
        }
        total += BigInt(free);
      } else if (!search(depth + 1)) {
        return false;
      }
      chosen[depth] = -1;
    }
    return true;
  };

  return search(0) ? total : null;
}

/** Yields every solution of a component, as indexes into `component.dates`. */
export function* iterSolutions(component: Component): Generator<number[]> {
  const size = component.positions.length;
  const chosen = new Array<number>(size).fill(-1);

  function* place(depth: number): Generator<number[]> {
    for (const date of component.allowed[depth]) {
      if (!isFree(component, chosen, depth, date)) continue;
      chosen[depth] = date;
      if (depth === size - 1) yield chosen.slice();
      else yield* place(depth + 1);
      chosen[depth] = -1;
    }
  }

  yield* place(0);
}
