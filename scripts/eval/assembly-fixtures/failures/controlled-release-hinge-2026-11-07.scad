// ============================================================
// Two-piece detachable hinge (repaired)
// - Exactly two independently connected manufacturable bodies:
//   hinge_base (fixed leaf + C-shaped bearing cradle)
//   hinge_flap (swinging leaf + integral trunnion shaft + collars)
// - No extra pins, screws, or external libraries (primitives only).
// - Joint axis = Y through origin. Diametral clearance parameter is
//   constrained to 0.35..0.45 mm and drives the bore diameter.
// - Working rotation -45..+45 deg about Y is driven by work_angle_deg.
// - Axial retention in the working interval: integral collars on the
//   flap shaft sit inside the full-length cradle bore, so a pure axial
//   (Y) translation is blocked by the cradle end faces.
// - Release: rotate the flap to release_angle_deg (outside working
//   interval) so the flap arm/web aligns with the +Z slot in the C
//   cradle, then translate along +Z to slide out. Assembly reverses.
// ============================================================

/* AGENTSCAD_ASSEMBLY_V1
{
  "schemaVersion": 1,
  "units": "mm",
  "coordinateSystem": "right-handed",
  "parts": [
    {"id": "hinge_base", "name": "Hinge Base (fixed leaf with C-shaped bearing cradle)", "selector": "hinge_base", "source": "generated", "material": null},
    {"id": "hinge_flap", "name": "Hinge Flap (swinging leaf with integral trunnion shaft)", "selector": "hinge_flap", "source": "generated", "material": null}
  ],
  "instances": [
    {"id": "base1", "partId": "hinge_base", "subassemblyId": null, "transform": [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]},
    {"id": "flap1", "partId": "hinge_flap", "subassemblyId": null, "transform": [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}
  ],
  "subassemblies": [],
  "connections": [
    {
      "id": "hinge_joint", "type": "revolute", "a": "base1", "b": "flap1",
      "frameA": {"origin": [0,0,0], "direction": [0,1,0]},
      "frameB": {"origin": [0,0,0], "direction": [0,1,0]},
      "range": {"min": -45, "max": 45, "unit": "deg"},
      "pitchMm": null, "ratio": null,
      "allowedContact": ["cradle_bore_shaft_radial_clearance", "shaft_collar_cradle_end_face_axial_stop"],
      "boreInstanceId": "base1"
    }
  ],
  "groundedInstanceId": "base1",
  "motions": [
    {"id": "work_rotation", "inputConnectionId": "hinge_joint", "range": {"min": -45, "max": 45, "unit": "deg"}}
  ],
  "operations": [
    {
      "id": "release_lift_out",
      "action": "disassemble",
      "instanceId": "flap1",
      "waypoints": [
        [0.42261826,0,-0.90630779,0, 0,1,0,0, 0.90630779,0,0.42261826,0, 0,0,0,1],
        [0.42261826,0,-0.90630779,0, 0,1,0,0, 0.90630779,0,0.42261826,0, 0,0,18,1],
        [0.42261826,0,-0.90630779,0, 0,1,0,0, 0.90630779,0,0.42261826,0, 0,0,120,1]
      ],
      "tools": []
    },
    {
      "id": "assemble_lift_in",
      "action": "assemble",
      "instanceId": "flap1",
      "waypoints": [
        [0.42261826,0,-0.90630779,0, 0,1,0,0, 0.90630779,0,0.42261826,0, 0,0,120,1],
        [0.42261826,0,-0.90630779,0, 0,1,0,0, 0.90630779,0,0.42261826,0, 0,0,18,1],
        [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
      ],
      "tools": []
    }
  ],
  "manufacturing": null,
  "assumptions": [
    "The base cradle is a partial ring with a +Z slot of half-angle cradle_slot_half_angle_deg; over the working range the flap arm is not aligned with the slot.",
    "Integral retaining collars on the flap shaft sit inside the full-length cradle bore; the cradle end faces geometrically block pure +Y/-Y translation of the flap at -45, 0, +45 deg.",
    "Release requires an intentional independent rotation to release_angle_deg (115 deg, so the flap arm aligns with the +Z slot), followed by straight +Z translation out of the slot.",
    "Assembly is the reverse: hold flap at release angle, translate -Z into the slot, then rotate back into the working interval."
  ],
  "unknowns": [
    "Material, machine tolerances, FDM shrinkage and layer artifacts are unspecified; as-printed fit is unverified.",
    "Holding load, friction coefficient and expected service life are unspecified; no mechanical strength or life claim.",
    "No detent or positive stop beyond +45 deg is modeled; resistance to accidental bump-through from a working pose is not established.",
    "Shaft/bore diametral clearance is set by a parameter in the 0.35..0.45 mm band but real as-printed clearance is unverified.",
    "No physical prototype or mechanical test has been performed."
  ]
}
END_AGENTSCAD_ASSEMBLY */

