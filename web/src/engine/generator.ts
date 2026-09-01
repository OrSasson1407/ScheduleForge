/**
 * Finding the exam systems the user asked for (version 3.0, sections 2 and 3).
 *
 * The run has three steps, and they are deliberately separate:
 *
 * 1. the walk produces exam systems. The thresholds that relate two exams -
 *    2.1 and 2.2 - are already inside the decomposition, so a system that
 *    breaks them is never built, and the counts over a whole system - 2.3, 2.4,
 *    2.5 and the room capacity - drop a placement while it is still partial;
 * 2. every system that comes out is measured, and, when at least one sorting
 *    criterion is on, weighed against the worst of the best `maxCandidates`
 *    found so far (`BoundedBest`) - so the search never stops merely because it
 *    filled its quota, only because it ran out of systems to look at, examined
 *    as many as `maxExamined` allows, or ran out of time. What is kept is
 *    therefore the best `maxCandidates` systems out of everything the search
 *    looked at, not the first ones that happened to pass;
 * 3. the kept systems are put in order by the criteria of section 3. That last
 *    step is cheap and is done again whenever the user only changes the order
 *    of the criteria, which is exactly what the requirement expects: the
 *    sorting may change during a run, the thresholds may not.
 *
 * When no criterion is on, "best" has no meaning to search for, and the run
 * falls back to keeping the first `maxCandidates` systems that pass the
 * thresholds - there is nothing to prefer one over another for.
 */

import { Component, Decomposition, iterSolutions } from "./decomposition";
import { Exam, ExamSystem, FacultyRules, Room, ScheduledExam } from "./model";
import { PartialThresholdChecker } from "./partial";
import { RoomAllocation, RoomAllocator } from "./rooms";
import { BoundedBest } from "./topk";
import { SystemMetrics, compareByCriteria, measure, passesThresholds } from "./quality";
import { Settings, SortCriterion } from "./settings";
import { translate as t } from "../i18n/translate";

export interface Candidate {
  system: ExamSystem;
  metrics: SystemMetrics;
  allocation: RoomAllocation | null;
}

export type SearchStatus = "complete" | "enough" | "examined limit" | "timed out";

export interface SearchReport {
  examined: number;
  accepted: number;
  status: SearchStatus;
  seconds: number;
  /** The number of systems before the threshold requirements, or null. */
  totalSystems: bigint | null;
}

export interface SearchResult {
  candidates: Candidate[];
  report: SearchReport;
}

export function describeSearch(report: SearchReport, kept: number): string {
  const total =
    report.totalSystems === null ? t("search.unknownCount") : report.totalSystems.toLocaleString("en-US");
  const examined = report.examined.toLocaleString("en-US");
  let head: string;
  if (report.status === "complete") {
    head = t("search.headComplete", { total });
  } else if (report.status === "enough") {
    head = t("search.headEnough", { examined, total });
  } else if (report.status === "examined limit") {
    head = t("search.headExaminedLimit", { examined, total });
  } else {
    head = t("search.headTimedOut", { examined, total });
  }
  const tail =
    kept < report.accepted
      ? t("search.tailWithKept", { accepted: report.accepted, kept })
      : t("search.tailAllKept", { accepted: report.accepted });
  return t("search.summary", { head, tail, seconds: report.seconds.toFixed(2) });
}

export interface SearchInput {
  exams: Exam[];
  decomposition: Decomposition;
  settings: Settings;
  rooms?: Room[];
  faculty?: FacultyRules;
}

