agentscad_part = "all";
hinge_angle = 0;

$fn = 96;

pin_d = 6;
pin_r = pin_d / 2;
clearance_d = 0.25;
bore_r = (pin_d + clearance_d) / 2;
knuckle_r = 6;
knuckle_h = 6;
knuckle_z0 = 2;
leaf_y = 8;

module fixed() {
    union() {
        translate([0, 0, -12])
            cylinder(h = 24, r = pin_r, center = false);
        translate([-20, -leaf_y, -8])
            cube([18, 2 * leaf_y, 4]);
    }
}

module moving() {
    rotate([0, 0, hinge_angle]) {
        difference() {
            union() {
                translate([0, 0, knuckle_z0])
                    cylinder(h = knuckle_h, r = knuckle_r, center = false);
                translate([4, -leaf_y, 3])
                    cube([18, 2 * leaf_y, 4]);
            }
            translate([0, 0, knuckle_z0 - 0.1])
                cylinder(h = knuckle_h + 0.2, r = bore_r, center = false);
        }
    }
}

if (agentscad_part == "all" || agentscad_part == "fixed") fixed();
if (agentscad_part == "all" || agentscad_part == "moving") moving();
