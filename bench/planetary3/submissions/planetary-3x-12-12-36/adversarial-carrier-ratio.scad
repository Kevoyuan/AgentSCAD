// Original epicyclic gear fixture, millimetres.
// Fixed internal ring, sun input, one planet measured through a carrier output.
// The radial tabs and central bores are measurement features. This fixture is a
// kinematic demonstrator: tooth contact, backlash, load, efficiency and physical
// manufacture are not claimed by the measurement module.
agentscad_part = "all";
agentscad_pose = false;
input_deg = 0;

module_mm = 2;
sun_teeth = 12;
planet_teeth = 12;
ring_teeth = 36;
thickness = 6;
sun_pitch = module_mm * sun_teeth / 2;
planet_pitch = module_mm * planet_teeth / 2;
ring_pitch = module_mm * ring_teeth / 2;
carrier_radius = module_mm * (sun_teeth + planet_teeth) / 2;
addendum = module_mm;
dedendum = 1.25 * module_mm;
carrier_z = -thickness / 2 - 1;

sun_angle = input_deg;
carrier_angle = input_deg;
// Fixed ring, sun input, carrier output. Positive input gives a negative
// absolute planet rotation for this tooth set.
planet_angle = carrier_angle * (1 + sun_teeth / planet_teeth)
  - input_deg * sun_teeth / planet_teeth;

// Straight-sided full-depth tooth. The marker sits in a root gap so it cannot
// merge with a tooth in the radial profile measurement.
module external_gear(teeth, pitch_radius, bore_radius) {
  tip_r = pitch_radius + addendum;
  root_r = pitch_radius - dedendum;
  half_tooth = 0.22 * 180 / teeth;
  marker_angle = 180 / teeth;
  marker_inner_r = root_r - 0.5;
  marker_outer_r = tip_r + 4;
  marker_half = atan(1.5 / marker_outer_r);
  // Five points along the tip arc and five along the root arc per tooth, so
  // the measured radii are not the chord minima of a four-point polygon.
  points = [
    for (i = [0 : teeth - 1], k = [0 : 9])
      let (local = k < 5
            ? -half_tooth + 2 * half_tooth * k / 4
            : half_tooth + (360 / teeth - 2 * half_tooth) * (k - 5) / 4,
           a = i * 360 / teeth + local,
           r = k < 5 ? tip_r : root_r)
      [r * cos(a), r * sin(a)]
  ];
  difference() {
    union() {
      linear_extrude(height = thickness, center = true, convexity = 10)
        polygon(points = points);
      // A radial wedge, not a rectangular cube: the sides stay radial, so
      // they cannot create phantom tip-radius intervals at other angles.
      rotate([0, 0, marker_angle])
        linear_extrude(height = thickness, center = true, convexity = 10)
          polygon(points = concat(
            [[marker_inner_r * cos(-marker_half), marker_inner_r * sin(-marker_half)]],
            [for (j = [0 : 4]) let (a = -marker_half + 2 * marker_half * j / 4)
              [marker_outer_r * cos(a), marker_outer_r * sin(a)]],
            [[marker_inner_r * cos(marker_half), marker_inner_r * sin(marker_half)]]
          ));
    }
    cylinder(h = thickness + 2, r = bore_radius, center = true, $fn = 32);
  }
}

// Internal ring teeth point inward. The thin wedge between the two tip points
// is material; the wide outer land between teeth is the root gap.
module internal_ring(teeth, pitch_radius, outer_radius) {
  tip_r = pitch_radius - addendum;
  root_r = pitch_radius + dedendum;
  half_tooth = 0.22 * 180 / teeth;
  // Five points along the tip arc and five along the root arc per tooth, so
  // the measured radii are not the chord minima of a four-point polygon.
  points = [
    for (i = [0 : teeth - 1], k = [0 : 9])
      let (local = k < 5
            ? -half_tooth + 2 * half_tooth * k / 4
            : half_tooth + (360 / teeth - 2 * half_tooth) * (k - 5) / 4,
           a = i * 360 / teeth + local,
           r = k < 5 ? tip_r : root_r)
      [r * cos(a), r * sin(a)]
  ];
  difference() {
    cylinder(h = thickness, r = outer_radius, center = true, $fn = 128);
    linear_extrude(height = thickness + 2, center = true, convexity = 10)
      polygon(points = points);
  }
}

module sun_local() { external_gear(sun_teeth, sun_pitch, 3); }
module planet_local() { external_gear(planet_teeth, planet_pitch, 2); }
module ring_local() { internal_ring(ring_teeth, ring_pitch, 45); }

module carrier_local() {
  difference() {
    union() {
      cylinder(h = thickness, r = 8, center = true, $fn = 64);
      for (i = [0 : 2]) rotate([0, 0, i * 120])
        translate([12, 0, 0]) cube([24, 6, thickness], center = true);
      // Carrier marker at 60°, between two arms.
      rotate([0, 0, 60]) translate([10, 0, 0])
        cube([5, 3, thickness], center = true);
    }
    cylinder(h = thickness + 2, r = 3, center = true, $fn = 32);
  }
}

module generated_part() {
  if (agentscad_part == "sun_pose") {
    rotate([0, 0, sun_angle]) sun_local();
  } else if (agentscad_part == "planet0_pose") {
    a = carrier_angle + 0;
    translate([carrier_radius * cos(a), carrier_radius * sin(a), 0]) rotate([0, 0, planet_angle]) planet_local();
  } else if (agentscad_part == "planet1_pose") {
    a = carrier_angle + 120;
    translate([carrier_radius * cos(a), carrier_radius * sin(a), 0]) rotate([0, 0, planet_angle]) planet_local();
  } else if (agentscad_part == "planet2_pose") {
    a = carrier_angle + 240;
    translate([carrier_radius * cos(a), carrier_radius * sin(a), 0]) rotate([0, 0, planet_angle]) planet_local();
  } else if (agentscad_part == "carrier_pose") {
    translate([0, 0, carrier_z]) rotate([0, 0, carrier_angle]) carrier_local();
  } else if (agentscad_part == "ring") {
    ring_local();
  } else {
    ring_local();
    rotate([0, 0, sun_angle]) sun_local();
    for (i = [0 : 2]) {
      a = carrier_angle + i * 120;
      translate([carrier_radius * cos(a), carrier_radius * sin(a), 0]) rotate([0, 0, planet_angle]) planet_local();
    }
    translate([0, 0, carrier_z]) rotate([0, 0, carrier_angle]) carrier_local();
  }
}
generated_part();
