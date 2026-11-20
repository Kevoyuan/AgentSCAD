"""Analytic and adversarial checks for the independent moment diagnostic."""
import hashlib
from pathlib import Path
import runpy
import struct
import tempfile
import unittest


audit_module = runpy.run_path(str(Path(__file__).with_name("audit-source-pose-moments.py")))


def tetrahedron(path, vertices):
    faces = [(0, 2, 1), (0, 1, 3), (0, 3, 2), (1, 2, 3)]
    data = bytearray(80) + struct.pack("<I", 4)
    for face in faces:
        coordinates = [value for index in face for value in vertices[index]]
        data.extend(struct.pack("<12fH", 0, 0, 0, *coordinates, 0))
    path.write_bytes(data)
    return {"path": str(path), "sha256": hashlib.sha256(data).hexdigest()}


class MomentsTest(unittest.TestCase):
    def test_analytic_tetrahedron_and_rigid_pose(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            vertices = [(0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1)]
            baseline = tetrahedron(root / "local.stl", vertices)
            moved = tetrahedron(root / "moved.stl", [(2-y, 3+x, 4+z) for x, y, z in vertices])
            measurement = audit_module["measure"](baseline)
            self.assertAlmostEqual(measurement["signedVolumeMm3"], 1 / 6)
            self.assertEqual(measurement["centroidMm"], [0.25, 0.25, 0.25])
            protocol = {"source": baseline, "centroidToleranceMm": 0.0001,
                        "relativeVolumeTolerance": 0.00001, "local": {"p": baseline},
                        "cases": [{"id": "moved", "parts": {"p": moved},
                                   "transforms": {"p": [0,-1,0,2,1,0,0,3,0,0,1,4,0,0,0,1]}}]}
            self.assertEqual(audit_module["audit"](protocol)["status"], "PASS")
            protocol["cases"][0]["parts"]["p"] = baseline
            self.assertEqual(audit_module["audit"](protocol)["status"], "FAIL")
            baseline["sha256"] = "0" * 64
            with self.assertRaises(ValueError):
                audit_module["audit"](protocol)

    def test_equal_moments_do_not_establish_surface_correspondence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            vertices = [(0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1)]
            baseline = tetrahedron(root / "local.stl", vertices)
            # Determinant-one deformation around the centroid changes the surface.
            changed = tetrahedron(root / "changed.stl", [(2*(x-.25)+.25, .5*(y-.25)+.25, z) for x,y,z in vertices])
            protocol = {"source": baseline, "centroidToleranceMm": 0.0001,
                        "relativeVolumeTolerance": 0.00001, "local": {"p": baseline},
                        "cases": [{"id": "deformed", "parts": {"p": changed},
                                   "transforms": {"p": [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}}]}
            report = audit_module["audit"](protocol)
            self.assertEqual(report["status"], "PASS")
            self.assertEqual(report["surfaceCorrespondence"], "NOT_RUN")
            self.assertNotEqual(report["local"]["p"]["minMm"], report["results"][0]["parts"][0]["actual"]["minMm"])
            reflection = [-1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
            with self.assertRaises(ValueError):
                audit_module["transform_point"](reflection, [0,0,0])


if __name__ == "__main__":
    unittest.main()
