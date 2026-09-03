import { describe, expect, it } from "vitest";
import { addMinutes, assignTimes, minutesOf, parseTimeSlots } from "./timeAssignment";
import { Exam, ExamSystem } from "./model";
import { RoomAllocation } from "./rooms";
import { DEFAULT_SETTINGS, Settings } from "./settings";

let nextId = 0;
function exam(courseNumber: string): Exam {
  nextId += 1;
  return {
    id: `exam-${nextId}`,
    course: { number: courseNumber, name: "Course", instructor: "Dr. A", enrollments: [], evaluation: "Exam" },
    semester: "FALL",
    moed: "ALEPH",
    slots: [{ key: "83101|1", programNumber: "83101", year: 1, requirement: "Obligatory" }],
  };
}

function scheduled(date: string, e: Exam): ExamSystem[number] {
  return { exam: e, date };
}

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("minutesOf", () => {
  it("converts HH:MM to minutes since midnight", () => {
    expect(minutesOf("09:00")).toBe(540);
    expect(minutesOf("00:00")).toBe(0);
    expect(minutesOf("23:59")).toBe(1439);
  });
});

describe("addMinutes", () => {
  it("adds minutes within the same hour", () => {
    expect(addMinutes("09:00", 30)).toBe("09:30");
  });
  it("rolls over to the next hour", () => {
    expect(addMinutes("09:45", 30)).toBe("10:15");
  });
  it("rolls over past midnight", () => {
    expect(addMinutes("23:30", 60)).toBe("00:30");
  });
  it("pads single-digit hours and minutes", () => {
    expect(addMinutes("09:05", 0)).toBe("09:05");
  });
});

describe("parseTimeSlots", () => {
  it("parses comma-separated times", () => {
    expect(parseTimeSlots("09:00,13:00,16:00")).toEqual(["09:00", "13:00", "16:00"]);
  });
  it("parses whitespace-separated times", () => {
    expect(parseTimeSlots("09:00 13:00 16:00")).toEqual(["09:00", "13:00", "16:00"]);
  });
  it("sorts the results regardless of input order", () => {
    expect(parseTimeSlots("16:00,09:00,13:00")).toEqual(["09:00", "13:00", "16:00"]);
  });
  it("deduplicates repeated times", () => {
    expect(parseTimeSlots("09:00,09:00")).toEqual(["09:00"]);
  });
  it("ignores tokens that are not HH:MM", () => {
    expect(parseTimeSlots("09:00, garbage, 13:00")).toEqual(["09:00", "13:00"]);
  });
  it("returns an empty list for an empty string", () => {
    expect(parseTimeSlots("")).toEqual([]);
  });
  it("tolerates extra commas and spaces", () => {
    expect(parseTimeSlots("  09:00 ,, 13:00  ")).toEqual(["09:00", "13:00"]);
  });
});

describe("assignTimes without a room allocation", () => {
  it("returns an empty, complete assignment for an empty system", () => {
    const result = assignTimes([], settings({ timeSlots: ["09:00"] }), null);
    expect(result.isComplete).toBe(true);
    expect(result.bookings.size).toBe(0);
  });

  it("returns an empty assignment when no time slots are configured", () => {
    const system = [scheduled("2026-01-01", exam("83101"))];
    const result = assignTimes(system, settings({ timeSlots: [] }), null);
    expect(result.bookings.size).toBe(0);
  });

  it("assigns the first slot to the only exam of a day", () => {
    const system = [scheduled("2026-01-01", exam("83101"))];
    const result = assignTimes(system, settings({ timeSlots: ["09:00", "13:00"] }), null);
    expect(result.bookings.get(system[0].exam.id)?.start).toBe("09:00");
  });

  it("spreads several exams of a day round-robin across the configured slots", () => {
    const system = [
      scheduled("2026-01-01", exam("83101")),
      scheduled("2026-01-01", exam("83102")),
      scheduled("2026-01-01", exam("83103")),
    ];
    const result = assignTimes(system, settings({ timeSlots: ["09:00", "13:00"] }), null);
    const starts = system.map((s) => result.bookings.get(s.exam.id)?.start);
    expect(starts).toEqual(["09:00", "13:00", "09:00"]);
  });

  it("computes the end time using the configured exam duration", () => {
    const system = [scheduled("2026-01-01", exam("83101"))];
    const result = assignTimes(system, settings({ timeSlots: ["09:00"], defaultExamMinutes: 90 }), null);
    expect(result.bookings.get(system[0].exam.id)).toEqual({ start: "09:00", end: "10:30" });
  });

  it("assigns slots independently per date", () => {
    const system = [scheduled("2026-01-01", exam("83101")), scheduled("2026-01-02", exam("83102"))];
    const result = assignTimes(system, settings({ timeSlots: ["09:00", "13:00"] }), null);
    expect(result.bookings.get(system[0].exam.id)?.start).toBe("09:00");
    expect(result.bookings.get(system[1].exam.id)?.start).toBe("09:00");
  });

  it("orders same-day round robin by course number", () => {
    const e2 = exam("83102");
    const e1 = exam("83101");
    const system = [scheduled("2026-01-01", e2), scheduled("2026-01-01", e1)];
    const result = assignTimes(system, settings({ timeSlots: ["09:00", "13:00"] }), null);
    expect(result.bookings.get(e1.id)?.start).toBe("09:00");
    expect(result.bookings.get(e2.id)?.start).toBe("13:00");
  });
});

