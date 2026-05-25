"""Tests for the dependency-aware story picker (Story 5.1b).

Covers `_parse_spec_deps`, `_resolve_deps_to_status`, `_unmet_deps`, and the
`pick_story` integration that skips candidates with unshipped upstream
dependencies and halts with `DEPS_NOT_BUILT` when no eligible candidate
remains.

Test conventions per the spec:
  * pytest + tmpdir; no shared state.
  * Do NOT mock filesystem or yaml parsing — seed real files in tmpdir.
  * Each test seeds a minimal sprint-status.yaml (just `development_status:`)
    plus per-story spec files with controlled `### Dependencies` sections.
"""
from __future__ import annotations

import json
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest
import yaml

# Allow importing ship.py directly without installing the package.
SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))
import ship  # noqa: E402


# ------------------------------------------------------------------ helpers


def _seed_repo(
    tmp_path: Path,
    sprint_status: dict[str, str],
    specs: dict[str, str | None],
) -> Path:
    """Seed a fake repo layout under tmp_path.

    sprint_status: maps story_key -> status. Written to
        _bmad-output/implementation-artifacts/sprint-status.yaml under the
        `development_status` key.
    specs: maps story_key -> spec body (the `### Dependencies` section, plus
        any other content) OR None to skip writing a spec file entirely
        (covers Task 1.3: missing spec file -> zero declared deps).

    Returns the spec-dir path (artefacts_dir).
    """
    artefacts_dir = tmp_path / "_bmad-output" / "implementation-artifacts"
    artefacts_dir.mkdir(parents=True)
    status_file = artefacts_dir / "sprint-status.yaml"
    status_file.write_text(
        yaml.safe_dump({"development_status": sprint_status}, sort_keys=False)
    )
    for key, body in specs.items():
        if body is None:
            continue
        (artefacts_dir / f"{key}.md").write_text(textwrap.dedent(body))
    return artefacts_dir


# ------------------------------------------------------------------ _parse_spec_deps


class TestParseSpecDeps:
    def test_single_story_ref(self, tmp_path):
        spec = tmp_path / "story.md"
        spec.write_text(textwrap.dedent("""\
            # Title

            ### Dependencies

            - Story 4.10 (`computeAgreement` helper) — consumed via direct function import.

            ### References
        """))
        assert ship._parse_spec_deps(spec) == ["4-10"]

    def test_multiple_story_refs(self, tmp_path):
        spec = tmp_path / "story.md"
        spec.write_text(textwrap.dedent("""\
            ### Dependencies

            - Story 4.10 — alpha.
            - Story 4.9b — beta.
            - Story 5.1 — gamma.
            - Story 5.1b — delta.
        """))
        assert ship._parse_spec_deps(spec) == ["4-10", "4-9b", "5-1", "5-1b"]

    def test_no_section_returns_empty(self, tmp_path):
        """AC3: no `### Dependencies` header -> zero declared deps."""
        spec = tmp_path / "story.md"
        spec.write_text("# Title\n\nNo deps section here.\n")
        assert ship._parse_spec_deps(spec) == []

    def test_empty_section_returns_empty(self, tmp_path):
        """AC3 unpacked: section exists but no entries -> zero declared deps."""
        spec = tmp_path / "story.md"
        spec.write_text(textwrap.dedent("""\
            ### Dependencies

            ### References
        """))
        assert ship._parse_spec_deps(spec) == []

    def test_mixed_refs_only_story_refs_extracted(self, tmp_path):
        """AC4: FR refs, architecture refs, file-path refs are silently skipped."""
        spec = tmp_path / "story.md"
        spec.write_text(textwrap.dedent("""\
            ### Dependencies

            - Story 1.2 (`WorkspaceConfigSchema`) — consumed.
            - FR40 / FR41 / FR42 (`prd-crew-v1/functional-requirements.md` lines 59–62) — the contract.
            - Architecture (§ project-structure-boundaries.md line 235) — pattern source.
            - Story 4.6 (reviewer-result.json shape) — the canonical session-file transport.
        """))
        assert ship._parse_spec_deps(spec) == ["1-2", "4-6"]

    def test_missing_spec_file_returns_empty(self, tmp_path):
        """Task 1.3: missing spec file -> zero declared deps (no error)."""
        assert ship._parse_spec_deps(tmp_path / "nope.md") == []

    def test_story_ref_regex_negatives(self, tmp_path):
        """AC1 unpacked: must NOT match `Stories`, `STORY`, or bare `4.10b`."""
        spec = tmp_path / "story.md"
        spec.write_text(textwrap.dedent("""\
            ### Dependencies

            - Stories 4.10 — plural form, not a match.
            - STORY 4.10 — wrong case, not a match.
            - 4.10b — no `Story` prefix, not a match.
            - Story 4 — no story num, not a match.

            ### End
        """))
        assert ship._parse_spec_deps(spec) == []