export function runSearch(input: SearchInput): SearchResult {
  const started = performance.now();
  const { exams, decomposition, settings } = input;
  const components = decomposition.components;

  const allocator = input.rooms && input.rooms.length
    ? new RoomAllocator(input.rooms, settings.defaultStudents)
    : null;
  const pruner = new PartialThresholdChecker(
    exams,
    decomposition.depthOfPosition,
    settings,
    allocator ? allocator.totalCapacity : null
  );
  const usePruner = pruner.isNeeded;
  if (usePruner) pruner.reset();

  const report: SearchReport = {
    examined: 0,
    accepted: 0,
    status: "complete",
    seconds: 0,
    totalSystems: decomposition.total,
  };

  if (!exams.length || !components.length || decomposition.total === 0n) {
    report.seconds = (performance.now() - started) / 1000;
    return { candidates: [], report };
  }

  const deadline = settings.timeLimitSeconds
    ? started + settings.timeLimitSeconds * 1000
    : null;
  // When the user asks for the best exam systems, `decompose` (the caller's
  // job, before this function is ever called) has already shuffled the
  // components and their dates, so the standard walk below - unchanged -
  // samples a different neighbourhood of the search space on every run
  // instead of always exhausting the last component before trying another
  // value of the first.
  const ranked = settings.sortCriteria.length > 0;
  const best = ranked
    ? new BoundedBest<Candidate>(settings.maxCandidates, (a, b) =>
        compareByCriteria(a.metrics, b.metrics, settings.sortCriteria) < 0
      )
    : null;
  const firstFound: Candidate[] = [];
  let accepted = 0;
  const seen = new Set<string>();
  const placement = new Array<string>(exams.length).fill("");
  const iterators: Generator<number[]>[] = new Array(components.length);
  const last = components.length - 1;
  let depth = 0;
  let appliedTo = -1;
  let examined = 0;
  iterators[0] = iterSolutions(components[0]);

  walk: while (depth >= 0) {
    const step = iterators[depth].next();
    if (step.done) {
      depth -= 1;
      continue;
    }

    if (usePruner) {
      while (appliedTo >= depth) {
        pruner.unapply(appliedTo);
        appliedTo -= 1;
      }
    }

    const component: Component = components[depth];
    const pairs: [number, string][] = component.positions.map((position, place) => [
      position,
      component.dates[step.value[place]],
    ]);
    for (const [position, date] of pairs) placement[position] = date;

    if (usePruner) {
      if (!pruner.apply(depth, pairs)) {
        // Every system below this placement breaks the same count.
        pruner.unapply(depth);
        continue;
      }
      appliedTo = depth;
    }

    if (depth !== last) {
      depth += 1;
      iterators[depth] = iterSolutions(components[depth]);
      continue;
    }

    examined += 1;
    const key = placement.join("|");
    if (!seen.has(key)) {
      // A spread out walk may reach one system by two ways, and the user must
      // never be shown the same system twice.
      seen.add(key);
      const system: ExamSystem = exams.map<ScheduledExam>((exam, position) => ({
        exam,
        date: placement[position],
      }));
      const metrics = measure(system);
      if (passesThresholds(metrics, settings)) {
        const allocation = allocator ? allocator.allocate(system) : null;
        if (!(settings.requireRooms && allocation && !allocation.isComplete)) {
          accepted += 1;
          const candidate: Candidate = { system, metrics, allocation };
          if (best) {
            best.offer(candidate);
          } else {
            firstFound.push(candidate);
            if (settings.maxCandidates && firstFound.length >= settings.maxCandidates) {
              report.status = "enough";
              break walk;
            }
          }
        }
      }
    }

    if (settings.maxExamined && examined >= settings.maxExamined) {
      report.status = "examined limit";
      break walk;
    }
    if (deadline !== null && examined % 256 === 0 && performance.now() >= deadline) {
      report.status = "timed out";
      break walk;
    }
  }

  const candidates = best ? [...best.items] : firstFound;
  report.examined = examined;
  report.accepted = accepted;
  sortCandidates(candidates, settings.sortCriteria);
  report.seconds = (performance.now() - started) / 1000;
  return { candidates, report };
}

/** Order the candidates again, by the criteria of section 3. */
export function sortCandidates(candidates: Candidate[], criteria: SortCriterion[]): Candidate[] {
  if (criteria.length) {
    candidates.sort((first, second) =>
      compareByCriteria(first.metrics, second.metrics, criteria)
    );
  }
  return candidates;
}
