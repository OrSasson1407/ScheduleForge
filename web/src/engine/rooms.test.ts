import { describe, expect, it } from "vitest";
import { RoomAllocator } from "./rooms";
import { Exam, ExamSystem, Room } from "./model";

let nextId = 0;
function exam(students: number | undefined, courseNumber?: string): Exam {
  nextId += 1;
  return {
    id: `exam-${nextId}`,
    course: {
      number: courseNumber ?? `8310${nextId}`,
      name: "Course",
      instructor: "Dr. A",
      enrollments: [],
      evaluation: "Exam",
      students,
    },
    semester: "FALL",
    moed: "ALEPH",
    slots: [{ key: "83101|1", programNumber: "83101", year: 1, requirement: "Obligatory" }],
  };
}

function room(name: string, capacity: number): Room {
  return { name, capacity, location: "Building A" };
}

function scheduled(date: string, e: Exam): ExamSystem[number] {
  return { exam: e, date };
}

describe("RoomAllocator.totalCapacity", () => {
  it("sums the capacity of every room", () => {
    const allocator = new RoomAllocator([room("A", 30), room("B", 50)]);
    expect(allocator.totalCapacity).toBe(80);
  });
  it("is 0 with no rooms", () => {
    expect(new RoomAllocator([]).totalCapacity).toBe(0);
  });
});

describe("RoomAllocator.studentsOf", () => {
  it("uses the course's own student count when set", () => {
    const allocator = new RoomAllocator([]);
    expect(allocator.studentsOf(exam(45))).toBe(45);
  });
  it("falls back to the default student count when unset", () => {
    const allocator = new RoomAllocator([], 25);
    expect(allocator.studentsOf(exam(undefined))).toBe(25);
  });
  it("falls back to 30 when no default is given", () => {
    const allocator = new RoomAllocator([]);
    expect(allocator.studentsOf(exam(undefined))).toBe(30);
  });
});

describe("RoomAllocator.allocate", () => {
  it("books the smallest room that fits the exam", () => {
    const allocator = new RoomAllocator([room("Small", 30), room("Big", 100)]);
    const e = exam(20);
    const allocation = allocator.allocate([scheduled("2026-01-01", e)]);
    expect(allocation.isComplete).toBe(true);
    expect(allocation.bookings.get(e.id)?.rooms.map((r) => r.name)).toEqual(["Small"]);
  });

  it("does not use a room too small for the exam", () => {
    const allocator = new RoomAllocator([room("Small", 10), room("Big", 100)]);
    const e = exam(20);
    const allocation = allocator.allocate([scheduled("2026-01-01", e)]);
    expect(allocation.bookings.get(e.id)?.rooms.map((r) => r.name)).toEqual(["Big"]);
  });

  it("spreads a large exam over multiple rooms when no single room fits", () => {
    const allocator = new RoomAllocator([room("A", 20), room("B", 20), room("C", 20)]);
    const e = exam(35);
    const allocation = allocator.allocate([scheduled("2026-01-01", e)]);
    expect(allocation.isComplete).toBe(true);
    const booking = allocation.bookings.get(e.id)!;
    const seats = booking.rooms.reduce((sum, r) => sum + r.capacity, 0);
    expect(seats).toBeGreaterThanOrEqual(35);
  });

  it("fails when no combination of rooms has enough seats", () => {
    const allocator = new RoomAllocator([room("A", 10), room("B", 10)]);
    const e = exam(50);
    const allocation = allocator.allocate([scheduled("2026-01-01", e)]);
    expect(allocation.isComplete).toBe(false);
    expect(allocation.failures).toHaveLength(1);
    expect(allocation.failures[0]).toContain("50 seats");
  });

  it("does not book a room for a failed exam", () => {
    const allocator = new RoomAllocator([room("A", 10)]);
    const e = exam(50);
    const allocation = allocator.allocate([scheduled("2026-01-01", e)]);
    expect(allocation.bookings.has(e.id)).toBe(false);
  });

  it("gives each exam of the same date its own, non-overlapping rooms", () => {
    const allocator = new RoomAllocator([room("A", 30), room("B", 30)]);
    const e1 = exam(20, "83101");
    const e2 = exam(20, "83102");
    const allocation = allocator.allocate([scheduled("2026-01-01", e1), scheduled("2026-01-01", e2)]);
    expect(allocation.isComplete).toBe(true);
    const room1 = allocation.bookings.get(e1.id)!.rooms[0].name;
    const room2 = allocation.bookings.get(e2.id)!.rooms[0].name;
    expect(room1).not.toBe(room2);
  });

  it("reuses the same room across different dates", () => {
    const allocator = new RoomAllocator([room("A", 30)]);
    const e1 = exam(20, "83101");
    const e2 = exam(20, "83102");
    const allocation = allocator.allocate([scheduled("2026-01-01", e1), scheduled("2026-01-02", e2)]);
    expect(allocation.isComplete).toBe(true);
    expect(allocation.bookings.get(e1.id)?.rooms[0].name).toBe("A");
    expect(allocation.bookings.get(e2.id)?.rooms[0].name).toBe("A");
  });

  it("seats the largest exam of a day first, so a late large exam can still fail cleanly", () => {
    const allocator = new RoomAllocator([room("Only", 30)]);
    const big = exam(30, "83101");
    const small = exam(10, "83102");
    // Order in the input is small-first; allocation should still prioritize the bigger exam for the only room.
    const allocation = allocator.allocate([scheduled("2026-01-01", small), scheduled("2026-01-01", big)]);
    expect(allocation.bookings.get(big.id)?.rooms.map((r) => r.name)).toEqual(["Only"]);
    expect(allocation.bookings.has(small.id)).toBe(false);
    expect(allocation.isComplete).toBe(false);
  });

  it("returns an empty, complete allocation for an empty system", () => {
    const allocator = new RoomAllocator([room("A", 30)]);
    const allocation = allocator.allocate([]);
    expect(allocation.isComplete).toBe(true);
    expect(allocation.bookings.size).toBe(0);
    expect(allocation.failures).toEqual([]);
  });

  it("collects one failure message per exam that could not be seated", () => {
    const allocator = new RoomAllocator([room("A", 5)]);
    const e1 = exam(50, "83101");
    const e2 = exam(50, "83102");
    const allocation = allocator.allocate([scheduled("2026-01-01", e1), scheduled("2026-01-02", e2)]);
    expect(allocation.failures).toHaveLength(2);
  });

  it("fills an exam that needs every seat exactly, using all rooms", () => {
    const allocator = new RoomAllocator([room("A", 10), room("B", 10)]);
    const e = exam(20);
    const allocation = allocator.allocate([scheduled("2026-01-01", e)]);
    expect(allocation.isComplete).toBe(true);
    expect(allocation.bookings.get(e.id)?.rooms).toHaveLength(2);
  });
});
