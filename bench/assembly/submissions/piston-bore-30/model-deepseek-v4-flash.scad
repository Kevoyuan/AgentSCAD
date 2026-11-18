$fn = 64;

agentscad_part = "all";
piston_stroke = 0;

piston_d = 10;
diametral_clearance = 0.4;
bore_d = piston_d + diametral_clearance;
barrel_od = 16.4;
barrel_h = 60;
bottom_t = 3;
piston_h = 20;
piston_z0 = bottom_t + 1.0;

module barrel() {
    difference() {
        cylinder(h = barrel_h, d = barrel_od, center = false);
        translate([0, 0, bottom_t])
            cylinder(h = barrel_h - bottom_t + 0.01, d = bore_d, center = false);
    }
}

module piston() {
    translate([0, 0, piston_z0 + piston_stroke])
        cylinder(h = piston_h, d = piston_d, center = false);
}

if (agentscad_part == "all" || agentscad_part == "barrel") barrel();
if (agentscad_part == "all" || agentscad_part == "piston") piston();
