agentscad_part = "all";
piston_stroke = 0;

$fn = 64;

piston_dia = 10;
diametral_clearance = 0.4;
bore_dia = piston_dia + diametral_clearance;
barrel_outer_dia = 18;
barrel_bottom_thickness = 5;
piston_length = 30;
bore_depth = 65;
piston_z0 = barrel_bottom_thickness + 0.5;

module barrel() {
    difference() {
        cylinder(d = barrel_outer_dia, h = barrel_bottom_thickness + bore_depth);
        translate([0, 0, barrel_bottom_thickness])
            cylinder(d = bore_dia, h = bore_depth);
    }
}

module piston() {
    translate([0, 0, piston_z0 + piston_stroke])
        cylinder(d = piston_dia, h = piston_length);
}

if (agentscad_part == "all" || agentscad_part == "barrel") barrel();
if (agentscad_part == "all" || agentscad_part == "piston") piston();
