// Two-piece detachable hinge — original geometry, OpenSCAD primitives only.
// Units: mm. Axes: world Z = rotation axis.
// Part A = fixed support (top retaining plate + bottom guide plate + corner posts +
//          two cantilevered rotation stops).
// Part B = one-piece rotor (shaft + lower cross-key + upper disc + handle).
//
// FDM is only a tentative process. Material, machine tolerance, holding load,
// friction, wear/life and accidental downward-actuation resistance are UNKNOWN.
//
// Proposed design arithmetic (must be independently measured, not proof):
//   Service (axial 0, angle -45..45): key at Z=0..1 sits inside top-plate slot
//     (slot X +-1.2, Y +-3.2, Z 2..3); key cannot translate up through the
//     narrower-than-key material region nor down through the guide plate.
//     Shaft passes guide bore (d2.4) with nominal 0.4 diametral gap.
//   Working rotation limited by handle/disc vs cantilevered stops at 55..75 deg;
//     handle sweeps toward +-90 blocked by the stops (geometric gate).
//   Release: independent -Z drop of 0.9 (handle top 4.1 < stop bottom 4.2;
//     disc bottom 3.1 > plate top 3) then rotate 90 so key projects 2x6 into
//     2.4x6.4 slot, then +Z lift to full separation. Nominal release window
//     0.8..1.0 with 0.1 each side — not a manufacturing/force claim.
//
// Repair note (R001 digital thickness gate, 1.2 mm):
//   supportA min ray 0.69 mm was the inward cantilever stop arm thickness
//     (radial band 4.2..5.8 was actually arm_z 4.2..5.8 => too thin in Z).
//     Fix: stop arm Z band widened to 2.5..5.8 (3.3 mm) matching outer post,
//     arm radial inner r0 moved out to 3.6 so it does not need to be thin.
//   rotorB min ray 1.00 mm was the handle (z 4..5) thickness in Z.
//     Fix: handle Z band widened to 3.4..5.0 (1.6 mm) and remains above
//     plate top (3.0) so release still works; the disc remains 4..5.
//   All functional dims (bore, key, slot, working range, release window)
//   are preserved unchanged.

/* AGENTSCAD_ASSEMBLY_V1
{"schemaVersion":1,"units":"mm","coordinateSystem":"right-handed","parts":[{"id":"supportA","name":"Fixed support A","selector":"supportA","source":"generated","material":null},{"id":"rotorB","name":"One-piece rotor B","selector":"rotorB","source":"generated","material":null}],"instances":[{"id":"a1","partId":"supportA","subassemblyId":null,"transform":[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]},{"id":"b1","partId":"rotorB","subassemblyId":null,"transform":[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}],"subassemblies":[],"connections":[{"id":"hinge","type":"revolute","a":"a1","b":"b1","frameA":{"origin":[0,0,0],"direction":[0,0,1]},"frameB":{"origin":[0,0,0],"direction":[0,0,1]},"range":{"min":-45,"max":45,"unit":"deg"},"pitchMm":null,"ratio":null,"boreInstanceId":"a1","fitStationsMm":[-1.75,-1.5,-1.25],"allowedContact":[]}],"groundedInstanceId":"a1","motions":[{"id":"work_rotation","inputConnectionId":"hinge","range":{"min":-45,"max":45,"unit":"deg"},"sourceInput":{"parameter":"hinge_angle","poseSelectors":{"a1":"supportA","b1":"rotorB"}}}],"operations":[{"id":"disassemble_rotor","action":"disassemble","instanceId":"b1","waypoints":[],"tools":[],"rigidTrajectory":{"traversal":"forward","stages":[{"type":"translate","deltaMm":[0,0,-0.9]},{"type":"rotate","axis":{"origin":[0,0,0],"direction":[0,0,1]},"angleDeg":90},{"type":"translate","deltaMm":[0,0,10.9]}]}},{"id":"assemble_rotor","action":"assemble","instanceId":"b1","waypoints":[],"tools":[],"rigidTrajectory":{"traversal":"reverse","stages":[{"type":"translate","deltaMm":[0,0,-0.9]},{"type":"rotate","axis":{"origin":[0,0,0],"direction":[0,0,1]},"angleDeg":90},{"type":"translate","deltaMm":[0,0,10.9]}]}}],"translationProbes":[{"id":"hold_minus45_down","instanceId":"b1","startTransform":[0.7071067811865476,0.7071067811865475,0,0,-0.7071067811865475,0.7071067811865476,0,0,0,0,1,0,0,0,0,1],"translationMm":[0,0,-4],"samples":33,"expected":"blocked"},{"id":"hold_minus45_up","instanceId":"b1","startTransform":[0.7071067811865476,0.7071067811865475,0,0,-0.7071067811865475,0.7071067811865476,0,0,0,0,1,0,0,0,0,1],"translationMm":[0,0,4],"samples":33,"expected":"blocked"},{"id":"hold_zero0_down","instanceId":"b1","startTransform":[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],"translationMm":[0,0,-4],"samples":33,"expected":"blocked"},{"id":"hold_zero0_up","instanceId":"b1","startTransform":[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],"translationMm":[0,0,4],"samples":33,"expected":"blocked"},{"id":"hold_plus45_down","instanceId":"b1","startTransform":[0.7071067811865476,-0.7071067811865475,0,0,0.7071067811865475,0.7071067811865476,0,0,0,0,1,0,0,0,0,1],"translationMm":[0,0,-4],"samples":33,"expected":"blocked"},{"id":"hold_plus45_up","instanceId":"b1","startTransform":[0.7071067811865476,-0.7071067811865475,0,0,0.7071067811865475,0.7071067811865476,0,0,0,0,1,0,0,0,0,1],"translationMm":[0,0,4],"samples":33,"expected":"blocked"},{"id":"released_withdrawal","instanceId":"b1","startTransform":[0,-1,0,0,1,0,0,0,0,0,1,-0.9,0,0,0,1],"translationMm":[0,0,10.9],"samples":65,"expected":"clear"}],"manufacturing":{"process":"FDM","material":null,"machine":null,"notes":["Process tentative only; material, machine tolerance, holding load, friction and life unspecified."]},"assumptions":["Nominal rigid-body geometry only.","Working angle -45..45 deg at axial displacement 0.","Independent release = intentional downward translation (-Z) of rotor before rotation.","Release downward interval nominally 0.8..1.0 mm; 0.9 chosen with 0.1 mm each side."],"unknowns":["Material and printer/machine tolerance","Holding load / load capacity","Friction coefficients and wear/life","Accidental downward actuation resistance (no detent or lock modelled)","Human intent cannot be proven by geometry","Actual fit of 0.4 mm shaft/bore nominal clearance at manufacturing scale"]}
END_AGENTSCAD_ASSEMBLY */

