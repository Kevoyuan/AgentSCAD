agentscad_part = "all";
hinge_angle = 0;

$fn = 64;

module fixed_part() {
    union() {
        // Pin, diameter 6 mm, axis Z through origin
        cylinder(h = 20, r = 3, center = false);
        // Fixed leaf
        translate([-30, -6, 0]) cube([35, 12, 3]);
    }
}

module moving_part() {
    rotate([0, 0, hinge_angle]) {
        union() {
            // Hinge boss with bore diameter 6.4 mm (0.4 mm diametral clearance)
            translate([0, 0, 6]) difference() {
                cylinder(h = 6, r = 6, center = false);
                translate([0, 0, -0.1]) cylinder(h = 6.2, r = 3.2, center = false);
            }
            // Moving leaf
            translate([5, -6, 6]) cube([25, 12, 3]);
        }
    }
}

if (agentscad_part == "all" || agentscad_part == "fixed") fixed_part();
if (agentscad_part == "all" || agentscad_part == "moving") moving_part();