describe("assignTimes with a room allocation", () => {
  it("gives two exams sharing a room on the same date different time slots", () => {
    const e1 = exam("83101");
    const e2 = exam("83102");
    const system = [scheduled("2026-01-01", e1), scheduled("2026-01-01", e2)];
    const allocation: RoomAllocation = {
      bookings: new Map([
        [e1.id, { exam: e1, date: "2026-01-01", rooms: [{ name: "Hall", capacity: 100, location: "B1" }] }],
        [e2.id, { exam: e2, date: "2026-01-01", rooms: [{ name: "Hall", capacity: 100, location: "B1" }] }],
      ]),
      failures: [],
      isComplete: true,
    };
    const result = assignTimes(system, settings({ timeSlots: ["09:00", "13:00"] }), allocation);
    expect(result.bookings.get(e1.id)?.start).not.toBe(result.bookings.get(e2.id)?.start);
  });

  it("allows two exams in different rooms to share the same time slot", () => {
    const e1 = exam("83101");
    const e2 = exam("83102");
    const system = [scheduled("2026-01-01", e1), scheduled("2026-01-01", e2)];
    const allocation: RoomAllocation = {
      bookings: new Map([
        [e1.id, { exam: e1, date: "2026-01-01", rooms: [{ name: "A", capacity: 100, location: "B1" }] }],
        [e2.id, { exam: e2, date: "2026-01-01", rooms: [{ name: "B", capacity: 100, location: "B1" }] }],
      ]),
      failures: [],
      isComplete: true,
    };
    const result = assignTimes(system, settings({ timeSlots: ["09:00", "13:00"] }), allocation);
    expect(result.bookings.get(e1.id)?.start).toBe("09:00");
    expect(result.bookings.get(e2.id)?.start).toBe("09:00");
  });

  it("fails an exam that needs a room-driven slot beyond the configured slots", () => {
    const e1 = exam("83101");
    const e2 = exam("83102");
    const e3 = exam("83103");
    const system = [scheduled("2026-01-01", e1), scheduled("2026-01-01", e2), scheduled("2026-01-01", e3)];
    const sameRoom = { name: "Hall", capacity: 100, location: "B1" };
    const allocation: RoomAllocation = {
      bookings: new Map([
        [e1.id, { exam: e1, date: "2026-01-01", rooms: [sameRoom] }],
        [e2.id, { exam: e2, date: "2026-01-01", rooms: [sameRoom] }],
        [e3.id, { exam: e3, date: "2026-01-01", rooms: [sameRoom] }],
      ]),
      failures: [],
      isComplete: true,
    };
    const result = assignTimes(system, settings({ timeSlots: ["09:00", "13:00"] }), allocation);
    expect(result.isComplete).toBe(false);
    expect(result.failures).toHaveLength(1);
  });

  it("falls back to round-robin for an exam that could not be seated in any room", () => {
    const e1 = exam("83101");
    const system = [scheduled("2026-01-01", e1)];
    const allocation: RoomAllocation = { bookings: new Map(), failures: ["no room"], isComplete: false };
    const result = assignTimes(system, settings({ timeSlots: ["09:00"] }), allocation);
    expect(result.bookings.get(e1.id)?.start).toBe("09:00");
  });

  it("gives an exam spread over multiple rooms a slot free in every one of them", () => {
    const e1 = exam("83101"); // occupies rooms A and B in slot 0
    const e2 = exam("83102"); // occupies room B only
    const e3 = exam("83103"); // needs both A and B free -> must wait for slot 1
    const system = [scheduled("2026-01-01", e1), scheduled("2026-01-01", e2), scheduled("2026-01-01", e3)];
    const roomA = { name: "A", capacity: 100, location: "B1" };
    const roomB = { name: "B", capacity: 100, location: "B1" };
    const allocation: RoomAllocation = {
      bookings: new Map([
        [e1.id, { exam: e1, date: "2026-01-01", rooms: [roomA] }],
        [e2.id, { exam: e2, date: "2026-01-01", rooms: [roomB] }],
        [e3.id, { exam: e3, date: "2026-01-01", rooms: [roomA, roomB] }],
      ]),
      failures: [],
      isComplete: true,
    };
    const result = assignTimes(system, settings({ timeSlots: ["09:00", "13:00", "16:00"] }), allocation);
    expect(result.bookings.get(e3.id)?.start).toBe("13:00");
  });
});

