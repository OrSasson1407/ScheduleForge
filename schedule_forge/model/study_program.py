"""The catalogue of study programs the software knows about.

Nothing here is built in: every selectable program comes from the loaded
courses file - its number, and whatever the file itself says about it. A
courses file names a program only by its number, never a name, so that is the
whole of what the software knows about it until a file says otherwise.
"""


class StudyProgram(object):
    """A single study program: a unique 5-digit number and a display name."""

    def __init__(self, number, name):
        self.number = number
        self.name = name

    def __repr__(self):
        return "StudyProgram(%s, %s)" % (self.number, self.name)

    def __str__(self):
        return "%s %s" % (self.number, self.name)


class StudyProgramCatalog(object):
    """Look-up table of the study programs the loaded data holds."""

    #: Requirement 1.1 - the maximum number of programs a user may select.
    MAX_SELECTED_PROGRAMS = 5

    def __init__(self, programs=()):
        self._by_number = {}
        for number, name in programs:
            self._by_number[number] = StudyProgram(number, name)

    @classmethod
    def from_courses(cls, courses):
        """The catalogue of every program number the loaded courses mention.

        A courses file never states a program's name, so every entry is named
        after its own number; `name_of` already falls back to the number for
        an unknown one, which is exactly what an entry built this way returns.
        """
        numbers = sorted(set(enrollment.program_number
                             for course in courses
                             for enrollment in course.enrollments))
        return cls((number, number) for number in numbers)

    def contains(self, number):
        return number in self._by_number

    def get(self, number):
        """Return the program with that number, or None when it is unknown."""
        return self._by_number.get(number)

    def name_of(self, number):
        """Display name of a program number, falling back to the number itself."""
        program = self._by_number.get(number)
        return program.name if program is not None else number

    def numbers(self):
        return list(self._by_number.keys())
