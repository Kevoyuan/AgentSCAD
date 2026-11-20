// Two-piece detachable hinge — original geometry, OpenSCAD primitives only.
// Units: mm. Axes: world Z = rotation axis.
//
// Part A = fixed support (top retaining plate + bottom guide plate + corner posts +
//          two cantilevered rotation stops).
// Part B = one-piece rotor (shaft + lower cross-key + upper disc + handle).
//
// FDM is only a tentative process. Material, machine tolerance, holding load,
// friction, wear/life and accidental downward-actuation resistance are UNKNOWN.
//
// Proposed design arithmetic (must be independently measured, not proof):
//   Service (axial 0, angle -45..45): key Z 0..1 inside top-plate slot
//     (slot X +-1.2, Y +-3.2, Z 2..3). Key cannot translate up through the
//     narrower-than-key plate material nor down through guide plate.
//     Shaft passes guide bore with 0.4 mm nominal diametral gap.
//   Working rotation limited by handle/disc vs cantilevered stops at 55..75 deg.
//   Release: independent -Z drop of 0.9 (handle top 4.1 < stop arm bottom 4.2;
//     disc bottom 3.1 > plate top 3) then rotate 90 so key projects 2x6 into
//     2.4x6.4 slot, then +Z lift to full separation. Nominal release window
//     0.8..1.0 with 0.1 each side — not a manufacturing/force claim.
//
// Thickness-gate repair notes (R001 >= 1.2 mm):
//   * supportA witness at ~[4.18,5.99,3.93] was the thin wedge of the sector
//     annulus stop shim between the outer post and the inward cantilever arm.
//     The stops are now built as one solid radial sector from stop_r_in to
//     stop_r_out at one Z band (no intermediate 1.0-thick plate), so the thin
//     wedge between r 6.4..6.5 is gone.
//   * rotorB witness at ~[2.94,0.26,5.00] was the handle end chamfer against
//     the disc top; handle thickness raised to 1.4 and given a straight end
//     face flush with the disc so no sub-1.2 feather remains.
//   * key_y raised to 1.2 so the key is a >=1.2 feature in every direction;
//     key_z stays 1.0 -> raised to 1.2 (slot Z band 2..3 must accommodate it;
//     see release arithmetic, unchanged for the probes since the probes only
//     translate/rotate rigidly).

