// Original inline two-cylinder piston fixture, millimetres.
// Crank axis is Y; the two cylinders are separated along Y at -20 and +20 mm.
// The right crank throw is 180 degrees from the left. This is a kinematic
// demonstrator; no combustion, load, lubrication or manufacturing claim.
agentscad_part = "all";
agentscad_pose = false;
crank_angle = 0;
$fn = 32;

crank_radius = 8;
rod_length = 28;
y_left = -25;
y_right = 25;
rod_y_left = -27;
rod_y_right = 27;
tube_bore = 10;
tube_outer = 14;
tube_bottom = 12;
tube_top = 56;
piston_length = 14;
piston_radius = 9.75;

function px(a) = crank_radius * sin(a);
function pz(a) = crank_radius * cos(a);
function rod_alpha(a) = -asin(crank_radius * sin(a) / rod_length);
function wz(a) = pz(a) + rod_length * cos(rod_alpha(a));

module frame_part() {
  union() {
    for (y = [y_left, y_right]) {
      translate([0, y, (tube_bottom + tube_top) / 2])
        difference() {
          cylinder(h = tube_top - tube_bottom, r = tube_outer, center = true);
          cylinder(h = tube_top - tube_bottom + 2, r = tube_bore, center = true);
        }
    }
    // Base below the crank throws.
    translate([0, 0, -14]) cube([32, 62, 3], center = true);
    // Vertical supports at x = +/-14.5, clear of the rod sweep.
    for (x = [-14.5, 14.5]) for (y = [y_left, y_right])
      translate([x, y, -0.5]) cube([3, 4, 26], center = true);
    // Central bearing plate for the Y-axis crank shaft.
    translate([0, 0, 0])
      difference() {
        cube([32, 3, 32], center = true);
        rotate([90, 0, 0]) cylinder(h = 5, r = 2.2, center = true);
      }
  }
}

module crank_local() {
  union() {
    // Main shaft along Y.
    rotate([90, 0, 0]) cylinder(h = 45, r = 2, center = true);
    // Left throw at y = -22.5, phase 0.
    translate([0, -22.5, 0]) rotate([90, 0, 0]) cylinder(h = 4, r = 11, center = true);
    translate([0, -22.5, crank_radius]) rotate([90, 0, 0]) cylinder(h = 12, r = 2, center = true);
    // Right throw at y = +22.5, phase 180.
    translate([0, 22.5, 0]) rotate([90, 0, 0]) cylinder(h = 4, r = 11, center = true);
    translate([0, 22.5, -crank_radius]) rotate([90, 0, 0]) cylinder(h = 12, r = 2, center = true);
  }
}

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

module crank_pose() { rotate([0, crank_angle, 0]) crank_local(); }
module rod_left_pose() {
  translate([px(crank_angle), rod_y_left, pz(crank_angle)])
    rotate([0, rod_alpha(crank_angle), 0]) rod_local();
}
module rod_right_pose() {
  translate([px(crank_angle + 180), rod_y_right, pz(crank_angle + 180)])
    rotate([0, rod_alpha(crank_angle + 180), 0]) rod_local();
}
module slider_left_pose() { translate([0, y_left, wz(crank_angle)]) slider_local(); }
module slider_right_pose() { translate([0, y_right, wz(crank_angle + 180)]) slider_local(); }

module posed_assembly() {
  frame_part();
  crank_pose();
  rod_left_pose();
  rod_right_pose();
  slider_left_pose();
  slider_right_pose();
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
