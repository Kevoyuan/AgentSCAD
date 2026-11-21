// Eccentric disk cam with a flat translating follower.
// Two-dimensional mechanism in the XZ plane; the cam rotates about +Y.
// The follower face is perpendicular to +X and moves along X.
cam_angle = 0;
agentscad_part = "all";
eccentricity = 4;
cam_radius = 10;
cam_thickness = 6;
follower_gap = 0.15;
follower_length = 8;
follower_width = 8;
follower_height = 8;
$fn = 96;

module frame_local() {
  // Base plate below the mechanism.
  translate([6, -12, -16]) cube([44, 24, 2]);
  // Two guide rails around the follower; they do not touch the cam.
  for (yy = [-6.5, 5.5]) translate([-12, yy, -6]) cube([46, 1, 12]);
}

module cam_local() {
  // Eccentric disk in the XZ plane; the shaft is omitted so the frame needs no bearing.
  rotate([90, 0, 0]) translate([eccentricity, 0, 0]) cylinder(r = cam_radius, h = cam_thickness, center = true);
}

module follower_local() {
  // Flat face at x = R + e cos(theta) + gap; block extends to +X.
  xpos = cam_radius + eccentricity * cos(cam_angle) + follower_gap;
  translate([xpos, -follower_width / 2, -follower_height / 2])
    cube([follower_length, follower_width, follower_height]);
}

module assembly() {
  if (agentscad_part == "all" || agentscad_part == "frame") frame_local();
  if (agentscad_part == "all" || agentscad_part == "cam") rotate([0, cam_angle, 0]) cam_local();
  if (agentscad_part == "all" || agentscad_part == "follower") follower_local();
}

assembly();
