"""Regressions for volume reporting and degenerate-geometry detection (B002).

The Python analyzer must expose an enclosed-volume figure so the downstream
TypeScript degenerate check (B002) can flag near-zero-thickness hulls that
otherwise pass R001 (planar-sheet warning) and R003 (watertight volume).
"""
import sys
import tempfile
from pathlib import Path
import unittest

import trimesh

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from validate_stl import validate_stl


class DegeneracyTests(unittest.TestCase):
    def analyze(self, mesh):
        # Export/reload to exercise the production STL path, including welding.
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "part.stl"
            mesh.export(path)
            output = validate_stl(str(path))
        self.assertNotIn("error", output, output)
        return output

    def test_summary_reports_volume_for_watertight_solid(self):
        output = self.analyze(trimesh.creation.box(extents=[50, 50, 5]))
        summary = output["summary"]
        self.assertIn("volume", summary)
        self.assertIsNotNone(summary["volume"])
        self.assertAlmostEqual(summary["volume"], 12500, places=1)

    def test_degenerate_hull_has_tiny_volume_and_extent(self):
        # Two coplanar faces 0.0001 mm apart -> a near-zero-thickness slab.
        mesh = trimesh.creation.box(extents=[50, 50, 0.0001])
        output = self.analyze(mesh)
        summary = output["summary"]
        self.assertIn("volume", summary)
        self.assertIsNotNone(summary["volume"])
        self.assertLess(summary["volume"], 1.0)
        extents = [
            summary["boundingBox"]["length"],
            summary["boundingBox"]["width"],
            summary["boundingBox"]["height"],
        ]
        self.assertLess(min(extents), 0.3)
        # The gap this rule closes: R001 only warns on a planar sheet, so the
        # degenerate part would otherwise slip through as acceptable geometry.
        r001 = next(r for r in output["rules"] if r["id"] == "R001")
        self.assertEqual(r001["status"], "warn", r001)

    def test_volume_is_absent_for_open_mesh(self):
        mesh = trimesh.creation.box()
        mesh.update_faces(list(range(11)))  # drop a face -> open shell
        output = self.analyze(mesh)
        summary = output["summary"]
        self.assertIsNone(summary.get("volume"))


if __name__ == "__main__":
    unittest.main()