# ------------------------------------------------------------------ _resolve_deps_to_status


class TestResolveDepsToStatus:
    def test_prefix_match_does_not_cross_boundary(self):
        """AC1 unpacked: `4-10` must NOT match `4-10b-…`."""
        dev = {
            "4-10-agreement-metric-helper-compute-agreement": "done",
            "4-10b-auto-merge-gate-medium-high-pause-and-user-override": "done",
        }
        assert ship._resolve_deps_to_status(["4-10"], dev) == [
            ("4-10-agreement-metric-helper-compute-agreement", "done")
        ]
        assert ship._resolve_deps_to_status(["4-10b"], dev) == [
            ("4-10b-auto-merge-gate-medium-high-pause-and-user-override", "done")
        ]

    def test_unresolved_ref_returns_sentinel(self):
        dev = {"1-1-foo": "done"}
        result = ship._resolve_deps_to_status(["9-9"], dev)
        assert result == [("9-9", "<not-in-sprint-status>")]


# ------------------------------------------------------------------ _unmet_deps


class TestUnmetDeps:
    def test_all_done_returns_empty(self, tmp_path):
        spec = tmp_path / "story.md"
        spec.write_text("### Dependencies\n\n- Story 1.1 — alpha.\n")
        dev = {"1-1-foo": "done"}
        assert ship._unmet_deps(spec, dev) == []

    def test_one_unmet_returned(self, tmp_path):
        spec = tmp_path / "story.md"
        spec.write_text(
            "### Dependencies\n\n- Story 1.1 — alpha.\n- Story 1.2 — beta.\n"
        )
        dev = {"1-1-foo": "done", "1-2-bar": "ready-for-dev"}
        assert ship._unmet_deps(spec, dev) == [
            {"ref": "1-2-bar", "status": "ready-for-dev"}
        ]


# ------------------------------------------------------------------ pick_story integration (AC5 a/b/c/d/e/g)


