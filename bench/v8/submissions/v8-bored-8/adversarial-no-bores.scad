// V8 demonstration with eight independent throws and closed cylinder bores.
// Demonstrator geometry only: no firing order, valves, combustion, thermal,
// lubrication, load or manufacturing claim.
agentscad_part = "all";
crank_angle = 0;
$fn = 32;

r = 8; L = 28; half = 45;
ux = sin(half); uz = cos(half);

function phase(k) = [0, 90, 180, 270, 45, 135, 225, 315][k];
function bankdeg(k) = (k % 2 == 0) ? 45 : -45;
function sx(k) = sin(bankdeg(k));
function cz(k) = cos(bankdeg(k));
function insty(k) = -91 + 26 * k;
function px(a, k) = r * sin(a + phase(k));
function pz(a, k) = r * cos(a + phase(k));
function along(a, k) = px(a, k) * sx(k) + pz(a, k) * cz(k);
function travel(a, k) = along(a, k) + sqrt(L * L - (px(a, k) * px(a, k) + pz(a, k) * pz(a, k) - along(a, k) * along(a, k)));
function phi(a, k) = atan2(travel(a, k) * sx(k) - px(a, k), travel(a, k) * cz(k) - pz(a, k));

// One crank: eight r2 pins on independent throws, two r2.5 web hulls per throw,
// and a single r2 main shaft joining them along y.
module crank_part() {
  union() {
    // Main journals run between throw webs, not through them: a rod body at a
    // throw plane must not sweep through a continuous main shaft.
    for (k = [0:6]) {
      translate([0, insty(k) + 13, 0]) rotate([90, 0, 0]) cylinder(h = 18, r = 2, center = true);
    }
    translate([0, -98.5, 0]) rotate([90, 0, 0]) cylinder(h = 7, r = 2, center = true);
    translate([0, 98.5, 0]) rotate([90, 0, 0]) cylinder(h = 7, r = 2, center = true);
    for (k = [0:7]) {
      translate([px(crank_angle, k), insty(k), pz(crank_angle, k)])
        rotate([90, 0, 0]) cylinder(h = 10, r = 2, center = true);
      for (dy = [-4, 4]) {
        translate([0, insty(k) + dy, 0]) hull() {
          rotate([90, 0, 0]) cylinder(h = 1, r = 2.5, center = true);
          translate([px(crank_angle, k), 0, pz(crank_angle, k)])
            rotate([90, 0, 0]) cylinder(h = 1, r = 2.5, center = true);
        }
      }
    }
  }
}

// One block: base plate, two main-bearing plates with journal bores, a top rail,
// eight closed cylinder bores with a 1 mm head cap, two head rails and four
// outboard columns tied into the base plate.
module block_part() {
  union() {
    translate([0, 0, -20]) cube([32, 210, 3], center = true);
    for (by = [-98, 98]) {
      translate([0, by, 0]) difference() {
        cube([6, 1, 46], center = true);
        rotate([90, 0, 0]) cylinder(h = 3, r = 2.2, center = true, $fn = 32);
      }
    }
    translate([0, 0, 22]) cube([6, 196, 2], center = true);
    for (cy = [-96, 96]) {
      translate([42, cy, 1.5]) cube([2, 2, 43], center = true);
      translate([-42, cy, 1.5]) cube([2, 2, 43], center = true);
      translate([29, cy, -20]) cube([26, 2, 2], center = true);
      translate([-29, cy, -20]) cube([26, 2, 2], center = true);
    }
  }
}

module rod_local() {
  difference() {
    hull() {
      translate([0, 0, 0]) rotate([90, 0, 0]) cylinder(h = 4, r = 4, center = true);
      translate([0, 0, L]) rotate([90, 0, 0]) cylinder(h = 4, r = 3, center = true);
    }
    translate([0, 0, 0]) rotate([90, 0, 0]) cylinder(h = 6, r = 2.2, center = true);
  }
  translate([0, 0, L]) rotate([90, 0, 0]) cylinder(h = 12, r = 2, center = true);
}

module slider_local() {
  difference() {
    cylinder(h = 14, r = 9.75, center = true);
    rotate([90, 0, 0]) cylinder(h = 20, r = 2.2, center = true);
    translate([0, 2, -6]) cylinder(h = 4, r = 7, center = true);
    translate([0, 2, 0]) cylinder(h = 8, r = 5.5, center = true);
    translate([0, -2, -6]) cylinder(h = 4, r = 7, center = true);
    translate([0, -2, 0]) cylinder(h = 8, r = 5.5, center = true);
  }
}

module rod_pose(k) {
  translate([px(crank_angle, k), insty(k), pz(crank_angle, k)])
    rotate([0, phi(crank_angle, k), 0]) rod_local();
}

module slider_pose(k) {
  translate([travel(crank_angle, k) * sx(k), insty(k), travel(crank_angle, k) * cz(k)])
    rotate([0, atan2(sx(k), cz(k)), 0]) slider_local();
}

module selected_part(id) {
  if (id == "frame") block_part();
  if (id == "crank") crank_part();
  if (id == "rod0") rod_pose(0);
  if (id == "rod1") rod_pose(1);
  if (id == "rod2") rod_pose(2);
  if (id == "rod3") rod_pose(3);
  if (id == "rod4") rod_pose(4);
  if (id == "rod5") rod_pose(5);
  if (id == "rod6") rod_pose(6);
  if (id == "rod7") rod_pose(7);
  if (id == "slider0") slider_pose(0);
  if (id == "slider1") slider_pose(1);
  if (id == "slider2") slider_pose(2);
  if (id == "slider3") slider_pose(3);
  if (id == "slider4") slider_pose(4);
  if (id == "slider5") slider_pose(5);
  if (id == "slider6") slider_pose(6);
  if (id == "slider7") slider_pose(7);
  if (id == "all") {
    block_part();
    crank_part();
    for (k = [0:7]) rod_pose(k);
    for (k = [0:7]) slider_pose(k);
  }
}

selected_part(agentscad_part);
