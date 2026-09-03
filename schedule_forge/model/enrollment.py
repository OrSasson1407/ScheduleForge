"""Which real students are enrolled in which course (an optional input).

Every other rule in this engine reasons about a course's students only in
aggregate - a (program, year) it is taught in, a headcount for room seating -
because that is what the required data files carry. When a roster of real
enrollment facts is available, `SharedStudentsSameDay` in `scheduling.constraints`
uses it to catch the one thing the aggregate model cannot see: a genuine
student, enrolled in two courses that do not even share a (program, year)
slot (a double major, a minor, a cross-listed elective), sitting two exams on
the same date.
"""


class EnrollmentRoster(object):
    """Course number -> the set of student ids enrolled in it."""

    __slots__ = ("_students_of",)

    def __init__(self, students_of=None):
        self._students_of = {course: set(students)
                             for course, students in (students_of or {}).items()}

    def students_of(self, course_number):
        return self._students_of.get(course_number, frozenset())

    def shares_students(self, course_a, course_b):
        if course_a == course_b:
            return bool(self.students_of(course_a))
        return not self.students_of(course_a).isdisjoint(self.students_of(course_b))

    def __len__(self):
        return len(self._students_of)