describe("assignTimes with enforceTimeSlots on", () => {
  it("gives two conflicting exams of the same day different slots, ignoring rooms entirely", () => {
    const e1 = exam("83101");
    const e2 = exam("83102");
    const system = [scheduled("2026-01-01", e1), scheduled("2026-01-01", e2)];
    const result = assignTimes(
      system,
      settings({ timeSlots: ["09:00", "13:00"], enforceTimeSlots: true }),
      null
    );
    expect(result.isComplete).toBe(true);
    expect(result.bookings.get(e1.id)?.start).not.toBe(result.bookings.get(e2.id)?.start);
  });

  it("fails with a listed failure when a date cannot be colored", () => {
    const e1 = exam("83101");
    const e2 = exam("83102");
    const system = [scheduled("2026-01-01", e1), scheduled("2026-01-01", e2)];
    const result = assignTimes(
      system,
      settings({ timeSlots: ["09:00"], enforceTimeSlots: true }),
      null
    );
    expect(result.isComplete).toBe(false);
    expect(result.failures).toHaveLength(1);
  });

  it("uses the roster for a defense-in-depth conflict, even with no shared program/year", () => {
    const e1 = exam("83101");
    const e2 = exam("83102");
    // Override the exam() helper's shared slot so 1.2/2.1/2.2 would never
    // relate these two at all - only the roster can make them conflict here.
    e1.slots = [{ key: "83201|1", programNumber: "83201", year: 1, requirement: "Obligatory" }];
    e2.slots = [{ key: "83202|1", programNumber: "83202", year: 1, requirement: "Obligatory" }];
    const system = [scheduled("2026-01-01", e1), scheduled("2026-01-01", e2)];
    const roster = { [e1.course.number]: ["2021001"], [e2.course.number]: ["2021001"] };
    const result = assignTimes(
      system,
      settings({ timeSlots: ["09:00"], enforceTimeSlots: true }),
      null,
      roster
    );
    expect(result.isComplete).toBe(false);
  });

  it("falls back to the cosmetic round-robin pass when enforceTimeSlots is off, even with the same data", () => {
    const e1 = exam("83101");
    const e2 = exam("83102");
    const system = [scheduled("2026-01-01", e1), scheduled("2026-01-01", e2)];
    const result = assignTimes(system, settings({ timeSlots: ["09:00"], enforceTimeSlots: false }), null);
    // The cosmetic pass has no colorability concept - it never fails, just spreads round robin.
    expect(result.isComplete).toBe(true);
    expect(result.bookings.get(e1.id)?.start).toBe("09:00");
    expect(result.bookings.get(e2.id)?.start).toBe("09:00");
  });
});
