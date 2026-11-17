// Original low-speed slider-crank verification fixture with an embedded
// assembly declaration. The declaration is a proposal; the verifier measures
// the rendered source against independent analytic expectations.
/* AGENTSCAD_ASSEMBLY_V1
{"schemaVersion":1,"units":"mm","coordinateSystem":"right-handed","parts":[{"id":"frame","name":"Frame","selector":"frame","source":"generated","material":null},{"id":"crank","name":"Crank","selector":"crank","source":"generated","material":null},{"id":"rod","name":"Rod","selector":"rod","source":"generated","material":null},{"id":"slider","name":"Slider","selector":"slider","source":"generated","material":null}],"instances":[{"id":"frame1","partId":"frame","subassemblyId":null,"transform":[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]},{"id":"crank1","partId":"crank","subassemblyId":null,"transform":[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]},{"id":"rod1","partId":"rod","subassemblyId":null,"transform":[1,0,0,0,0,1,0,0,0,0,1,8,0,0,0,1]},{"id":"slider1","partId":"slider","subassemblyId":null,"transform":[1,0,0,0,0,1,0,0,0,0,1,36,0,0,0,1]}],"subassemblies":[],"connections":[{"id":"crank_axis","type":"revolute","a":"frame1","b":"crank1","frameA":{"origin":[0,0,0],"direction":[0,1,0]},"frameB":{"origin":[0,0,0],"direction":[0,1,0]},"range":{"min":0,"max":360,"unit":"deg"},"pitchMm":null,"ratio":null,"boreInstanceId":"frame1","allowedContact":[],"fitStationsMm":[-8.8,-8.0,-7.2]},{"id":"crank_pin","type":"revolute","a":"crank1","b":"rod1","frameA":{"origin":[0,0,8],"direction":[0,1,0]},"frameB":{"origin":[0,0,0],"direction":[0,1,0]},"range":null,"pitchMm":null,"ratio":null,"allowedContact":[]},{"id":"wrist","type":"revolute","a":"rod1","b":"slider1","frameA":{"origin":[0,0,28],"direction":[0,1,0]},"frameB":{"origin":[0,0,0],"direction":[0,1,0]},"range":null,"pitchMm":null,"ratio":null,"allowedContact":[]},{"id":"slide","type":"prismatic","a":"slider1","b":"frame1","frameA":{"origin":[0,0,0],"direction":[0,0,1]},"frameB":{"origin":[0,0,0],"direction":[0,0,1]},"range":null,"pitchMm":null,"ratio":null,"allowedContact":[]}],"groundedInstanceId":"frame1","motions":[{"id":"crank_motion","inputConnectionId":"crank_axis","range":{"min":0,"max":360,"unit":"deg"},"sourceInput":{"parameter":"motion_angle","poseSelectors":{"frame1":"frame","crank1":"crank","rod1":"rod","slider1":"slider"}}}],"operations":[],"manufacturing":null,"assumptions":["Declared frames and local part modules are an intent declaration, not measured evidence."],"unknowns":[]}
END_AGENTSCAD_ASSEMBLY */
// Original low-speed slider-crank verification fixture, millimetres.
// Four manufacturing parts. Pins are integral; external axial retention is
// required. No load capacity, print tolerance or physical function is claimed.
agentscad_part = "all";
agentscad_pose = false;
motion_angle = 0;
crank_radius = 8;
rod_length = 28;
$fn = 64;

// All pin axes are parallel to +Y; the mechanism moves in the XZ plane.
module y_cylinder(radius, height) { rotate([-90, 0, 0]) cylinder(r=radius, h=height); }
module crank_local() {
  union() {
    translate([0, -4, 0]) y_cylinder(crank_radius + 3, 4);
    translate([0, -9, 0]) y_cylinder(2, 5.1);
    translate([0, -0.1, crank_radius]) y_cylinder(2, 6.1);
  }
}
module rod_local() {
  difference() {
    hull() {
      translate([0, 1, 0]) y_cylinder(4, 3);
      translate([0, 1, rod_length]) y_cylinder(4, 3);
    }
    translate([0, 0.9, 0]) y_cylinder(2.2, 3.2);
    translate([0, 0.9, rod_length]) y_cylinder(2.2, 3.2);
  }
}
module slider_local() {
  union() {
    translate([-5, 5, -5]) cube([10, 4, 10]);
    y_cylinder(2, 5.1);
  }
}
module frame_local() {
  union() {
    difference() {
      translate([-14, -10, -14]) cube([28, 4, 58]);
      translate([0, -10.1, 0]) y_cylinder(2.2, 4.2);
    }
    for (x = [-9, 5.4]) {
      translate([x, 5, 14]) cube([3.6, 4, 30]);
      translate([x, -6.1, 42]) cube([3.6, 11.2, 2]);
    }
  }
}

// Source-side construction. The checker measures the resulting mesh contours;
// it never consumes these functions or their computed coordinates as evidence.
cx = crank_radius * sin(motion_angle);
cz = crank_radius * cos(motion_angle);
travel = sqrt(rod_length * rod_length - cx * cx);
pz = cz + travel;
rod_angle = atan2(-cx, travel);
module selected_part(id, placed) {
  if (id == "frame") frame_local();
  if (id == "crank") rotate([0, placed ? motion_angle : 0, 0]) crank_local();
  if (id == "rod") translate(placed ? [cx, 0, cz] : [0, 0, 0])
    rotate([0, placed ? rod_angle : 0, 0]) rod_local();
  if (id == "slider") translate([0, 0, placed ? pz : 0]) slider_local();
}
module generated_part() {
  if (agentscad_part == "all") {
    for (id = ["frame", "crank", "rod", "slider"]) selected_part(id, true);
  } else selected_part(agentscad_part, agentscad_pose);
}
generated_part();
