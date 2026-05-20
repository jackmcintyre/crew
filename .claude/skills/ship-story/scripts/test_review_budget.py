"""Minimal tests for the variable review-pass budget gate (Epic 2 retro).

Tests cover read_story_shape, review_pass_budget, and the cmd_review_budget
subcommand — the new logic added in chore(ship-story): rubric + budget updates.
"""
import json
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

# Allow importing ship.py directly without installing the package.
sys.path.insert(0, str(Path(__file__).parent))
import ship  # noqa: E402


# ------------------------------------------------------------------ helpers


def write_spec(tmp_path: Path, content: str) -> Path:
    p = tmp_path / "story.md"
    p.write_text(textwrap.dedent(content))
    return p


# ------------------------------------------------------------------ read_story_shape


class TestReadStoryShape:
    def test_user_surface(self, tmp_path):
        spec = write_spec(tmp_path, """\
            # Story 3.1: Fancy Slash Command
            story_shape: user-surface

            ## Overview
        """)
        assert ship.read_story_shape(spec) == "user-surface"

    def test_substrate(self, tmp_path):
        spec = write_spec(tmp_path, """\
            # Story 3.2: Internal Adapter
            story_shape: substrate

            ## Overview
        """)
        assert ship.read_story_shape(spec) == "substrate"

    def test_missing_tag_defaults_to_substrate(self, tmp_path):
        spec = write_spec(tmp_path, """\
            # Story 3.3: No Shape Tag

            ## Overview
        """)
        assert ship.read_story_shape(spec) == "substrate"

    def test_missing_file_defaults_to_substrate(self, tmp_path):
        assert ship.read_story_shape(tmp_path / "nonexistent.md") == "substrate"

    def test_invalid_value_not_matched(self, tmp_path):
        """An unrecognised shape value should not match — defaults to substrate."""
        spec = write_spec(tmp_path, """\
            # Story 3.4: Bad Shape
            story_shape: experimental

            ## Overview
        """)
        assert ship.read_story_shape(spec) == "substrate"


# ------------------------------------------------------------------ review_pass_budget


class TestReviewPassBudget:
    def test_substrate_budget_is_3(self, tmp_path):
        spec = write_spec(tmp_path, "# Title\nstory_shape: substrate\n")
        assert ship.review_pass_budget(spec) == 3

    def test_user_surface_budget_is_5(self, tmp_path):
        spec = write_spec(tmp_path, "# Title\nstory_shape: user-surface\n")
        assert ship.review_pass_budget(spec) == 5

    def test_missing_spec_defaults_to_3(self, tmp_path):
        assert ship.review_pass_budget(tmp_path / "missing.md") == 3


# ------------------------------------------------------------------ cmd_review_budget (CLI)


class TestCmdReviewBudgetCLI:
    def _run(self, *args):
        return subprocess.run(
            [sys.executable, str(Path(__file__).parent / "ship.py"), "review-budget", *args],
            capture_output=True,
            text=True,
        )

    def test_user_surface_returns_5(self, tmp_path):
        spec = write_spec(tmp_path, "# Title\nstory_shape: user-surface\n")
        rc = self._run(str(spec))
        assert rc.returncode == 0
        out = json.loads(rc.stdout)
        assert out["budget"] == 5
        assert out["story_shape"] == "user-surface"

    def test_substrate_returns_3(self, tmp_path):
        spec = write_spec(tmp_path, "# Title\nstory_shape: substrate\n")
        rc = self._run(str(spec))
        assert rc.returncode == 0
        out = json.loads(rc.stdout)
        assert out["budget"] == 3
        assert out["story_shape"] == "substrate"

    def test_missing_file_returns_3(self, tmp_path):
        rc = self._run(str(tmp_path / "nonexistent.md"))
        assert rc.returncode == 0
        out = json.loads(rc.stdout)
        assert out["budget"] == 3
        assert out["story_shape"] == "substrate"
