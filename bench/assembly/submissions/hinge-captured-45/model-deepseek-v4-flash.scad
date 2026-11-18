agentscad_part = "all";
hinge_angle = 0;
$fn = 96;

module fixed_part() {
    union() {
        translate([0, 0, -9])
            cylinder(h = 2.5, r = 10);

        translate([0, 0, -9])
            cylinder(h = 16, r = 3);

        translate([0, 0, 6.5])
            cylinder(h = 2.5, r = 5.5);
    }
}

module moving_part() {
    rotate([0, 0, hinge_angle]) {
        difference() {
            union() {
                cylinder(h = 12, r = 6.2, center = true);
                translate([4, -6, -3])
                    cube([36, 12, 6]);
            }
            cylinder(h = 14, r = 3.2, center = true);
        }
    }
}

if (agentscad_part == "all" || agentscad_part == "fixed")
    fixed_part();

if (agentscad_part == "all" || agentscad_part == "moving")
    moving_part();
