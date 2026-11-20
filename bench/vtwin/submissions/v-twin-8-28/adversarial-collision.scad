// Original 90-degree V-twin kinematic fixture, millimetres.
// One crankpin at the origin drives two rods whose cylinder axes are +45 and
// -45 degrees from vertical in the XZ plane. The rods sit side by side in Y.
// This is a V-angle cross-section demonstrator; it is not a complete V8 and
// makes no combustion, load, lubrication or manufacturing claim.
agentscad_part = "all";
agentscad_pose = false;
crank_angle = 0;
$fn = 32;

crank_radius = 8;
rod_length = 28;
half_angle = 45;
y_left = -10;
y_right = 10;
rod_y_left = -12;
rod_y_right = 12;
tube_bore = 10;
tube_outer = 14;
tube_bottom = 14;
tube_top = 56;
piston_length = 14;
piston_radius = 9.75;

ux = sin(half_angle);
uz = cos(half_angle);
px = crank_radius * sin(crank_angle);
pz = crank_radius * cos(crank_angle);
// Slider travel along a cylinder axis (sx = +ux for left, -ux for right).
function slider_travel(sx) = px * sx + pz * uz + sqrt(rod_length * rod_length - (px * px + pz * pz - pow(px * sx + pz * uz, 2)));
function rod_phi(sx) = atan2(slider_travel(sx) * sx - px, slider_travel(sx) * uz - pz);

module tube_at(y, sx) {
  translate([0, y, 0]) rotate([0, atan2(sx, uz), 0]) {
    translate([0, 0, (tube_bottom + tube_top) / 2])
      difference() {
        cylinder(h = tube_top - tube_bottom, r = tube_outer, center = true);
        cylinder(h = tube_top - tube_bottom + 2, r = tube_bore, center = true);
      }
  }
}

module frame_part() {
  union() {
    tube_at(y_left, ux);
    tube_at(y_right, -ux);
    // Base below the moving envelope; the two guide tubes are the collision
    // obstacles that matter for this kinematic cross-section.
    translate([0, 0, -20]) cube([32, 24, 3], center = true);
  }
}
module crank_local() {
  union() {
    rotate([90, 0, 0]) cylinder(h = 16, r = 2, center = true);
    rotate([90, 0, 0]) cylinder(h = 1.5, r = 11, center = true);
    translate([0, 0, crank_radius]) rotate([90, 0, 0]) cylinder(h = 28, r = 2, center = true);
  }
}
module crank_pose() { rotate([0, crank_angle, 0]) crank_local(); }

module rod_local() {
  difference() {
    hull() {
      translate([0, 0, 0]) rotate([90, 0, 0]) cylinder(h = 4, r = 4, center = true);
      translate([0, 0, rod_length]) rotate([90, 0, 0]) cylinder(h = 4, r = 3, center = true);
    }
    translate([0, 0, 0]) rotate([90, 0, 0]) cylinder(h = 6, r = 2.2, center = true);
  }
  translate([0, 0, rod_length]) rotate([90, 0, 0]) cylinder(h = 12, r = 2, center = true);
}
module slider_local() {
  difference() {
    cylinder(h = piston_length, r = piston_radius, center = true);
    rotate([90, 0, 0]) cylinder(h = 20, r = 2.2, center = true);
    translate([0, 2, -6]) cylinder(h = 4, r = 7, center = true);
    translate([0, 2, 0]) cylinder(h = 8, r = 5.5, center = true);
    translate([0, -2, -6]) cylinder(h = 4, r = 7, center = true);
    translate([0, -2, 0]) cylinder(h = 8, r = 5.5, center = true);
  }
}
module rod_left_pose() {
  translate([px, rod_y_left, pz]) rotate([0, rod_phi(ux), 0]) rod_local();
}
module rod_right_pose() {
  translate([px, rod_y_right, pz]) rotate([0, rod_phi(-ux), 0]) rod_local();
}
module slider_left_pose() {
  translate([slider_travel(ux) * ux, y_left, slider_travel(ux) * uz])
    rotate([0, atan2(ux, uz), 0]) slider_local();
}
module slider_right_pose() {
  translate([slider_travel(-ux) * -ux, y_left, slider_travel(-ux) * uz])
    rotate([0, atan2(-ux, uz), 0]) slider_local();
}

module posed_assembly() {
  frame_part(); crank_pose(); rod_left_pose(); rod_right_pose(); slider_left_pose(); slider_right_pose();
}
module generated_part() {
  if (agentscad_part == "frame") frame_part();
  else if (agentscad_part == "crank_pose") crank_pose();
  else if (agentscad_part == "rod_left_pose") rod_left_pose();
  else if (agentscad_part == "rod_right_pose") rod_right_pose();
  else if (agentscad_part == "slider_left_pose") slider_left_pose();
  else if (agentscad_part == "slider_right_pose") slider_right_pose();
  else posed_assembly();
}
generated_part();
