"""Measured regressions for thickness, round-hole clearance and CGAL booleans."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from validate_stl import check_wall_thickness, validate_stl


class ThicknessTests(unittest.TestCase):
    def check_mesh(self, mesh):
        # Export/reload to exercise the production STL path, including welding.
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'part.stl'
            mesh.export(path)
            output = validate_stl(str(path))
        self.assertNotIn('error', output, output)
        return next(rule for rule in output['rules'] if rule['id'] == 'R001')

    def test_thin_washer_is_warning_not_wall_failure(self):
        result = self.check_mesh(trimesh.creation.annulus(r_min=3, r_max=10, height=0.8))
        self.assertEqual(result['status'], 'warn', result)
        self.assertEqual(result['details']['geometryClass'], 'planar_sheet')
        self.assertAlmostEqual(result['details']['sheetThickness'], 0.8, places=3)

    def test_rotated_translated_sheet_is_still_sheet(self):
        mesh = trimesh.creation.box(extents=[40, 30, 0.8])
        mesh.apply_transform(trimesh.transformations.rotation_matrix(0.71, [1, 2, 3]))
        mesh.apply_translation([20, -14, 6])
        result = self.check_mesh(mesh)
        self.assertEqual(result['status'], 'warn', result)
        self.assertEqual(result['details']['geometryClass'], 'planar_sheet')

    def test_narrow_washer_rim_still_fails(self):
        result = self.check_mesh(trimesh.creation.annulus(r_min=9.4, r_max=10, height=0.8))
        self.assertEqual(result['status'], 'fail', result)
        self.assertLess(result['details']['minWallWidth'], 1.2)

    def test_thin_enclosure_walls_still_fail(self):
        outer = trimesh.creation.box(extents=[20, 20, 20])
        inner = trimesh.creation.box(extents=[18.4, 18.4, 18.4])
        inner.invert()
        result = self.check_mesh(trimesh.util.concatenate([outer, inner]))
        self.assertEqual(result['status'], 'fail', result)
        self.assertAlmostEqual(result['details']['minThickness'], 0.8, places=3)
        self.assertEqual(result['details']['geometryClass'], 'unclassified_solid')

    def test_sub_03mm_wall_is_not_discarded_as_self_intersection(self):
        outer = trimesh.creation.box(extents=[20, 20, 20])
        inner = trimesh.creation.box(extents=[19.6, 19.6, 19.6])
        inner.invert()
        result = self.check_mesh(trimesh.util.concatenate([outer, inner]))
        self.assertEqual(result['status'], 'fail', result)
        self.assertAlmostEqual(result['details']['minThickness'], 0.2, places=3)

    def test_healthy_material_passes_without_offset_bias(self):
        result = self.check_mesh(trimesh.creation.box(extents=[20, 20, 2]))
        self.assertEqual(result['status'], 'pass', result)
        self.assertAlmostEqual(result['details']['minThickness'], 2.0, places=4)

    def test_non_watertight_mesh_is_skipped(self):
        mesh = trimesh.creation.box()
        mesh.update_faces(list(range(11)))
        self.assertEqual(check_wall_thickness(mesh, 1.2)['status'], 'skip')

    def test_missing_ray_backend_is_error_not_success(self):
        mesh = trimesh.creation.box()
        with patch.object(mesh.ray, 'intersects_location', side_effect=ImportError('rtree unavailable')):
            result = check_wall_thickness(mesh, 1.2)
        self.assertEqual(result['status'], 'error', result)
        self.assertIsNone(result['details']['minThickness'])


class OpenScadGeometryTests(unittest.TestCase):
    def render(self, source):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            (path / 'part.scad').write_text(source)
            result = subprocess.run([os.environ.get('OPENSCAD_BIN', 'openscad'),
                                     '-o', str(path / 'part.stl'), str(path / 'part.scad')],
                                    capture_output=True, text=True, timeout=45)
            self.assertEqual(result.returncode, 0, result.stderr)
            mesh = trimesh.load(path / 'part.stl', force='mesh')
        self.assertTrue(mesh.is_volume, source)
        return mesh

    def minimum_bore_diameter(self, mesh):
        # Inner vertical faces point toward the bore axis. Plane distance to
        # the origin is the available bolt radius, independent of vertex radii.
        normals, centers = mesh.face_normals, mesh.triangles_center
        inward = ((np.abs(normals[:, 2]) < 1e-5)
                  & (np.sum(normals[:, :2] * centers[:, :2], axis=1) < -1e-5))
        self.assertTrue(np.any(inward))
        return 2 * np.min(np.abs(np.sum(normals[inward] * centers[inward], axis=1)))

    def test_low_resolution_hole_reproduces_undersize(self):
        mesh = self.render('difference(){cube([20,20,5],center=true); cylinder(d=6,h=7,center=true,$fn=6);}')
        self.assertAlmostEqual(self.minimum_bore_diameter(mesh), 5.196152, places=4)

    def test_fit_holes_preserve_clearance_with_coarse_global_fn(self):
        for diameter in [2, 6, 20]:
            with self.subTest(diameter=diameter):
                mesh = self.render(f'include <{ROOT}/openscad_lib/agentscad_std.scad>;\n'
                                   f'$fn=6; difference(){{cube([40,40,5],center=true); fit_hole(d={diameter},h=7);}}')
                self.assertAlmostEqual(self.minimum_bore_diameter(mesh), diameter, delta=0.0001)
                inner = mesh.vertices[np.linalg.norm(mesh.vertices[:, :2], axis=1) < diameter]
                max_diameter = 2 * np.max(np.linalg.norm(inner[:, :2], axis=1))
                self.assertLessEqual(max_diameter, diameter + 0.0201)

    def test_existing_bore_modules_use_compensated_holes(self):
        for call in ['cylinder_boss(diameter=20,height=5,hole_d=6)',
                     'difference(){cube([20,20,5],center=true); screw_hole(d=6,h=5);}']:
            mesh = self.render(f'include <{ROOT}/openscad_lib/agentscad_std.scad>; $fn=6; {call};')
            self.assertAlmostEqual(self.minimum_bore_diameter(mesh), 6, delta=0.0001)
        for name, diameter in [('washer', 8), ('spacer', 4)]:
            source = (ROOT / 'cad_knowledge' / 'examples' / f'{name}.scad').read_text()
            source = source.replace('include <agentscad_std.scad>',
                                    f'include <{ROOT}/openscad_lib/agentscad_std.scad>')
            self.assertAlmostEqual(self.minimum_bore_diameter(self.render(source)), diameter, delta=0.0001)

    def library(self, source):
        return self.render(f'include <{ROOT}/openscad_lib/agentscad_std.scad>; {source}')

    def assert_through_points(self, mesh, points, top):
        origins = np.array([[x, y, top + 1] for x, y in points])
        hits = mesh.ray.intersects_any(origins, np.tile([0, 0, -1], (len(points), 1)))
        self.assertFalse(np.any(hits), f"Blocked through-hole centers: {hits}")

    def test_bolt_pattern_without_children_cuts_four_through_holes(self):
        for centered in [True, False]:
            with self.subTest(center=centered):
                flag = str(centered).lower()
                mesh = self.library(f'difference(){{cube([40,30,5],center={flag}); '
                                    f'bolt_pattern_rect(40,30,4,5,5,center={flag});}}')
                self.assertEqual(mesh.euler_number, -6)
                self.assertAlmostEqual(40*30*5 - mesh.volume, 4*np.pi*2**2*5, delta=1.3)
                points = [(-15,-10),(-15,10),(15,-10),(15,10)] if centered else [(5,5),(5,25),(35,5),(35,25)]
                self.assert_through_points(mesh, points, 5)

    def test_bolt_pattern_preserves_custom_children(self):
        mesh = self.library('difference(){cube([40,30,5],center=true); '
                            'bolt_pattern_rect(40,30,4,5,5) cube([2,2,7],center=true);}')
        self.assertEqual(mesh.euler_number, -6)
        self.assertAlmostEqual(40*30*5 - mesh.volume, 4*2*2*5, places=4)

    def test_screw_hole_depth_in_both_coordinate_frames(self):
        for centered in [True, False]:
            with self.subTest(center=centered):
                flag = str(centered).lower()
                translation = '[0,0,0]' if centered else '[20,15,0]'
                # Default center=true remains compatible; center=false starts
                # the nominal cutter interval at z=0 and spans the full h.
                arg = '' if centered else ',center=false'
                mesh = self.library(f'difference(){{cube([40,30,10],center={flag}); '
                                    f'translate({translation}) screw_hole(d=5,h=10{arg});}}')
                self.assertAlmostEqual(40*30*10 - mesh.volume, np.pi*2.5**2*10, delta=1)
                self.assertEqual(mesh.euler_number, 0)
                self.assert_through_points(mesh, [(0,0) if centered else (20,15)], 10)

    def test_enclosure_matches_requested_floor_and_cavity_height(self):
        for centered in [True, False]:
            for radius in [0, 3]:
                with self.subTest(center=centered, radius=radius):
                    flag = str(centered).lower()
                    mesh = self.library(f'enclosure_box(30,20,20,1.2,corner_r={radius},center={flag});')
                    expected_min = [-16.2,-11.2,-10.6] if centered else [0,0,0]
                    np.testing.assert_allclose(mesh.bounds[0], expected_min, atol=1e-5)
                    np.testing.assert_allclose(mesh.extents, [32.4,22.4,21.2], atol=1e-5)
                    x,y = (0,0) if centered else (16.2,11.2)
                    hits, _, _ = mesh.ray.intersects_location([[x,y,mesh.bounds[1,2]+1]], [[0,0,-1]])
                    levels = np.sort(hits[:,2])
                    self.assertEqual(len(levels), 2)
                    self.assertAlmostEqual(levels[1]-levels[0], 1.2, places=4)
                    self.assertAlmostEqual(mesh.bounds[1,2]-levels[1], 20, places=4)
                    if radius == 0:
                        self.assertAlmostEqual(mesh.volume, 32.4*22.4*21.2-30*20*20, delta=0.1)


    def test_rounded_box_center_and_origin_bounds(self):
        for centered in [True, False]:
            flag = str(centered).lower()
            mesh = self.library(f'rounded_box([20,16,8],r=1,center={flag});')
            expected_min = [-10,-8,-4] if centered else [0,0,0]
            np.testing.assert_allclose(mesh.bounds[0], expected_min, atol=1e-5)
            np.testing.assert_allclose(mesh.extents, [20,16,8], atol=1e-5)

    def test_mounting_plate_holes_follow_body_coordinates(self):
        for centered in [True, False]:
            for radius in [0, 1]:
                with self.subTest(center=centered, radius=radius):
                    flag = str(centered).lower()
                    mesh = self.library(f'mounting_plate(40,30,5,hole_d=4,margin=5,corner_r={radius},center={flag});')
                    self.assertEqual(mesh.euler_number, -6)
                    points = [(-15,-10),(-15,10),(15,-10),(15,10)] if centered else [(5,5),(5,25),(35,5),(35,25)]
                    self.assert_through_points(mesh, points, 5)
                    np.testing.assert_allclose(mesh.bounds[0], [-20,-15,-2.5] if centered else [0,0,0], atol=1e-5)

    def test_bracket_origin_is_minimum_xyz_corner(self):
        mesh = self.library('l_bracket(width=30,height=20,depth=40,thickness=3,center=false);')
        np.testing.assert_allclose(mesh.bounds, [[0,0,0],[40,30,20]], atol=1e-5)

    def test_coplanar_face_union_is_watertight(self):
        mesh = self.render('union(){cube([10,10,5]); translate([0,0,5]) cube([10,10,5]);}')
        self.assertEqual(len(mesh.split()), 1)
        self.assertAlmostEqual(mesh.volume, 1000, places=4)

    def test_flush_and_extended_through_cuts_are_equivalent(self):
        meshes = [self.render(f'difference(){{cube([20,12,5],center=true); cylinder(d=6,h={height},center=true,$fn=32);}}')
                  for height in [5, 7]]
        self.assertAlmostEqual(meshes[0].volume, meshes[1].volume, places=6)
        self.assertEqual(len(meshes[0].faces), len(meshes[1].faces))
        np.testing.assert_allclose(meshes[0].bounds, meshes[1].bounds)
        for mesh in meshes:
            self.assertEqual(mesh.euler_number, 0)


if __name__ == '__main__':
    unittest.main()
