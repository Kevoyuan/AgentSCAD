$fn = 96;

agentscad_part = "all";
hinge_angle = 0;

pin_d = 6;
bore_d = 6.4;
pin_bottom = -2;
pin_top = 11;
base_thickness = 2;
head_bottom = 9;
head_thickness = 2;
knuckle_bottom = 0.5;
knuckle_height = 8;
knuckle_outer_d = 12;

module fixed_part() {
    union() {
        translate([0, 0, pin_bottom])
            cylinder(h = pin_top - pin_bottom, d = pin_d);
        translate([0, 0, -base_thickness])
            cylinder(h = base_thickness, d = knuckle_outer_d);
        translate([0, 0, head_bottom])
            cylinder(h = head_thickness, d = knuckle_outer_d);
        translate([-36, -5, -base_thickness])
            cube([32, 10, base_thickness]);
    }
}

module moving_part() {
    rotate([0, 0, hinge_angle]) {
        difference() {
            union() {
                translate([0, 0, knuckle_bottom])
                    cylinder(h = knuckle_height, d = knuckle_outer_d);
                translate([4, -5, 2.5])
                    cube([32, 10, 4]);
            }
            translate([0, 0, 0])
                cylinder(h = 9, d = bore_d);
        }
    }
}

if (agentscad_part == "all" || agentscad_part == "fixed")
    fixed_part();
if (agentscad_part == "all" || agentscad_part == "moving")
    moving_part();
