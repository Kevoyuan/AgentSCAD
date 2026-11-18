$fn = 64;

agentscad_part = "all";
hinge_angle = 0;

pin_d = 6;
pin_r = pin_d / 2;
clearance = 0.4;
hole_r = (pin_d + clearance) / 2;
pin_h = 24;
pin_z0 = -12;
bushing_outer_r = 6;
bushing_h = 6;
bushing_z0 = -3;
moving_leaf_thickness = 3;
moving_leaf_z0 = -1.5;
fixed_leaf_thickness = 4;
fixed_leaf_z0 = -12;

module fixed_part() {
    union() {
        translate([0, 0, pin_z0])
            cylinder(h = pin_h, r = pin_r, center = false);
        translate([-3, -10, fixed_leaf_z0])
            cube([33, 20, fixed_leaf_thickness]);
    }
}

module moving_part() {
    rotate([0, 0, hinge_angle])
    union() {
        translate([0, 0, bushing_z0])
            difference() {
                cylinder(h = bushing_h, r = bushing_outer_r, center = false);
                translate([0, 0, -0.01])
                    cylinder(h = bushing_h + 0.02, r = hole_r, center = false);
            }
        translate([-30, -10, moving_leaf_z0])
            cube([26, 20, moving_leaf_thickness]);
    }
}

if (agentscad_part == "all" || agentscad_part == "fixed") fixed_part();
if (agentscad_part == "all" || agentscad_part == "moving") moving_part();
