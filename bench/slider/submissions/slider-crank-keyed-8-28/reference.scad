// Original low-speed slider-crank verification fixture, millimetres.
// Five original parts: a removable transverse key now retains the rod on
// the eccentric pin. Main shaft and slider retention remain unresolved.
// The key itself has no latch: only geometric blocking, not physical security, is tested.
agentscad_part = "all";
agentscad_pose = false;
motion_angle = 0;
crank_radius = 8;
rod_length = 28;
$fn = 64;

// All pin axes are parallel to +Y; the mechanism moves in the XZ plane.
module y_cylinder(radius, height) { rotate([-90, 0, 0]) cylinder(r=radius, h=height); }
module crank_local() {
  difference() {
    union() {
    translate([0, -4, 0]) y_cylinder(crank_radius + 3, 4);
    translate([0, -9, 0]) y_cylinder(2, 5.1);
    translate([0, -0.1, crank_radius]) y_cylinder(2, 6.1);
    }
    translate([-3, 5, crank_radius]) rotate([0, 90, 0]) cylinder(r=0.7, h=6);
  }
}
module eccentric_key_local() {
  // +X withdrawal; the enlarged head stays on the positive side.
  rotate([0, 90, 0]) union() {
    translate([0, 0, -4]) cylinder(r=0.5, h=8.1);
    translate([0, 0, 4]) cylinder(r=0.8, h=1);
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
  if (id == "eccentric_key") {
    if (placed) rotate([0, motion_angle, 0]) translate([0, 5, crank_radius]) eccentric_key_local();
    else eccentric_key_local();
  }
  if (id == "frame") frame_local();
  if (id == "crank") rotate([0, placed ? motion_angle : 0, 0]) crank_local();
  if (id == "rod") translate(placed ? [cx, 0, cz] : [0, 0, 0])
    rotate([0, placed ? rod_angle : 0, 0]) rod_local();
  if (id == "slider") translate([0, 0, placed ? pz : 0]) slider_local();
}
module generated_part() {
  if (agentscad_part == "all") {
    for (id = ["frame", "crank", "rod", "slider", "eccentric_key"]) selected_part(id, true);
  } else selected_part(agentscad_part, agentscad_pose);
}
generated_part();

/* AGENTSCAD_ASSEMBLY_V1
{
  "schemaVersion": 1,
  "units": "mm",
  "coordinateSystem": "right-handed",
  "parts": [
    {
      "id": "frame",
      "name": "frame",
      "selector": "frame",
      "source": "generated",
      "material": null
    },
    {
      "id": "crank",
      "name": "crank",
      "selector": "crank",
      "source": "generated",
      "material": null
    },
    {
      "id": "rod",
      "name": "rod",
      "selector": "rod",
      "source": "generated",
      "material": null
    },
    {
      "id": "slider",
      "name": "slider",
      "selector": "slider",
      "source": "generated",
      "material": null
    },
    {
      "id": "eccentric_key",
      "name": "eccentric_key",
      "selector": "eccentric_key",
      "source": "generated",
      "material": null
    }
  ],
  "instances": [
    {
      "id": "frame",
      "partId": "frame",
      "subassemblyId": null,
      "transform": [
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1
      ]
    },
    {
      "id": "crank",
      "partId": "crank",
      "subassemblyId": null,
      "transform": [
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1
      ]
    },
    {
      "id": "rod",
      "partId": "rod",
      "subassemblyId": null,
      "transform": [
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        8,
        0,
        0,
        0,
        1
      ]
    },
    {
      "id": "slider",
      "partId": "slider",
      "subassemblyId": null,
      "transform": [
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        36,
        0,
        0,
        0,
        1
      ]
    },
    {
      "id": "eccentric_key",
      "partId": "eccentric_key",
      "subassemblyId": null,
      "transform": [
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        5,
        0,
        0,
        1,
        8,
        0,
        0,
        0,
        1
      ]
    }
  ],
  "subassemblies": [],
  "groundedInstanceId": "frame",
  "connections": [
    {
      "id": "main_shaft",
      "type": "revolute",
      "a": "frame",
      "b": "crank",
      "frameA": {
        "origin": [
          0,
          0,
          0
        ],
        "direction": [
          0,
          1,
          0
        ]
      },
      "frameB": {
        "origin": [
          0,
          0,
          0
        ],
        "direction": [
          0,
          1,
          0
        ]
      },
      "range": null,
      "pitchMm": null,
      "ratio": null,
      "allowedContact": []
    },
    {
      "id": "eccentric",
      "type": "revolute",
      "a": "crank",
      "b": "rod",
      "frameA": {
        "origin": [
          0,
          0,
          8
        ],
        "direction": [
          0,
          1,
          0
        ]
      },
      "frameB": {
        "origin": [
          0,
          0,
          0
        ],
        "direction": [
          0,
          1,
          0
        ]
      },
      "range": null,
      "pitchMm": null,
      "ratio": null,
      "allowedContact": []
    },
    {
      "id": "wrist",
      "type": "revolute",
      "a": "rod",
      "b": "slider",
      "frameA": {
        "origin": [
          0,
          0,
          28
        ],
        "direction": [
          0,
          1,
          0
        ]
      },
      "frameB": {
        "origin": [
          0,
          0,
          0
        ],
        "direction": [
          0,
          1,
          0
        ]
      },
      "range": null,
      "pitchMm": null,
      "ratio": null,
      "allowedContact": []
    },
    {
      "id": "guide",
      "type": "prismatic",
      "a": "frame",
      "b": "slider",
      "frameA": {
        "origin": [
          0,
          0,
          36
        ],
        "direction": [
          0,
          0,
          1
        ]
      },
      "frameB": {
        "origin": [
          0,
          0,
          0
        ],
        "direction": [
          0,
          0,
          1
        ]
      },
      "range": null,
      "pitchMm": null,
      "ratio": null,
      "allowedContact": []
    },
    {
      "id": "key_removal",
      "type": "other",
      "a": "crank",
      "b": "eccentric_key",
      "frameA": {
        "origin": [
          0,
          5,
          8
        ],
        "direction": [
          1,
          0,
          0
        ]
      },
      "frameB": {
        "origin": [
          0,
          0,
          0
        ],
        "direction": [
          1,
          0,
          0
        ]
      },
      "range": null,
      "pitchMm": null,
      "ratio": null,
      "allowedContact": []
    }
  ],
  "motions": [
    {
      "id": "input_turn",
      "inputConnectionId": "main_shaft",
      "range": {
        "min": 0,
        "max": 360,
        "unit": "deg"
      }
    }
  ],
  "operations": [
    {
      "id": "remove_1",
      "action": "disassemble",
      "instanceId": "eccentric_key",
      "waypoints": [
        [
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          5,
          0,
          0,
          1,
          8,
          0,
          0,
          0,
          1
        ],
        [
          1,
          0,
          0,
          30,
          0,
          1,
          0,
          5,
          0,
          0,
          1,
          8,
          0,
          0,
          0,
          1
        ]
      ],
      "tools": []
    },
    {
      "id": "remove_2",
      "action": "disassemble",
      "instanceId": "slider",
      "waypoints": [
        [
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1,
          36,
          0,
          0,
          0,
          1
        ],
        [
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          20,
          0,
          0,
          1,
          36,
          0,
          0,
          0,
          1
        ]
      ],
      "tools": []
    },
    {
      "id": "remove_3",
      "action": "disassemble",
      "instanceId": "rod",
      "waypoints": [
        [
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1,
          8,
          0,
          0,
          0,
          1
        ],
        [
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          20,
          0,
          0,
          1,
          8,
          0,
          0,
          0,
          1
        ]
      ],
      "tools": []
    },
    {
      "id": "remove_4",
      "action": "disassemble",
      "instanceId": "crank",
      "waypoints": [
        [
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1
        ],
        [
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          20,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1
        ]
      ],
      "tools": []
    }
  ],
  "manufacturing": null,
  "assumptions": [
    "Manifest placement describes input angle 0 degrees only.",
    "Joint types describe intended relationships, not verified constraints."
  ],
  "unknowns": [
    "Key has no anti-withdrawal latch.",
    "Main shaft axial retention and full slider guidance are unresolved.",
    "Material, process, tolerances, tool access and physical function are unverified."
  ]
}
END_AGENTSCAD_ASSEMBLY */
