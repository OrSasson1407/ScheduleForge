"""Errors raised while reading the data files."""


class DataFileError(Exception):
    """A data file could not be read or does not follow Appendix A.

    The message always names the file and, when known, the line, so that the
    user can fix the input without reading the source code.
    """

    def __init__(self, path, message, line_number=None):
        self.path = path
        self.line_number = line_number
        if line_number is None:
            text = "%s: %s" % (path, message)
        else:
            text = "%s (line %d): %s" % (path, line_number, message)
        super(DataFileError, self).__init__(text)
