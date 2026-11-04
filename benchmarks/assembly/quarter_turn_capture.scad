// Original two-piece rigid quarter-turn capture experiment, mm.
// No rotational detent, strength, manufacturing fit or self-locking claim.
agentscad_part = "all";
agentscad_pose = false;
lock_angle = 90;
$fn = 64;
module sleeve_local() {
  difference() {
    translate([-6,-6,0]) cube([12,12,3]);
    translate([-4.4,-1.4,-0.1]) cube([8.8,2.8,3.2]);
  }
}
module pin_local() {
  union() {
    translate([0,0,-4]) cylinder(r=4,h=2);
    translate([0,0,-2.1]) cylinder(r=1,h=6.2);
    translate([-4,-1,4]) cube([8,2,2]);
  }
}
if (agentscad_part == "sleeve") sleeve_local();
if (agentscad_part == "pin") rotate([0,0,agentscad_pose ? lock_angle : 0]) pin_local();
if (agentscad_part == "all") { sleeve_local(); rotate([0,0,lock_angle]) pin_local(); }
