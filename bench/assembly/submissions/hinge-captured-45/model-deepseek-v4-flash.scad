agentscad_part = "all";
hinge_angle = 0;

$fn = 72;

pin_d = 6.0;
pin_r = pin_d / 2;
hole_d = pin_d + 0.4;
hole_r = hole_d / 2;

sleeve_or = 5.0;
sleeve_bot = -2.5;
sleeve_top = 6.5;
sleeve_h = sleeve_top - sleeve_bot;
sleeve_cz = (sleeve_top + sleeve_bot) / 2;

head_r = 6.0;
head_z0 = 7.0;
head_h = 2.0;

module fixed_part() {
    union() {
        translate([0, 0, -7.0])
            cylinder(h = 14.5, r = pin_r);

        translate([0, 0, head_z0])
            cylinder(h = head_h, r = head_r);

        translate([0, 0, -3.5])
            cylinder(h = 0.5, r = 5.5);

        translate([-36, -9, -6.0])
            cube([36, 18, 2.5]);
    }
}

module moving_part_raw() {
    difference() {
        union() {
            translate([0, 0, sleeve_cz])
                cylinder(h = sleeve_h, r = sleeve_or);

            translate([0, -9, -1.5])
                cube([36, 18, 3.0]);
        }

        translate([0, 0, sleeve_bot - 0.5])
            cylinder(h = sleeve_h + 1.0, r = hole_r);
    }
}

module moving_part() {
    rotate([0, 0, hinge_angle])
        moving_part_raw();
}

if (agentscad_part == "all" || agentscad_part == "fixed")
    fixed_part();

if (agentscad_part == "all" || agentscad_part == "moving")
    moving_part();