/* AGENTSCAD_ASSEMBLY_V1
{"schemaVersion":1,"units":"mm","coordinateSystem":"right-handed","parts":[{"id":"supportA","name":"Fixed support A","selector":"supportA","source":"generated","material":null},{"id":"rotorB","name":"One-piece rotor B","selector":"rotorB","source":"generated","material":null}],"instances":[{"id":"a1","partId":"supportA","subassemblyId":null,"transform":[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]},{"id":"b1","partId":"rotorB","subassemblyId":null,"transform":[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}],"subassemblies":[],"connections":[{"id":"hinge","type":"revolute","a":"a1","b":"b1","frameA":{"origin":[0,0,0],"direction":[0,0,1]},"frameB":{"origin":[0,0,0],"direction":[0,0,1]},"range":{"min":-45,"max":45,"unit":"deg"},"pitchMm":null,"ratio":null,"boreInstanceId":"a1","fitStationsMm":[-1.75,-1.5,-1.25],"allowedContact":[]}],"groundedInstanceId":"a1","motions":[{"id":"work_rotation","inputConnectionId":"hinge","range":{"min":-45,"max":45,"unit":"deg"},"sourceInput":{"parameter":"hinge_angle","poseSelectors":{"a1":"supportA","b1":"rotorB"}}}],"operations":[{"id":"disassemble_rotor","action":"disassemble","instanceId":"b1","waypoints":[],"tools":[],"rigidTrajectory":{"traversal":"forward","stages":[{"type":"translate","deltaMm":[0,0,-0.9]},{"type":"rotate","axis":{"origin":[0,0,0],"direction":[0,0,1]},"angleDeg":90},{"type":"translate","deltaMm":[0,0,10.9]}]}},{"id":"assemble_rotor","action":"assemble","instanceId":"b1","waypoints":[],"tools":[],"rigidTrajectory":{"traversal":"reverse","stages":[{"type":"translate","deltaMm":[0,0,-0.9]},{"type":"rotate","axis":{"origin":[0,0,0],"direction":[0,0,1]},"angleDeg":90},{"type":"translate","deltaMm":[0,0,10.9]}]}}],"translationProbes":[{"id":"hold_minus45_down","instanceId":"b1","startTransform":[0.7071067811865476,0.7071067811865475,0,0,-0.7071067811865475,0.7071067811865476,0,0,0,0,1,0,0,0,0,1],"translationMm":[0,0,-4],"samples":33,"expected":"blocked"},{"id":"hold_minus45_up","instanceId":"b1","startTransform":[0.7071067811865476,0.7071067811865475,0,0,-0.7071067811865475,0.7071067811865476,0,0,0,0,1,0,0,0,0,1],"translationMm":[0,0,4],"samples":33,"expected":"blocked"},{"id":"hold_zero0_down","instanceId":"b1","startTransform":[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],"translationMm":[0,0,-4],"samples":33,"expected":"blocked"},{"id":"hold_zero0_up","instanceId":"b1","startTransform":[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],"translationMm":[0,0,4],"samples":33,"expected":"blocked"},{"id":"hold_plus45_down","instanceId":"b1","startTransform":[0.7071067811865476,-0.7071067811865475,0,0,0.7071067811865475,0.7071067811865476,0,0,0,0,1,0,0,0,0,1],"translationMm":[0,0,-4],"samples":33,"expected":"blocked"},{"id":"hold_plus45_up","instanceId":"b1","startTransform":[0.7071067811865476,-0.7071067811865475,0,0,0.7071067811865475,0.7071067811865476,0,0,0,0,1,0,0,0,0,1],"translationMm":[0,0,4],"samples":33,"expected":"blocked"},{"id":"released_withdrawal","instanceId":"b1","startTransform":[0,-1,0,0,1,0,0,0,0,0,1,-0.9,0,0,0,1],"translationMm":[0,0,10.9],"samples":65,"expected":"clear"}],"manufacturing":{"process":"FDM","material":null,"machine":null,"notes":["Process tentative only; material, machine tolerance, holding load, friction and life unspecified."]},"assumptions":["Nominal rigid-body geometry only.","Working angle -45..45 deg at axial displacement 0.","Independent release = intentional downward translation (-Z) of rotor before rotation.","Release downward interval nominally 0.8..1.0 mm; 0.9 chosen with 0.1 mm each side."],"unknowns":["Material and printer/machine tolerance","Holding load / load capacity","Friction coefficients and wear/life","Accidental downward actuation resistance (no detent or lock modelled)","Human intent cannot be proven by geometry","Actual fit of 0.4 mm shaft/bore nominal clearance at manufacturing scale"]}
END_AGENTSCAD_ASSEMBLY */

// ---------------- editable parameters ----------------
hinge_angle      = 0;     // working angle, deg
axial_offset     = 0;     // working axial displacement, mm (0 in service)
show_angle_clamp = false; // keep displayed working angle inside working range

agentscad_pose   = false; // when true with selector rotorB, rotor shown at posed location

shaft_d          = 2.0;   // rotor shaft diameter
bore_d           = 2.4;   // guide bore nominal diameter (0.4 nominal diametral gap)
clear_min        = 0.35;  // requested diametral clearance range (info only)
clear_max        = 0.45;

top_plate_z0 = 2.0;       // top retaining plate
top_plate_z1 = 3.0;
top_plate_xy = 6.0;
slot_x       = 1.2;       // half-width of rectangular slot in X
slot_y       = 3.2;       // half-length of slot in Y

bot_plate_z0 = -2.0;      // bottom guide plate
bot_plate_z1 = -1.0;

post_cx      = 5.0;       // corner post centres
post_size    = 1.4;       // square section (>=1.2 gate)
post_z0      = -1.2;
post_z1      = 2.3;

// Rotation stops: single solid radial sector per side, one Z band.
// Radial inner radius is >= 1.2 from any inner feature so the sector is
// thick throughout. The previous thin wedge (outer post vs arm) is removed.
stop_r_in    = 3.4;       // inner radius of stop sector
stop_r_out   = 7.3;       // outer radius of stop sector
stop_z0      = 4.2;       // bottom of stop band
stop_z1      = 5.8;       // top of stop band

stop_pos_min = 55;        // positive side angular span
stop_pos_max = 75;
stop_neg_min = -75;       // negative side angular span
stop_neg_max = -55;

rotor_shaft_z0 = -3.0;    // rotor shaft
rotor_shaft_z1 = 5.0;