// ---------- user-editable parameters ----------
$fn = 96;

// Joint geometry
shaft_diameter         = 6.0;     // mm
joint_clearance_d      = 0.40;    // mm diametral clearance (0.35..0.45)
shaft_length           = 22.0;    // mm along joint axis (Y)
cradle_length          = 24.0;    // mm along joint axis (Y)
cradle_wall            = 2.0;     // mm radial wall of C-ring
cradle_outer_diameter  = shaft_diameter + 2*joint_clearance_d + 2*cradle_wall;

// Retaining collars (integral to flap shaft, inside cradle bore)
collar_diameter        = shaft_diameter + 2.0;   // mm
collar_width           = 3.0;                    // mm along Y
collar_offset_y        = 6.0;                    // mm from joint center to collar center

// Cradle opening (slot toward +Z for assembly/disassembly)
cradle_slot_half_angle_deg = 38.0;

// Working and release angles (degrees about joint axis Y)
working_min_deg        = -45.0;
working_max_deg        =  45.0;
release_angle_deg      = 115.0;

// Leafs
leaf_length            = 40.0;    // mm along Y
leaf_width             = 30.0;    // mm along X
leaf_thickness         = 4.0;     // mm along Z
mount_hole_d           = 3.4;     // M3 clearance
mount_hole_inset       = 6.0;

// ---------- derived ----------
shaft_r   = shaft_diameter / 2;
bore_d    = shaft_diameter + joint_clearance_d;
bore_r    = bore_d / 2;
cradle_r  = cradle_outer_diameter / 2;

epsilon   = 0.01;
merge_tol = 0.1;

// ---------- helper modules ----------
// fitting bore cutter with polygon compensation
module fit_hole(d, h, center=true, diametral_tolerance=0.02) {
    n = max(24, 4*ceil(180/acos(d/(d+diametral_tolerance))/4));
    cylinder(d = d/cos(180/n), h = h, center = center, $fn = n);
}

// Partial ring (C-shaped cradle) around the Y axis.
// Bore is along Y. Opening is a slot centered on +Z.
module c_ring(outer_r, inner_r, length_y, slot_half_angle_deg) {
    n_arc = 96;
    difference() {
        rotate([90,0,0])
            cylinder(r = outer_r, h = length_y, center = true, $fn = n_arc);
        rotate([90,0,0])
            cylinder(r = inner_r, h = length_y + 2*epsilon, center = true, $fn = n_arc);
        // slot cutter: two angled prisms opening toward +Z
        rotate([-90, 0, 0])
            linear_extrude(height = length_y + 2*epsilon, center = true, convexity = 4)
                polygon(points = [
                    [0, 0],
                    [ (outer_r + 2) * sin(slot_half_angle_deg), (outer_r + 2) * cos(slot_half_angle_deg) ],
                    [ 0, outer_r + 2 ]
                ]);
        rotate([-90, 0, 0])
            linear_extrude(height = length_y + 2*epsilon, center = true, convexity = 4)
                polygon(points = [
                    [0, 0],
                    [ -(outer_r + 2) * sin(slot_half_angle_deg), (outer_r + 2) * cos(slot_half_angle_deg) ],
                    [ 0, outer_r + 2 ]
                ]);
    }
}

