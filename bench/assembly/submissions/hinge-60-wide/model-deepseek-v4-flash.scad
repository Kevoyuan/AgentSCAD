$fn = 64;

agentscad_part = "all";
hinge_angle = 0;

pin_d = 6;
bore_clearance = 0.50;
bore_d = pin_d + bore_clearance;

module fixed_part() {
    union() {
        translate([0, 0, 13]) cylinder(h = 30, d = pin_d, center = true);
        translate([15, 0, 0]) cube([30, 12, 4], center = true);
    }
}

module moving_shape() {
    difference() {
        union() {
            translate([0, 0, 14]) cylinder(h = 16, d = 11, center = true);
            translate([17, 0, 10]) cube([24, 12, 4], center = true);
        }
        translate([0, 0, 14]) cylinder(h = 20, d = bore_d, center = true);
    }
}

module moving_part() {
    rotate([0, 0, hinge_angle]) moving_shape();
}

if (agentscad_part == "all" || agentscad_part == "fixed") fixed_part();
if (agentscad_part == "all" || agentscad_part == "moving") moving_part();
