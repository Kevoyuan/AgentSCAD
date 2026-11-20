// Original cylindrical prismatic guide fixture with an embedded declaration.
// The declaration is a proposal; the verifier measures the rendered surfaces.
/* AGENTSCAD_ASSEMBLY_V1
{"schemaVersion":1,"units":"mm","coordinateSystem":"right-handed","parts":[{"id":"guide","name":"Guide","selector":"guide","source":"generated","material":null},{"id":"slider","name":"Slider","selector":"slider","source":"generated","material":null}],"instances":[{"id":"guide1","partId":"guide","subassemblyId":null,"transform":[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]},{"id":"slider1","partId":"slider","subassemblyId":null,"transform":[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}],"subassemblies":[],"connections":[{"id":"slide","type":"prismatic","a":"slider1","b":"guide1","frameA":{"origin":[0,0,0],"direction":[0,0,1]},"frameB":{"origin":[0,0,0],"direction":[0,0,1]},"range":null,"pitchMm":null,"ratio":null,"boreInstanceId":"guide1","fitStationsMm":[-5,0,5],"allowedContact":[]}],"groundedInstanceId":"guide1","motions":[],"operations":[],"manufacturing":null,"assumptions":["Cylindrical block guide declared as a prismatic bore/shaft pair; only listed stations are measured."],"unknowns":[]}
END_AGENTSCAD_ASSEMBLY */
$fn = 64;

agentscad_part = "all";

guide_outer_radius = 7;
guide_inner_radius = 5;
guide_length = 40;
slider_radius = 4.8;
slider_length = 20;

module guide_part() {
  difference() {
    union() {
      cylinder(h = guide_length, r = guide_outer_radius, center = true);
      translate([0, 0, -guide_length / 2 - 2])
        cylinder(h = 4, r = guide_outer_radius + 3, center = true);
    }
    cylinder(h = guide_length + 2, r = guide_inner_radius, center = true);
  }
}

module slider_part() {
  cylinder(h = slider_length, r = slider_radius, center = true);
  translate([0, 0, -slider_length / 2 - 3])
    cylinder(h = 6, r = slider_radius, center = true);
}

module generated_part() {
  if (agentscad_part == "guide") {
    guide_part();
  } else if (agentscad_part == "slider") {
    slider_part();
  } else {
    guide_part();
    slider_part();
  }
}

generated_part();