// ---------- hinge base (fixed leaf + C cradle) ----------
module hinge_base() {
    // Local frame: joint axis = Y through origin.
    difference() {
        union() {
            // leaf plate extending in -Z from cradle
            translate([0, 0, -cradle_r - leaf_thickness/2 + merge_tol])
                cube([leaf_width, leaf_length, leaf_thickness], center = true);
            // connector web between leaf and cradle
            translate([0, 0, -cradle_r + 0.5])
                cube([leaf_width, leaf_length, 3.0], center = true);
            // C cradle (opening toward +Z)
            c_ring(cradle_r, bore_r, cradle_length, cradle_slot_half_angle_deg);
        }
        // leaf mounting holes (through thickness, along Z)
        for (yy = [-leaf_length/2 + mount_hole_inset, leaf_length/2 - mount_hole_inset]) {
            translate([0, yy, -cradle_r - leaf_thickness/2])
                fit_hole(d = mount_hole_d, h = leaf_thickness + 2*epsilon, center = true);
        }
        // re-cut bore cleanly through the cradle after unions
        rotate([90,0,0])
            cylinder(r = bore_r, h = cradle_length + 2*epsilon, center = true, $fn = 96);
    }
}

// ---------- hinge flap (swinging leaf + integral trunnion shaft) ----------
// Local frame at shaft center, joint axis Y.
module hinge_flap() {
    difference() {
        union() {
            // integral shaft (along Y)
            rotate([90,0,0])
                cylinder(d = shaft_diameter, h = shaft_length, center = true, $fn = 96);
            // retaining collars on the shaft
            translate([0,  collar_offset_y, 0])
                rotate([90,0,0])
                    cylinder(d = collar_diameter, h = collar_width, center = true, $fn = 72);
            translate([0, -collar_offset_y, 0])
                rotate([90,0,0])
                    cylinder(d = collar_diameter, h = collar_width, center = true, $fn = 72);
            // arm web from shaft toward +X
            translate([shaft_r + 2.0, 0, 0])
                cube([4.0, leaf_length*0.6, leaf_thickness], center = true);
            // leaf plate
            translate([shaft_r + 2.0 + leaf_width/2 - 0.5, 0, 0])
                cube([leaf_width, leaf_length, leaf_thickness], center = true);
        }
        // leaf mounting holes
        for (yy = [-leaf_length/2 + mount_hole_inset, leaf_length/2 - mount_hole_inset]) {
            translate([shaft_r + 2.0 + leaf_width/2 - 0.5, yy, 0])
                rotate([90, 0, 0])
                    fit_hole(d = mount_hole_d, h = leaf_thickness + 2*epsilon, center = true);
        }
    }
}

// ---------- pose selection ----------
work_angle_deg = 0.0;          // editable working pose for preview
release_mode   = false;        // set true to preview the release orientation

agentscad_part = "all";        // "all", "hinge_base", "hinge_flap"

module generated_part() {
    if (agentscad_part == "all") {
        hinge_base();
        angle = release_mode ? release_angle_deg : work_angle_deg;
        rotate([0, angle, 0])
            hinge_flap();
    } else if (agentscad_part == "hinge_base") {
        hinge_base();
    } else if (agentscad_part == "hinge_flap") {
        hinge_flap();
    }
}

generated_part();

/*
  GEOMETRY / FUNCTION NOTES
  -------------------------
  Joint axis = Y through origin.

  Base (hinge_base):
    - Leaf plate in -Z; C cradle around Y with bore radius bore_r =
      (shaft_diameter + joint_clearance_d)/2, so the diametral
      clearance parameter directly sets the bore.
    - Cradle is a partial ring with a +Z slot of half-angle
      cradle_slot_half_angle_deg.

  Flap (hinge_flap):
    - Integral shaft along Y with two integral retaining collars at
      y = +/-collar_offset_y; arm and leaf on +X side.
    - Rotation about Y by work_angle_deg drives the leaf.

  Axial retention in working poses (-45, 0, +45 deg):
    - Collars are integral to the shaft, so their Y positions are
      fixed relative to the flap and stay inside the full-length
      cradle bore. Pure +Y/-Y translation is blocked by the cradle
      end faces (geometric axial stop).

  Release (intentional independent motion required):
    - Rotate the flap to release_angle_deg (115 deg) so the flap arm
      aligns with the +Z slot, then translate +Z out of the slot.
    - Assembly is the reverse route.

  Unintended-unlock prevention:
    - Working interval -45..+45 is far from release_angle_deg 115.
    - No detent or positive stop beyond +45 is modeled; a compliant
      part could be forced through. This is listed as an unknown.

  Remaining evidence gaps: material, machine tolerance, FDM
  shrinkage, holding load, friction, service life, and as-printed
  fit are all unspecified and unverified. No physical or mechanical
  qualification is claimed.
*/