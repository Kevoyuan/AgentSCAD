// Original piston-in-cylinder slider-crank fixture with an embedded declaration.
// The declaration is a proposal; measurements come from the rendered source.
/* AGENTSCAD_ASSEMBLY_V1
{"schemaVersion":1,"units":"mm","coordinateSystem":"right-handed","parts":[{"id":"frame","name":"Frame","selector":"frame","source":"generated","material":null},{"id":"crank","name":"Crank","selector":"crank","source":"generated","material":null},{"id":"rod","name":"Rod","selector":"rod","source":"generated","material":null},{"id":"slider","name":"Piston","selector":"slider","source":"generated","material":null}],"instances":[{"id":"frame1","partId":"frame","subassemblyId":null,"transform":[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]},{"id":"crank1","partId":"crank","subassemblyId":null,"transform":[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]},{"id":"rod1","partId":"rod","subassemblyId":null,"transform":[1,0,0,0,0,1,0,0,0,0,1,8,0,0,0,1]},{"id":"slider1","partId":"slider","subassemblyId":null,"transform":[1,0,0,0,0,1,0,0,0,0,1,36,0,0,0,1]}],"subassemblies":[],"connections":[{"id":"crank_axis","type":"revolute","a":"frame1","b":"crank1","frameA":{"origin":[0,0,0],"direction":[0,1,0]},"frameB":{"origin":[0,0,0],"direction":[0,1,0]},"range":{"min":-45,"max":45,"unit":"deg"},"pitchMm":null,"ratio":null,"boreInstanceId":"frame1","fitStationsMm":[-6.5,-6,-5.5],"allowedContact":[]},{"id":"crank_pin","type":"revolute","a":"crank1","b":"rod1","frameA":{"origin":[0,0,8],"direction":[0,1,0]},"frameB":{"origin":[0,3,0],"direction":[0,1,0]},"range":null,"pitchMm":null,"ratio":null,"boreInstanceId":"rod1","fitStationsMm":[2,3,4],"allowedContact":[]},{"id":"wrist","type":"revolute","a":"rod1","b":"slider1","frameA":{"origin":[0,0,28],"direction":[0,1,0]},"frameB":{"origin":[0,0,0],"direction":[0,1,0]},"range":null,"pitchMm":null,"ratio":null,"boreInstanceId":"slider1","fitStationsMm":[8,8.4,8.8],"allowedContact":[]},{"id":"slide","type":"prismatic","a":"slider1","b":"frame1","frameA":{"origin":[0,0,0],"direction":[0,0,1]},"frameB":{"origin":[0,0,36],"direction":[0,0,1]},"range":null,"pitchMm":null,"ratio":null,"boreInstanceId":"frame1","fitStationsMm":[5,6],"allowedContact":[]}],"groundedInstanceId":"frame1","motions":[{"id":"crank_motion","inputConnectionId":"crank_axis","range":{"min":-45,"max":45,"unit":"deg"},"sourceInput":{"parameter":"crank_angle","poseSelectors":{"frame1":"frame","crank1":"crank_pose","rod1":"rod_pose","slider1":"slider_pose"}}}],"operations":[],"manufacturing":null,"assumptions":["Original piston-in-cylinder slider-crank declaration; measurements cover only listed stations."],"unknowns":[]}
END_AGENTSCAD_ASSEMBLY */
$fn = 32;
agentscad_pose = false;
agentscad_part = "all";
crank_angle = 0;

crank_radius = 8;
rod_length = 28;
tube_outer = 14;
tube_bore = 10;
tube_start = 12;
tube_end = 56;
piston_length = 14;
piston_radius = 9.75;

crank_pin_x = crank_radius * sin(crank_angle);
crank_pin_z = crank_radius * cos(crank_angle);
rod_alpha = -asin(crank_radius * sin(crank_angle) / rod_length);
wrist_z = crank_radius * cos(crank_angle) + rod_length * cos(rod_alpha);

module frame_part() {
  difference() {
    union() {
      translate([0, 0, (tube_start + tube_end) / 2])
        cylinder(h = tube_end - tube_start, r = tube_outer, center = true);
      translate([0, -6, 5]) cube([28, 2, 18], center = true);
      translate([0, 0, 19]) cylinder(h = 14, r = 12, center = true);
    }
    translate([0, 0, (tube_start + tube_end) / 2])
      cylinder(h = tube_end - tube_start + 2, r = tube_bore, center = true);
    translate([0, 0, 19]) cylinder(h = 14, r = 12, center = true);
    translate([0, -6, 0]) rotate([90, 0, 0]) cylinder(h = 4, r = 2.2, center = true);
  }
}

module crank_part() {
  union() {
    translate([0, -2, 0]) rotate([90, 0, 0]) cylinder(h = 4, r = 11, center = true);
    translate([0, -3.5, 0]) rotate([90, 0, 0]) cylinder(h = 7, r = 2, center = true);
    translate([0, 1, crank_radius]) rotate([90, 0, 0]) cylinder(h = 10, r = 2, center = true);
  }
}

module rod_part() {
  difference() {
    hull() {
      translate([0, 3, 0]) rotate([90, 0, 0]) cylinder(h = 4, r = 4, center = true);
      translate([0, 3, rod_length]) rotate([90, 0, 0]) cylinder(h = 4, r = 3, center = true);
    }
    translate([0, 3, 0]) rotate([90, 0, 0]) cylinder(h = 6, r = 2.2, center = true);
  }
  translate([0, 3, rod_length]) rotate([90, 0, 0]) cylinder(h = 12, r = 2, center = true);
}

module slider_part() {
  difference() {
    cylinder(h = piston_length, r = piston_radius, center = true);
    rotate([90, 0, 0]) cylinder(h = 20, r = 2.2, center = true);
    // Fork slots admit the connecting rod on the crank side while the wrist
    // pin hole stays a closed cylindrical bore. The bottom slot is wider so the
    // rod's lower bearing edge sweeps clear at the range endpoints.
    translate([0, 2, -6]) cylinder(h = 4, r = 7, center = true);
    translate([0, 2, 0]) cylinder(h = 8, r = 5.5, center = true);
  }
}

module posed_assembly() {
  frame_part();
  rotate([0, crank_angle, 0]) crank_part();
  translate([crank_pin_x, 0, crank_pin_z]) rotate([0, rod_alpha, 0]) rod_part();
  translate([0, 0, wrist_z]) slider_part();
}

module generated_part() {
  if (agentscad_pose) {
    if (agentscad_part == "frame") {
      frame_part();
    } else if (agentscad_part == "crank_pose") {
      rotate([0, crank_angle, 0]) crank_part();
    } else if (agentscad_part == "rod_pose") {
      translate([crank_pin_x, 0, crank_pin_z]) rotate([0, rod_alpha, 0]) rod_part();
    } else if (agentscad_part == "slider_pose") {
      translate([0, 0, wrist_z]) slider_part();
    } else {
      posed_assembly();
    }
  } else {
    if (agentscad_part == "frame") {
      frame_part();
    } else if (agentscad_part == "crank") {
      crank_part();
    } else if (agentscad_part == "rod") {
      rod_part();
    } else if (agentscad_part == "slider") {
      slider_part();
    } else {
      posed_assembly();
    }
  }
}

generated_part();
