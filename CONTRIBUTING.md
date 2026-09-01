# Contributing to ScheduleForge

## Before you start

Read `DESIGN.md` first. It documents the architecture part by part - what
each piece is for and why it is built the way it is - and every part is
numbered so the rest of this file, commit messages, and code comments can
point at a specific section instead of re-explaining it. A change that adds
a real feature (not a typo fix) should extend `DESIGN.md` too: either add to
an existing section if the feature belongs there, or add a new top-level
part if it does not - see the end of `DESIGN.md` for the convention the
existing parts already follow.

The repository holds two parallel implementations of the same scheduling
rules - the web app (`web/`, React + TypeScript) and the Python engine
(`schedule_forge/`) - kept semantically identical on purpose. A change to a
scheduling rule (a threshold, a constraint, how the search decomposes the
problem) needs to land in both, not just the one you happened to be working
in.

## Setup

**Web app:**

```bash
cd web
npm install
npm run dev
```

Opens at `http://localhost:5173`.

**Python engine:**

Python 3.6+, no third-party packages.

```bash
python main.py --courses data/courses.txt --periods data/exam_periods.txt --programs data/programs.txt --output output/exam_systems.txt
```

**Server** (real-time collaboration, accounts, and the published schedule -
optional, only needed for those features):

```bash
cd server
npm install
npm start
```

## Before opening a pull request

Run what CI runs, so nothing red arrives as a surprise:

```bash
cd web && npm run build   # tsc -b && vite build
python -m unittest discover -s tests
```

Both also run automatically on every push and pull request
(`.github/workflows/ci.yml`); a red check on your PR means one of the two
commands above failed.

## Conventions worth knowing

* **Bilingual UI.** Every user-facing string goes through the translation
  system (`web/src/i18n/`) - a new string needs a key in both
  `translations/en.ts` and `translations/he.ts`, never a literal in a
  component. `TranslationKey` is derived from `en.ts`'s own shape, so a
  missing or misspelled key is a compile error, not a blank label at
  runtime.
* **The engine has no UI code, and the UI has no scheduling code.** Screens
  and components read files, hand the engine study programs and settings,
  and show what the engine returns - they do not decide whether two exams
  conflict themselves. That logic lives in `web/src/engine/` (and its
  Python mirror), reached through the few functions already used everywhere
  else (`requiredGap`, `decompose`, and so on) so a new rule only has to be
  added once to apply everywhere.
* **No comments explaining what code does.** A comment is for a non-obvious
  *why* - a hidden constraint, a workaround, a subtlety a reader would
  otherwise trip over - not a restatement of what a well-named function
  already says.
* **Commits and PRs.** Keep a PR scoped to one change; write commit messages
  that explain why, not just what changed line by line.

## License

By contributing, you agree your contribution is licensed under this
repository's MIT license (`LICENSE`).
