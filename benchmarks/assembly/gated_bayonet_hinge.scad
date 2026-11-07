// Original two-body digital experiment. Dimensions in mm.
// Service -45..45 deg at axial_shift=0. Proposed release: lower 0.9,
// rotate 90, then raise to axial_shift=10. No force or intent guarantee.
agentscad_part = "all";
service_angle = 0;
axial_shift = 0;
$fn = 48;

module annular_sector(inner_radius, outer_radius, begin_angle, end_angle, bottom, height) {
    translate([0,0,bottom])
        rotate([0,0,begin_angle])
            rotate_extrude(angle=end_angle-begin_angle)
                translate([inner_radius,0]) square([outer_radius-inner_radius,height]);
}

module support() {
    union() {
        difference() {
            translate([-6,-6,2]) cube([12,12,1]);
            translate([-1.2,-3.2,1.9]) cube([2.4,6.4,1.2]);
        }
        difference() {
            translate([-6,-6,-2]) cube([12,12,1]);
            translate([0,0,-2.1]) cylinder(d=2.4,h=1.2);
        }
        for (x=[-5,5], y=[-5,5])
            translate([x-0.6,y-0.6,-1.2]) cube([1.2,1.2,3.5]);
        for (side=[-1,1]) {
            begin_angle = side > 0 ? 55 : -75;
            end_angle = side > 0 ? 75 : -55;
            annular_sector(6.5,7.3,begin_angle,end_angle,2.5,3.3);
            annular_sector(3.3,7.3,begin_angle,end_angle,4.2,1.6);
        }
    }
}

module rotor() {
    union() {
        translate([-3,-1,0]) cube([6,2,1]);
        translate([0,0,-3]) cylinder(d=2,h=8);
        translate([0,0,4]) cylinder(d=6,h=1);
        translate([0,-0.5,4]) cube([5.8,1,1]);
    }
}

// Pose view is separate from the two local manufacturing selectors.
module posed_rotor() {
    translate([0,0,axial_shift]) rotate([0,0,service_angle]) rotor();
}

if (agentscad_part == "support") support();
else if (agentscad_part == "rotor") rotor();
else if (agentscad_part == "rotor_pose") posed_rotor();
else {
    support();
    posed_rotor();
}