class TestPickStoryDeps:
    def test_skip_on_single_missing_dep_picks_next(self, tmp_path):
        """AC5a + AC5e: candidate with missing dep is skipped; next is picked."""
        artefacts = _seed_repo(
            tmp_path,
            {
                "1-1-upstream-done": "done",
                "1-2-upstream-pending": "ready-for-dev",
                "5-1-candidate-with-unmet-dep": "backlog",
                "5-2-candidate-with-met-dep": "backlog",
            },
            {
                "5-1-candidate-with-unmet-dep": (
                    "### Dependencies\n\n- Story 1.2 — required.\n"
                ),
                "5-2-candidate-with-met-dep": (
                    "### Dependencies\n\n- Story 1.1 — required.\n"
                ),
            },
        )
        # Reload dev_status from the seeded file to exercise the real plumbing.
        dev = yaml.safe_load((artefacts / "sprint-status.yaml").read_text())[
            "development_status"
        ]
        picked = ship.pick_story(dev, None, spec_dir=artefacts)
        assert picked == "5-2-candidate-with-met-dep"

    def test_all_deps_done_passes_through(self, tmp_path):
        """AC5b: when all declared deps are at `done`, candidate picked normally."""
        artefacts = _seed_repo(
            tmp_path,
            {
                "1-1-upstream": "done",
                "5-1-candidate": "backlog",
            },
            {
                "5-1-candidate": "### Dependencies\n\n- Story 1.1 — required.\n",
            },
        )
        dev = yaml.safe_load((artefacts / "sprint-status.yaml").read_text())[
            "development_status"
        ]
        assert ship.pick_story(dev, None, spec_dir=artefacts) == "5-1-candidate"

    def test_no_dependencies_section_no_skip(self, tmp_path):
        """AC5c + AC3: candidate with no `### Dependencies` section is picked."""
        artefacts = _seed_repo(
            tmp_path,
            {"5-1-candidate": "backlog"},
            {"5-1-candidate": "# Title\n\nNo deps section here.\n"},
        )
        dev = yaml.safe_load((artefacts / "sprint-status.yaml").read_text())[
            "development_status"
        ]
        assert ship.pick_story(dev, None, spec_dir=artefacts) == "5-1-candidate"

    def test_mixed_refs_only_story_refs_checked(self, tmp_path):
        """AC5d: non-story-ref entries (FR, architecture, file paths) ignored.

        The candidate's only *story* ref is at `done`, so it picks cleanly
        even though FR/architecture bullets are present.
        """
        artefacts = _seed_repo(
            tmp_path,
            {
                "1-1-upstream": "done",
                "5-1-candidate": "backlog",
            },
            {
                "5-1-candidate": textwrap.dedent("""\
                    ### Dependencies

                    - Story 1.1 (`Foo`) — consumed.
                    - FR40 / FR41 — the contract.
                    - Architecture (§ project-structure-boundaries.md line 235) — pattern source.
                """),
            },
        )
        dev = yaml.safe_load((artefacts / "sprint-status.yaml").read_text())[
            "development_status"
        ]
        assert ship.pick_story(dev, None, spec_dir=artefacts) == "5-1-candidate"

    def test_no_eligible_candidate_halts_with_payload(self, tmp_path, capsys):
        """AC5g + AC2: when no candidate has met deps, exit non-zero with
        `DEPS_NOT_BUILT` JSON listing each skipped candidate + unmet refs.
        """
        artefacts = _seed_repo(
            tmp_path,
            {
                "4-9b-risk-tier": "ready-for-dev",
                "4-10-agreement-metric": "ready-for-dev",
                "5-1-candidate-a": "backlog",
                "5-2-candidate-b": "backlog",
            },
            {
                "5-1-candidate-a": (
                    "### Dependencies\n\n- Story 4.9b — required.\n"
                    "- Story 4.10 — required.\n"
                ),
                "5-2-candidate-b": (
                    "### Dependencies\n\n- Story 4.10 — required.\n"
                ),
            },
        )
        dev = yaml.safe_load((artefacts / "sprint-status.yaml").read_text())[
            "development_status"
        ]
        with pytest.raises(SystemExit) as exc:
            ship.pick_story(dev, None, spec_dir=artefacts)
        assert exc.value.code != 0
        out = capsys.readouterr().out.strip()
        payload = json.loads(out)
        assert payload["halt"] == "DEPS_NOT_BUILT"
        assert len(payload["skipped"]) == 2
        skipped_keys = {s["story_key"] for s in payload["skipped"]}
        assert skipped_keys == {"5-1-candidate-a", "5-2-candidate-b"}
        # Each skip entry carries unmet refs with their current statuses.
        a_entry = next(s for s in payload["skipped"] if s["story_key"] == "5-1-candidate-a")
        a_unmet_refs = {u["ref"] for u in a_entry["unmet"]}
        a_unmet_statuses = {u["status"] for u in a_entry["unmet"]}
        assert a_unmet_refs == {
            "4-9b-risk-tier",
            "4-10-agreement-metric",
        }
        assert a_unmet_statuses == {"ready-for-dev"}

    def test_targeted_pick_bypasses_dep_check(self, tmp_path):
        """AC5f: `pick_story(dev, "5-1")` returns the matching key even when
        its deps are not ready. The dep check applies only to the auto-pick
        path (`story_id is None`).
        """
        artefacts = _seed_repo(
            tmp_path,
            {
                "4-10-agreement-metric": "ready-for-dev",
                "5-1-candidate": "backlog",
            },
            {
                "5-1-candidate": (
                    "### Dependencies\n\n- Story 4.10 — required.\n"
                ),
            },
        )
        dev = yaml.safe_load((artefacts / "sprint-status.yaml").read_text())[
            "development_status"
        ]
        # Targeted pick: dep check is bypassed.
        assert ship.pick_story(dev, "5-1", spec_dir=artefacts) == "5-1-candidate"
