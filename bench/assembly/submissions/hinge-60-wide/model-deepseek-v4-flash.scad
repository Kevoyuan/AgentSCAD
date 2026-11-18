agentscad_part = "all";
hinge_angle = 0;

$fn = 64;

pin_d = 6;
bore_clearance = 0.45;
bore_d = pin_d + bore_clearance;

module fixed_part() {
    translate([0, 0, -10])
        cylinder(h = 20, d = pin_d, center = false);

    translate([0, -12, -10])
        cube([30, 24, 3]);
}

module moving_part() {
    rotate([0, 0, hinge_angle]) {
        difference() {
            union() {
                translate([0, 0, -3])
                    cylinder(h = 8, d = 12, center = false);

                translate([5, -12, 1])
                    cube([30, 24, 3]);
            }

            translate([0, 0, -3.1])
                cylinder(h = 8.2, d = bore_d, center = false);
        }
    }
}

if (agentscad_part == "all" || agentscad_part == "fixed")
    fixed_part();

if (agentscad_part == "all" || agentscad_part == "moving")
    moving_part();
