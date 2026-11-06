// Original rigid geometry fixture: quarter-turn release, not a load-rated design.
// Work interval: -45..45 degrees. Release at 90 degrees, then withdraw +Z.
agentscad_part = "all";
release_angle = 0;
withdrawal = 0;
$fn = 48;

module support() {
    difference() {
        translate([-6,-6,2]) cube([12,12,1]);
        translate([-1.3,-3.3,1.9]) cube([2.6,6.6,1.2]);
    }
}
module rotor() {
    union() {
        translate([-3,-1,0]) cube([6,2,1]);
        cylinder(d=2,h=5);
        translate([0,0,4]) cylinder(d=6,h=1);
    }
}
module generated_part() {
    if (agentscad_part == "support") support();
    else if (agentscad_part == "rotor") rotor();
    else {
        support();
        translate([0,0,withdrawal]) rotate([0,0,release_angle]) rotor();
    }
}
generated_part();
