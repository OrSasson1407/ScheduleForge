"""Courses and the way they participate in study programs."""


class ProgramEnrollment(object):
    """One "Program" line of a course record (Appendix A of the requirements).

    It states that the course is taught in `program_number`, in a given study
    `year` and `semester`, either as an obligatory or as an elective course.
    """

    __slots__ = ("program_number", "year", "semester", "requirement")

    def __init__(self, program_number, year, semester, requirement):
        self.program_number = program_number
        self.year = year
        self.semester = semester
        self.requirement = requirement

    @property
    def slot(self):
        """The (program, year) pair a conflict is checked against (req. 1.2)."""
        return (self.program_number, self.year)

    def __repr__(self):
        return "ProgramEnrollment(%s, %d, %s, %s)" % (
            self.program_number, self.year, self.semester.value,
            self.requirement.value)


class Course(object):
    """A course: identity, instructor, its enrollments and its evaluation type.

    `students` is the number of students the exam has to seat. It is the last,
    optional, line of a course record; when the file does not state it, the
    default of the settings is used (the room allocation module of version 3.0).
    """

    __slots__ = ("number", "name", "instructor", "enrollments", "evaluation",
                 "students")

    def __init__(self, number, name, instructor, enrollments, evaluation,
                 students=None):
        self.number = number
        self.name = name
        self.instructor = instructor
        self.enrollments = list(enrollments)
        self.evaluation = evaluation
        self.students = students

    def students_or(self, default):
        return default if self.students is None else self.students

    def enrollments_in(self, program_numbers):
        """The enrollments of this course inside the given set of programs."""
        return [e for e in self.enrollments if e.program_number in program_numbers]

    def is_taught_in_any(self, program_numbers):
        return any(e.program_number in program_numbers for e in self.enrollments)

    def __repr__(self):
        return "Course(%s, %s)" % (self.number, self.name)