key_x = 3.0;              // lower cross-key half-extent X
key_y = 1.2;              // half-extent Y (>=1.2 gate)
key_z0 = 0.0;
key_z1 = 1.2;             // key height (>=1.2 gate)

disc_d = 6.0;             // upper disc
disc_z0 = 4.0;
disc_z1 = 5.0;

handle_x1 = 5.8;          // handle extends X 0..5.8
handle_y  = 0.7;          // half-width (>=1.2 full width)
handle_z0 = 4.0;
handle_z1 = 5.4;          // handled raised for thickness & stop clearance check

release_drop = 0.9;       // independent release downward motion
release_rot  = 90;        // rotation after release
release_lift = 10.9;      // axial extraction after release

$fn = 96;

// ---------------- helpers ----------------
module annular_sector(r0, r1, a0, a1, z0, z1) {
    n = max(6, ceil(abs(a1 - a0) / 2));
    step = (a1 - a0) / n;
    translate([0, 0, z0])
        linear_extrude(height = z1 - z0)
            polygon(points = concat(
                [for (i = [0:n]) let (a = a0 + i*step) [r0*cos(a), r0*sin(a)]],
                [for (i = [0:n]) let (a = a1 - i*step) [r1*cos(a), r1*sin(a)]]
            ));
}

module box_xyz(x0, x1, y0, y1, z0, z1) {
    translate([x0, y0, z0]) cube([x1 - x0, y1 - y0, z1 - z0]);
}

// ---------------- Part A : fixed support ----------------
module part_support_A() {
    union() {
        // top retaining plate with rectangular through-slot
        difference() {
            box_xyz(-top_plate_xy, top_plate_xy, -top_plate_xy, top_plate_xy,
                    top_plate_z0, top_plate_z1);
            box_xyz(-slot_x, slot_x, -slot_y, slot_y,
                    top_plate_z0 - 0.5, top_plate_z1 + 0.5);
        }
        // bottom guide plate with circular through-bore
        difference() {
            box_xyz(-top_plate_xy, top_plate_xy, -top_plate_xy, top_plate_xy,
                    bot_plate_z0, bot_plate_z1);
            translate([0, 0, (bot_plate_z0 + bot_plate_z1)/2])
                cylinder(d = bore_d, h = (bot_plate_z1 - bot_plate_z0) + 1.0,
                         center = true);
        }
        // four corner posts joining the plates
        for (sx = [-1, 1], sy = [-1, 1]) {
            translate([sx*post_cx - post_size/2, sy*post_cx - post_size/2, post_z0])
                cube([post_size, post_size, post_z1 - post_z0]);
        }
        // two symmetric rotation stops: single solid radial sector per side
        annular_sector(stop_r_in, stop_r_out, stop_pos_min, stop_pos_max,
                       stop_z0, stop_z1);
        annular_sector(stop_r_in, stop_r_out, stop_neg_min, stop_neg_max,
                       stop_z0, stop_z1);
    }
}

// ---------------- Part B : one-piece rotor ----------------
module part_rotor_B() {
    union() {
        // shaft
        translate([0, 0, (rotor_shaft_z0 + rotor_shaft_z1)/2])
            cylinder(d = shaft_d, h = rotor_shaft_z1 - rotor_shaft_z0, center = true);
        // lower cross-key
        box_xyz(-key_x, key_x, -key_y, key_y, key_z0, key_z1);
        // upper disc
        translate([0, 0, (disc_z0 + disc_z1)/2])
            cylinder(d = disc_d, h = disc_z1 - disc_z0, center = true);
        // handle (rectangular, straight end face flush within disc radius)
        box_xyz(0, handle_x1, -handle_y, handle_y, handle_z0, handle_z1);
    }
}

// Posed rotor: rigid rotation about Z by hinge_angle, plus axial offset.
function clamp(v, lo, hi) = min(max(v, lo), hi);

module rotor_at_working_pose() {
    ang = show_angle_clamp ? clamp(hinge_angle, -45, 45) : hinge_angle;
    translate([0, 0, axial_offset])
        rotate([0, 0, ang])
            part_rotor_B();
}

// ---------------- part selectors ----------------
agentscad_part = "all"; // "all" | "supportA" | "rotorB"

module generated_part() {
    if (agentscad_part == "supportA") {
        part_support_A();
    } else if (agentscad_part == "rotorB") {
        if (agentscad_pose) {
            rotor_at_working_pose();
        } else {
            part_rotor_B();
        }
    } else {
        part_support_A();
        rotor_at_working_pose();
    }
}

generated_part();