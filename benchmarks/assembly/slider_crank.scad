// Original low-speed slider-crank verification fixture, millimetres.
// Four manufacturing parts. Pins are integral; external axial retention is
// required. No load capacity, print tolerance or physical function is claimed.
agentscad_part = "all";
agentscad_pose = false;
motion_angle = 0;
crank_radius = 8;
rod_length = 28;
$fn = 64;

// All pin axes are parallel to +Y; the mechanism moves in the XZ plane.
module y_cylinder(radius, height) { rotate([-90, 0, 0]) cylinder(r=radius, h=height); }
module crank_local() {
  union() {
    translate([0, -4, 0]) y_cylinder(crank_radius + 3, 4);
    translate([0, -9, 0]) y_cylinder(2, 5.1);
    translate([0, -0.1, crank_radius]) y_cylinder(2, 6.1);
  }
}
module rod_local() {
  difference() {
    hull() {
      translate([0, 1, 0]) y_cylinder(4, 3);
      translate([0, 1, rod_length]) y_cylinder(4, 3);
    }
    translate([0, 0.9, 0]) y_cylinder(2.2, 3.2);
    translate([0, 0.9, rod_length]) y_cylinder(2.2, 3.2);
  }
}
module slider_local() {
  union() {
    translate([-5, 5, -5]) cube([10, 4, 10]);
    y_cylinder(2, 5.1);
  }
}
module frame_local() {
  union() {
    difference() {
      translate([-14, -10, -14]) cube([28, 4, 58]);
      translate([0, -10.1, 0]) y_cylinder(2.2, 4.2);
    }
    for (x = [-9, 5.4]) {
      translate([x, 5, 14]) cube([3.6, 4, 30]);
      translate([x, -6.1, 42]) cube([3.6, 11.2, 2]);
    }
  }
}

// Source-side construction. The checker measures the resulting mesh contours;
// it never consumes these functions or their computed coordinates as evidence.
cx = crank_radius * sin(motion_angle);
cz = crank_radius * cos(motion_angle);
travel = sqrt(rod_length * rod_length - cx * cx);
pz = cz + travel;
rod_angle = atan2(-cx, travel);
module selected_part(id, placed) {
  if (id == "frame") frame_local();
  if (id == "crank") rotate([0, placed ? motion_angle : 0, 0]) crank_local();
  if (id == "rod") translate(placed ? [cx, 0, cz] : [0, 0, 0])
    rotate([0, placed ? rod_angle : 0, 0]) rod_local();
  if (id == "slider") translate([0, 0, placed ? pz : 0]) slider_local();
}
module generated_part() {
  if (agentscad_part == "all") {
    for (id = ["frame", "crank", "rod", "slider"]) selected_part(id, true);
  } else selected_part(agentscad_part, agentscad_pose);
}
generated_part();
