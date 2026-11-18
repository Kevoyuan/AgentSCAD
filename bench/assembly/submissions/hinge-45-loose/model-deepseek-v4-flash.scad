agentscad_part = "all";
hinge_angle = 0;

$fn = 100;

module fixed_part() {
    union() {
        translate([-5, -12, -10]) cube([35, 24, 6]);
        translate([0, 0, -6]) cylinder(h = 16, d = 6);
    }
}

module moving_part() {
    difference() {
        union() {
            cylinder(h = 10, d = 10);
            translate([-12, 4, 0]) cube([24, 26, 4]);
        }
        translate([0, 0, -0.1]) cylinder(h = 10.2, d = 6.4);
    }
}

if (agentscad_part == "all" || agentscad_part == "fixed") {
    fixed_part();
}

if (agentscad_part == "all" || agentscad_part == "moving") {
    rotate([0, 0, hinge_angle]) moving_part();
}
