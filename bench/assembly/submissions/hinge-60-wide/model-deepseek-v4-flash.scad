$fn = 128;

agentscad_part = "all";
hinge_angle = 0;

pin_d = 6;
clearance = 0.45;
hole_d = pin_d + clearance;

sleeve_od = 12;
sleeve_h = 10;
pin_h = 24;

module fixed_part() {
    union() {
        cylinder(d = pin_d, h = pin_h, center = true);
        translate([20, 0, -8.5])
            cube([40, 24, 3], center = true);
    }
}

module moving_part() {
    difference() {
        union() {
            cylinder(d = sleeve_od, h = sleeve_h, center = true);
            translate([20, 0, 0])
                cube([40, 24, 3], center = true);
        }
        cylinder(d = hole_d, h = sleeve_h + 4, center = true);
    }
}

if (agentscad_part == "all" || agentscad_part == "fixed") {
    fixed_part();
}

if (agentscad_part == "all" || agentscad_part == "moving") {
    rotate([0, 0, hinge_angle])
        moving_part();
}
