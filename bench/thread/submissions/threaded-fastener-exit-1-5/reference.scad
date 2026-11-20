// Original square-profile helical thread fastener, millimetres.
// Two parts: a hex-head bolt with a right-hand helical rib and a hex nut whose
// bore carries the matching rib. The thread form is a square profile built as a
// twisted extrusion, not an ISO metric profile, so no metric-thread claim is made.
// Only geometry is modelled: no torque, preload, strength, wear or self-locking.
agentscad_part = "all";
agentscad_pose = false;
turn_deg = 0;
// "none" is the real part. The other values are deliberate defects used to
// prove the checkers reject them; they are never a deliverable.
defect = "none";

pitch = 1.5;
major_r = 5.0;
minor_r = 4.1;
thread_len = 18;
rib_axial = 0.75;
clearance = 0.15;
nut_h = 6;
nut_outer_r = 9.815;
head_af = 16;
$fn = 64;

// OpenSCAD turns a positive twist clockwise, so a right-hand helix (phase
// rising with z) needs the negative sign on both parts.
bolt_twist = -360 * thread_len / pitch;
nut_twist = -360 * nut_h / pitch;
bolt_rib_sweep = 360 * rib_axial / pitch;
nut_rib_sweep = 360 * (pitch - rib_axial - 2 * clearance) / pitch;

// With the nut's bottom face at this height the nut rib sits centred in the
// bolt groove. The value was confirmed by translating the rendered nut along
// the axis and testing the two meshes: the collision-free band is 0.28 mm wide
// (0.46..0.74) and centred here, which is the designed 2*clearance of axial play.
nut_seat_z = pitch - rib_axial - clearance;

// The shank is one twisted extrusion of a single outline: a disc of radius
// minor_r with a rib sector fused to it. Extruding the union as one polygon
// avoids a CGAL boolean on ~36000 facets, which costs about 40 s here.
module shank_local() {
  linear_extrude(height = thread_len, twist = bolt_twist, slices = ceil(thread_len * 12), convexity = 12)
    polygon(concat(
      [for (i = [0 : 8]) let (a = bolt_rib_sweep * i / 8) [major_r * cos(a), major_r * sin(a)]],
      [[minor_r * cos(bolt_rib_sweep), minor_r * sin(bolt_rib_sweep)]],
      [for (i = [0 : 16]) let (a = bolt_rib_sweep + (360 - bolt_rib_sweep) * i / 16)
        [minor_r * cos(a), minor_r * sin(a)]]
    ));
}

// The head is emitted as its own shell that meets the shank at z = 0. A CGAL
// union of the two costs about 22 s at this facet count and changes no measured
// feature, so the two touching shells are kept and this limitation is recorded.
module bolt_local() {
  translate([0, 0, -6]) cylinder(r = head_af / sqrt(3), h = 6, $fn = 6);
  shank_local();
}

module nut_rib() {
  linear_extrude(height = nut_h, twist = nut_twist, slices = ceil(nut_h * 16), convexity = 12)
    polygon(concat(
      [for (i = [0 : 6]) let (a = nut_rib_sweep * i / 6)
        [(major_r + 0.6) * cos(a), (major_r + 0.6) * sin(a)]],
      [for (i = [6 : -1 : 0]) let (a = nut_rib_sweep * i / 6)
        [(minor_r + clearance) * cos(a), (minor_r + clearance) * sin(a)]]
    ));
}

module nut_local() {
  difference() {
    cylinder(r = nut_outer_r, h = nut_h, $fn = 6);
    // The bore is a plain cylinder with the helical rib put back: that leaves
    // the rib standing inside the bore instead of cutting it away.
    difference() {
      translate([0, 0, -0.1]) cylinder(r = major_r + clearance, h = nut_h + 0.2);
      if (defect != "plain-bore") nut_rib();
    }
  }
}

// Source-side construction. The checker measures the resulting meshes; it never
// consumes these expressions as evidence.
module selected_part(id, placed) {
  if (id == "bolt") bolt_local();
  if (id == "nut") translate([0, 0, nut_seat_z + (placed && defect != "spin-only" ? turn_deg / 360 * pitch : 0)])
    rotate([0, 0, placed ? turn_deg : 0]) nut_local();
}
module generated_part() {
  if (agentscad_part == "all") {
    for (id = ["bolt", "nut"]) selected_part(id, true);
  } else selected_part(agentscad_part, agentscad_pose);
}
generated_part();

/* AGENTSCAD_ASSEMBLY_V1
{
  "schemaVersion": 1,
  "units": "mm",
  "coordinateSystem": "right-handed",
  "parts": [
    {
      "id": "bolt",
      "name": "bolt",
      "selector": "bolt",
      "source": "generated",
      "material": null
    },
    {
      "id": "nut",
      "name": "nut",
      "selector": "nut",
      "source": "generated",
      "material": null
    }
  ],
  "instances": [
    {
      "id": "bolt",
      "partId": "bolt",
      "subassemblyId": null,
      "transform": [
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1
      ]
    },
    {
      "id": "nut",
      "partId": "nut",
      "subassemblyId": null,
      "transform": [
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1
      ]
    }
  ],
  "subassemblies": [],
  "groundedInstanceId": "bolt",
  "connections": [
    {
      "id": "thread",
      "type": "screw",
      "a": "bolt",
      "b": "nut",
      "frameA": {
        "origin": [
          0,
          0,
          0
        ],
        "direction": [
          0,
          0,
          1
        ]
      },
      "frameB": {
        "origin": [
          0,
          0,
          0
        ],
        "direction": [
          0,
          0,
          1
        ]
      },
      "range": null,
      "pitchMm": 1.5,
      "ratio": null,
      "allowedContact": []
    }
  ],
  "motions": [],
  "operations": [],
  "manufacturing": null,
  "assumptions": [
    "The declared assembled pose corresponds to turn_deg=0.",
    "The nut local mesh includes its 0.6 mm source offset."
  ],
  "unknowns": [
    "Thread handedness has no field in assembly schema v1 and is not declared here.",
    "Complete screw removal, torque, fit under manufacturing tolerance, and physical function have not been verified.",
    "The bolt contains two touching shells."
  ]
}
END_AGENTSCAD_ASSEMBLY */
