agentscad_part = "all";
hinge_angle = 0;

pin_d = 6;
clearance = 0.25;
pin_r = pin_d / 2;
hole_d = pin_d + clearance;
hole_r = hole_d / 2;
bushing_outer_r = 8;
bushing_z0 = -2;
bushing_z1 = 6;
bushing_h = bushing_z1 - bushing_z0;
moving_leaf_z0 = 0;
moving_leaf_z1 = 4;
moving_leaf_thickness = moving_leaf_z1 - moving_leaf_z0;
fixed_leaf_z0 = -8;
fixed_leaf_z1 = -4;
fixed_leaf_thickness = fixed_leaf_z1 - fixed_leaf_z0;
pin_z0 = -8;
pin_z1 = 8;
pin_h = pin_z1 - pin_z0;
$fn = 72;

module fixed_part() {
    union() {
        translate([0, 0, pin_z0]) cylinder(h = pin_h, r = pin_r, $fn = 72);
        translate([-40, -10, fixed_leaf_z0]) cube([48, 20, fixed_leaf_thickness]);
    }
}

module moving_part_local() {
    difference() {
        union() {
            translate([0, 0, bushing_z0]) cylinder(h = bushing_h, r = bushing_outer_r, $fn = 72);
            translate([6, -10, moving_leaf_z0]) cube([34, 20, moving_leaf_thickness]);
        }
        translate([0, 0, bushing_z0 - 0.01]) cylinder(h = bushing_h + 0.02, r = hole_r, $fn = 72);
    }
}

module moving_part() {
    rotate([0, 0, hinge_angle]) moving_part_local();
}

if (agentscad_part == "all" || agentscad_part == "fixed") fixed_part();
if (agentscad_part == "all" || agentscad_part == "moving") moving_part();