// ---------------- editable parameters ----------------
hinge_angle      = 0;     // working angle, deg, clamped logically to -45..45 for view
axial_offset     = 0;     // working axial displacement, mm (0 in service)
show_angle_clamp = false;  // keep displayed working angle inside working range

agentscad_pose   = false; // when true with selector rotorB, rotor shown at posed assembly location

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
post_size    = 1.2;       // square section
post_z0      = -1.2;
post_z1      = 2.3;

stop_outer_r0 = 6.5;      // outward post radial band
stop_outer_r1 = 7.3;
stop_outer_z0 = 2.5;
stop_outer_z1 = 5.8;

stop_arm_r0  = 3.6;       // inward cantilever radial band (widened inner radius)
stop_arm_r1  = 7.3;
stop_arm_z0  = 2.5;       // widened Z band so arm reaches >=1.2mm (3.3mm thick)
stop_arm_z1  = 5.8;

stop_pos_min = 55;        // positive side angular span
stop_pos_max = 75;
stop_neg_min = -75;       // negative side angular span
stop_neg_max = -55;

rotor_shaft_z0 = -3.0;    // rotor shaft
rotor_shaft_z1 = 5.0;

key_x = 3.0;              // lower cross-key half-extent X
key_y = 1.0;              // half-extent Y
key_z0 = 0.0;
key_z1 = 1.0;

disc_d = 6.0;             // upper disc
disc_z0 = 4.0;
disc_z1 = 5.0;

handle_x1 = 5.8;          // handle extends X 0..5.8
handle_y  = 0.5;
handle_z0 = 3.4;          // widened down so handle >=1.2mm thick (1.6mm)
handle_z1 = 5.0;

release_drop = 0.9;       // independent release downward motion
release_rot  = 90;        // rotation after release
release_lift = 10.9;      // axial extraction after release

$fn = 96;

// ---------------- helpers ----------------
module annular_sector(r0, r1, a0, a1, z0, z1) {
    n = max(4, ceil(abs(a1 - a0) / 2));
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
        // two symmetric cantilevered rotation stops (widened Z band)
        annular_sector(stop_outer_r0, stop_outer_r1, stop_pos_min, stop_pos_max,
                       stop_outer_z0, stop_outer_z1);
        annular_sector(stop_arm_r0, stop_arm_r1, stop_pos_min, stop_pos_max,
                       stop_arm_z0, stop_arm_z1);
        annular_sector(stop_outer_r0, stop_outer_r1, stop_neg_min, stop_neg_max,
                       stop_outer_z0, stop_outer_z1);
        annular_sector(stop_arm_r0, stop_arm_r1, stop_neg_min, stop_neg_max,
                       stop_arm_z0, stop_arm_z1);
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
        // handle (thickened to 1.6 mm in Z)
        box_xyz(0, handle_x1, -handle_y, handle_y, handle_z0, handle_z1);
    }
}

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