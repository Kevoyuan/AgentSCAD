// Original external spur-gear pair fixture, millimetres.
// Two gears with a radial index tab; the tab is a measurement feature, not a
// claim about tooth contact, backlash, strength or manufacturing tolerance.
agentscad_part = "all";
agentscad_pose = false;
input_deg = 0;
ratio_sign = -1;

module_mm = 2;
pinion_teeth = 12;
wheel_teeth = 24;
thickness = 6;
center_distance = module_mm * (pinion_teeth + wheel_teeth) / 2;
pinion_pitch = module_mm * pinion_teeth / 2;
wheel_pitch = module_mm * wheel_teeth / 2;
addendum = module_mm;
dedendum = 1.25 * module_mm;
marker_min_r_mm = 0;
marker_max_r_mm = 0;

wheel_angle_deg = ratio_sign * input_deg * pinion_teeth / wheel_teeth;

module gear_outline(teeth, pitch_radius) {
  tip_radius = pitch_radius + addendum;
  root_radius = pitch_radius - dedendum;
  half_pitch_deg = 180 / teeth;
  tip_half_deg = 0.18 * 360 / teeth;
  points = [
    for (i = [0 : teeth - 1], k = [0 : 2])
      let (a = i * 360 / teeth + (k == 0 ? -half_pitch_deg : (k == 1 ? -tip_half_deg : tip_half_deg)),
           r = k == 0 ? root_radius : tip_radius)
      [r * cos(a), r * sin(a)]
  ];
  linear_extrude(height = thickness, center = true, convexity = 10)
    polygon(points = points);
}

module gear_body(teeth, pitch_radius) {
  root_r = pitch_radius - dedendum;
  tip_r = pitch_radius + addendum;
  // Radial index tab in a root gap (half a tooth pitch from the first tooth).
  // Its outer vertices are the only measurement feature outside the addendum.
  marker_angle = 180 / teeth;
  marker_outer_r = tip_r + 4;
  marker_inner_r = root_r - 0.5;
  difference() {
    union() {
      gear_outline(teeth, pitch_radius);
      rotate([0, 0, marker_angle])
        translate([(marker_inner_r + marker_outer_r) / 2, 0, 0])
          cube([marker_outer_r - marker_inner_r, 3, thickness], center = true);
    }
    cylinder(h = thickness + 2, r = 2, center = true, $fn = 32);
  }
}

module pinion_local() { gear_body(pinion_teeth, pinion_pitch); }
module wheel_local() { gear_body(wheel_teeth, wheel_pitch); }

module generated_part() {
  if (agentscad_part == "pinion") {
    pinion_local();
  } else if (agentscad_part == "wheel") {
    wheel_local();
  } else if (agentscad_part == "pinion_pose") {
    pinion_local();
  } else if (agentscad_part == "wheel_pose") {
    translate([center_distance, 0, 0])
      rotate([0, 0, wheel_angle_deg]) wheel_local();
  } else {
    pinion_local();
    translate([center_distance, 0, 0])
      rotate([0, 0, wheel_angle_deg]) wheel_local();
  }
}

generated_part();
