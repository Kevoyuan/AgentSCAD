agentscad_part = "all";
hinge_angle = 0;

pin_d = 6;
hole_d = 6.25;
sleeve_od = 12;

$fn = 64;

module fixed() {
    union() {
        translate([0, 0, -12])
            cylinder(h = 24, d = pin_d, $fn = 64);

        translate([-30, -8, -12])
            cube([30, 16, 8]);
    }
}

module moving() {
    rotate([0, 0, hinge_angle]) {
        difference() {
            union() {
                translate([0, 0, -3])
                    cylinder(h = 10, d = sleeve_od, $fn = 64);

                translate([3, -8, -3])
                    cube([30, 16, 6]);
            }

            translate([0, 0, -4])
                cylinder(h = 12, d = hole_d, $fn = 64);
        }
    }
}

if (agentscad_part == "all" || agentscad_part == "fixed") fixed();
if (agentscad_part == "all" || agentscad_part == "moving") moving();
