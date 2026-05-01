import { buildScadPrompt, loadFamilySchema, loadSkill, applyParameterOverrides } from "@/lib/skill-resolver";
import { createChatCompletionWithFallback } from "@/lib/tools/model-router";
import { sanitizeGeneratedScadSource } from "@/lib/tools/scad-sanitizer";
import { validateGeneratedScadSource } from "@/lib/tools/scad-renderer";
import {
  extractParameterDefsFromScad,
  mergeExtractedParameters,
} from "@/lib/tools/scad-parameter-extractor";
import { normalizeGenerationResult } from "@/lib/harness/structured-output";
import type { ParameterDef, PartFamily, StructuredGenerationResult } from "@/lib/harness/types";

export { buildScadPrompt, loadFamilySchema, loadSkill, applyParameterOverrides };

export const FALLBACK_SCHEMAS: Record<string, ParameterDef[]> = {
  spur_gear: [
    { key: "teeth", label: "Number of Teeth", kind: "integer", unit: "", value: 20, min: 8, max: 200, step: 1, source: "user", editable: true, description: "Total number of teeth on the gear", group: "geometry" },
    { key: "outer_diameter", label: "Outer Diameter", kind: "float", unit: "mm", value: 50, min: 10, max: 500, step: 0.5, source: "user", editable: true, description: "Outer (tip) diameter of the gear", group: "geometry" },
    { key: "bore_diameter", label: "Bore Diameter", kind: "float", unit: "mm", value: 8, min: 2, max: 100, step: 0.5, source: "user", editable: true, description: "Central bore hole diameter", group: "geometry" },
    { key: "thickness", label: "Gear Thickness", kind: "float", unit: "mm", value: 8, min: 2, max: 100, step: 0.5, source: "user", editable: true, description: "Thickness (width) of the gear face", group: "geometry" },
    { key: "pressure_angle", label: "Pressure Angle", kind: "float", unit: "deg", value: 20, min: 14.5, max: 25, step: 0.5, source: "engineering", editable: true, description: "Involute pressure angle in degrees", group: "engineering" },
  ],
  device_stand: [
    { key: "device_width", label: "Device Width", kind: "float", unit: "mm", value: 75, min: 30, max: 400, step: 1, source: "user", editable: true, description: "Width of the device to hold", group: "device" },
    { key: "device_depth", label: "Device Depth", kind: "float", unit: "mm", value: 12, min: 5, max: 50, step: 0.5, source: "user", editable: true, description: "Depth (thickness) of the device", group: "device" },
    { key: "stand_height", label: "Stand Height", kind: "float", unit: "mm", value: 80, min: 30, max: 300, step: 1, source: "user", editable: true, description: "Total height of the stand", group: "geometry" },
    { key: "lip_height", label: "Lip Height", kind: "float", unit: "mm", value: 10, min: 3, max: 40, step: 0.5, source: "user", editable: true, description: "Height of the front retaining lip", group: "geometry" },
    { key: "wall_thickness", label: "Wall Thickness", kind: "float", unit: "mm", value: 3, min: 1.2, max: 10, step: 0.2, source: "engineering", editable: true, description: "Wall thickness for structural integrity", group: "engineering" },
    { key: "base_flare", label: "Base Flare", kind: "float", unit: "mm", value: 20, min: 0, max: 60, step: 1, source: "user", editable: true, description: "Extra width added to the base for stability", group: "geometry" },
    { key: "arch_radius", label: "Arch Radius", kind: "float", unit: "mm", value: 30, min: 10, max: 100, step: 1, source: "engineering", editable: true, description: "Radius of the support arch", group: "geometry" },
    { key: "arch_peak", label: "Arch Peak Offset", kind: "float", unit: "mm", value: 15, min: 0, max: 50, step: 1, source: "engineering", editable: true, description: "Forward offset of the arch peak", group: "geometry" },
  ],
  electronics_enclosure: [
    { key: "width", label: "Enclosure Width", kind: "float", unit: "mm", value: 60, min: 20, max: 300, step: 1, source: "user", editable: true, description: "Internal width of the enclosure", group: "geometry" },
    { key: "depth", label: "Enclosure Depth", kind: "float", unit: "mm", value: 40, min: 20, max: 300, step: 1, source: "user", editable: true, description: "Internal depth of the enclosure", group: "geometry" },
    { key: "height", label: "Enclosure Height", kind: "float", unit: "mm", value: 25, min: 10, max: 200, step: 1, source: "user", editable: true, description: "Internal height of the enclosure", group: "geometry" },
    { key: "wall_thickness", label: "Wall Thickness", kind: "float", unit: "mm", value: 2, min: 1.2, max: 10, step: 0.2, source: "engineering", editable: true, description: "Uniform wall thickness", group: "engineering" },
    { key: "corner_radius", label: "Corner Radius", kind: "float", unit: "mm", value: 3, min: 0, max: 20, step: 0.5, source: "user", editable: true, description: "Fillet radius on exterior corners", group: "geometry" },
    { key: "clearance", label: "Fit Clearance", kind: "float", unit: "mm", value: 0.2, min: 0, max: 1, step: 0.05, source: "engineering", editable: true, description: "Clearance between lid and body", group: "engineering" },
  ],
  phone_case: [
    { key: "body_length", label: "Body Length", kind: "float", unit: "mm", value: 158, min: 100, max: 200, step: 0.5, source: "user", editable: true, description: "Length of the phone body", group: "device" },
    { key: "body_width", label: "Body Width", kind: "float", unit: "mm", value: 78, min: 50, max: 120, step: 0.5, source: "user", editable: true, description: "Width of the phone body", group: "device" },
    { key: "body_depth", label: "Body Depth", kind: "float", unit: "mm", value: 8, min: 5, max: 15, step: 0.5, source: "user", editable: true, description: "Depth (thickness) of the phone body", group: "device" },
    { key: "wall_thickness", label: "Wall Thickness", kind: "float", unit: "mm", value: 1.5, min: 1.2, max: 4, step: 0.1, source: "engineering", editable: true, description: "Case wall thickness", group: "engineering" },
    { key: "camera_clearance", label: "Camera Clearance", kind: "float", unit: "mm", value: 1, min: 0, max: 5, step: 0.25, source: "user", editable: true, description: "Extra clearance around camera bump", group: "geometry" },
  ],
};

export const UNKNOWN_FALLBACK_SCHEMA: ParameterDef[] = [
  { key: "width", label: "Width", kind: "float", unit: "mm", value: 40, min: 5, max: 500, step: 1, source: "user", editable: true, description: "Width of the part", group: "geometry" },
  { key: "depth", label: "Depth", kind: "float", unit: "mm", value: 30, min: 5, max: 500, step: 1, source: "user", editable: true, description: "Depth of the part", group: "geometry" },
  { key: "height", label: "Height", kind: "float", unit: "mm", value: 15, min: 5, max: 500, step: 1, source: "user", editable: true, description: "Height of the part", group: "geometry" },
  { key: "wall_thickness", label: "Wall Thickness", kind: "float", unit: "mm", value: 2, min: 1.2, max: 10, step: 0.2, source: "engineering", editable: true, description: "Wall thickness", group: "engineering" },
  { key: "min_feature_width", label: "Minimum Feature Width", kind: "float", unit: "mm", value: 1.6, min: 1.2, max: 10, step: 0.2, source: "engineering", editable: true, description: "Minimum printable width for decorative ribs, reliefs, rims, bridges, and connection features", group: "engineering" },
];

export function detectPartFamily(request: string): PartFamily {
  const lower = request.toLowerCase();
  const compact = lower.replace(/[\s_-]+/g, "");

  if (lower.includes("spur gear") || lower.includes("gear") || lower.includes(" involute")) return "spur_gear";
  if (
    lower.includes("device stand") ||
    lower.includes("phone stand") ||
    lower.includes("tablet stand") ||
    lower.includes("monitor stand") ||
    lower.includes("laptop stand") ||
    lower.includes("stand") ||
    lower.includes("holder") ||
    lower.includes("dock")
  ) {
    return "device_stand";
  }
  if (
    lower.includes("enclosure") ||
    lower.includes("electronics box") ||
    lower.includes("project box") ||
    lower.includes("junction box") ||
    lower.includes("case box")
  ) {
    return "electronics_enclosure";
  }
  if (
    lower.includes("phone case") ||
    lower.includes("phone cover") ||
    lower.includes("phone sleeve") ||
    lower.includes("smartphone case") ||
    lower.includes("iphone case") ||
    compact.includes("iphonecase") ||
    compact.includes("smartphonecase") ||
    lower.includes("手机壳") ||
    lower.includes("手机套") ||
    lower.includes("保护壳") ||
    lower.includes("保护套") ||
    /iphone\d*(pro|max|plus)?/.test(compact)
  ) {
    return "phone_case";
  }

  return "unknown";
}

export async function getParameterSchema(
  family: PartFamily,
  parameterValues: Record<string, unknown>
): Promise<ParameterDef[]> {
  const schemaFile = await loadFamilySchema(family);
  const baseSchema = schemaFile?.parameters ?? (FALLBACK_SCHEMAS[family] ?? UNKNOWN_FALLBACK_SCHEMA);
  return applyParameterOverrides(baseSchema, parameterValues);
}

function emptyStructuredDefaults(): Pick<
  StructuredGenerationResult,
  "part_type" | "units" | "features" | "constraints" | "modeling_plan" | "design_rationale" | "validation_targets"
> {
  return {
    part_type: "unknown",
    units: "mm",
    features: [],
    constraints: {
      dimensions: {},
      assumptions: [],
      manufacturing: { min_wall_thickness: 2, printable: true },
      geometry: { must_be_manifold: true, centered: true, no_floating_parts: true },
      code: { use_parameters: true, use_library_modules: true, avoid_magic_numbers: true, top_level_module: "generated_part" },
    },
    modeling_plan: [],
    design_rationale: [],
    validation_targets: {
      expected_bbox: [],
      required_feature_checks: [],
      forbidden_failure_modes: [],
    },
  };
}

async function generateMockScadCode(
  inputRequest: string,
  parameterValues: Record<string, unknown>
): Promise<StructuredGenerationResult> {
  const partFamily = detectPartFamily(inputRequest);
  const paramSchema = await getParameterSchema(partFamily, parameterValues);
  const ts = new Date().toISOString();

  const assignments = paramSchema
    .map((p) => {
      const val = p.kind === "integer" ? Math.round(p.value) : p.value;
      return `${p.key} = ${val};`;
    })
    .join("\n");

  let scadSource = "";
  let summary = "";
  let features: StructuredGenerationResult["features"] = [];
  let modelingPlan: string[] = [];
  let validationBbox: number[] = [];

  switch (partFamily) {
    case "spur_gear": {
      const teeth = (parameterValues.teeth as number) ?? 20;
      const outerDiam = (parameterValues.outer_diameter as number) ?? 50;
      const boreD = (parameterValues.bore_diameter as number) ?? 8;
      const thickness = (parameterValues.thickness as number) ?? 8;
      summary = `Spur gear with ${teeth} teeth, ${outerDiam}mm outer diameter`;
      features = [
        { name: "gear body", type: "base", required: true, parameters: { teeth, outer_diameter: outerDiam }, description: "Spur gear with involute-profile teeth" },
        { name: "center bore", type: "hole", required: true, parameters: { bore_diameter: boreD }, description: "Central shaft bore" },
      ];
      modelingPlan = ["Create the gear body with teeth.", "Subtract the center bore.", "Call generated_part()."];
      validationBbox = [outerDiam, outerDiam, thickness];
      scadSource = `// Generated by AgentSCAD
// Part Family: spur_gear
// Generated at: ${ts}

include <agentscad_std.scad>;

${assignments}

module spur_gear(teeth, outer_diameter, bore_diameter, thickness, pressure_angle) {
  tooth_module = outer_diameter / teeth;
  pitch_diameter = outer_diameter - 2 * tooth_module;
  tooth_depth = tooth_module * 2.2;

  difference() {
    union() {
      cylinder(h=thickness, d=outer_diameter, $fn=teeth, center=true);
      for (i = [0:teeth-1]) {
        rotate([0, 0, i * 360 / teeth])
          translate([pitch_diameter/2, 0, 0])
            cube([tooth_depth, tooth_module, thickness], center=true);
      }
    }
    cylinder(h=thickness+2, d=bore_diameter, $fn=64, center=true);
  }
}

module generated_part() {
  spur_gear(teeth, outer_diameter, bore_diameter, thickness, pressure_angle);
}

generated_part();`;
      break;
    }

    case "device_stand": {
      const dw = (parameterValues.device_width as number) ?? 75;
      const sh = (parameterValues.stand_height as number) ?? 80;
      summary = `Device stand for ${dw}mm wide device, ${sh}mm tall`;
      features = [
        { name: "base plate", type: "base", required: true, parameters: { device_width: dw }, description: "Stable base with flare for anti-tip" },
        { name: "retention lip", type: "mount", required: true, parameters: {}, description: "Front lip to retain device" },
      ];
      modelingPlan = ["Create the weighted base.", "Add the vertical support face.", "Add the retention lip.", "Call generated_part()."];
      validationBbox = [dw + 40, 50, sh];
      scadSource = `// Generated by AgentSCAD
// Part Family: device_stand
// Generated at: ${ts}

${assignments}

module device_stand(device_width, device_depth, stand_height, lip_height,
                    wall_thickness, base_flare, arch_radius, arch_peak) {
  base_w = device_width + 2*wall_thickness + base_flare*2;
  base_d = device_depth + 2*wall_thickness + 30;

  translate([0, 0, wall_thickness/2])
    minkowski() {
      cube([base_w - 4, base_d - 4, wall_thickness - 1], center=true);
      cylinder(r=2, h=0.5, $fn=32);
    }

  translate([0, -base_d/2 + wall_thickness, stand_height/2])
    hull() {
      cube([device_width + 2*wall_thickness, wall_thickness, stand_height], center=true);
    }

  translate([0, device_depth/2 + wall_thickness, lip_height/2])
    cube([device_width + 2*wall_thickness, wall_thickness, lip_height], center=true);

  translate([arch_peak, -base_d/2 + wall_thickness*2, 0])
    cylinder(r=arch_radius, h=wall_thickness, $fn=64, center=true);
}

module generated_part() {
  device_stand(device_width, device_depth, stand_height, lip_height,
               wall_thickness, base_flare, arch_radius, arch_peak);
}

generated_part();`;
      break;
    }

    case "phone_case": {
      const bl = (parameterValues.body_length as number) ?? 158;
      const bw = (parameterValues.body_width as number) ?? 78;
      const bd = (parameterValues.body_depth as number) ?? 8;
      summary = `Phone case for ${bl}x${bw}x${bd}mm device with camera opening, speaker holes, button cutouts, and charging port`;
      features = [
        { name: "outer shell", type: "enclosure", required: true, parameters: { body_length: bl, body_width: bw }, description: "Snap-fit phone case shell" },
        { name: "camera cutout", type: "cutout", required: true, parameters: {}, description: "Camera bump clearance opening" },
        { name: "speaker grille", type: "cutout", required: true, parameters: {}, description: "Bottom speaker holes" },
        { name: "button cutouts", type: "cutout", required: true, parameters: {}, description: "Power and volume button access" },
      ];
      modelingPlan = ["Create the outer shell with rounded corners.", "Subtract the inner phone cavity.", "Add screen opening on front face.", "Add camera, speaker, button, and charging port cutouts.", "Call generated_part()."];
      validationBbox = [bl + 4, bw + 4, bd + 2];
      scadSource = `// Generated by AgentSCAD
// Part Family: phone_case
// Generated at: ${ts}

${assignments}

module phone_case(body_length, body_width, body_depth,
                  wall_thickness, camera_clearance) {
  outer_l = body_length + 2*wall_thickness;
  outer_w = body_width + 2*wall_thickness;
  outer_d = body_depth + wall_thickness;
  corner_r = 8;
  screen_margin = corner_r + 4;

  difference() {
    minkowski() {
      cube([outer_l - 2*corner_r, outer_w - 2*corner_r, outer_d - 1], center=true);
      cylinder(r=corner_r, h=0.5, $fn=64);
    }

    translate([0, 0, wall_thickness])
      minkowski() {
        cube([body_length - 2*corner_r, body_width - 2*corner_r, body_depth + 0.5], center=true);
        cylinder(r=corner_r, h=0.5, $fn=64);
      }

    translate([0, 0, outer_d/2 - 0.5])
      cube([body_length - 2*screen_margin, body_width - 2*screen_margin, wall_thickness + 3], center=true);

    translate([-body_length/2 + 18, -body_width/2 + 18, outer_d/2])
      cylinder(r=6 + camera_clearance, h=wall_thickness + 3, $fn=64);

    for (spk = [-8, 0, 8]) {
      translate([body_length/2 - 20 + spk, body_width/2, 0]) rotate([90, 0, 0])
        cylinder(r=1, h=wall_thickness + 2, $fn=16, center=true);
    }

    translate([body_length/2 - 10, body_width/2, 0])
      cube([8, wall_thickness + 2, 2.5], center=true);

    translate([body_length/2, 0, body_depth * 0.3]) rotate([0, 90, 0])
      cylinder(r=4, h=wall_thickness + 2, $fn=32, center=true);

    translate([-body_length/2, 0, body_depth * 0.3]) rotate([0, 90, 0])
      cylinder(r=2.5, h=wall_thickness + 2, $fn=32, center=true);
    translate([-body_length/2, 0, -body_depth * 0.1]) rotate([0, 90, 0])
      cylinder(r=2.5, h=wall_thickness + 2, $fn=32, center=true);
  }
}

module generated_part() {
  phone_case(body_length, body_width, body_depth, wall_thickness, camera_clearance);
}

generated_part();`;
      break;
    }

    case "electronics_enclosure":
    default: {
      const w = (parameterValues.width as number) ?? 60;
      const d = (parameterValues.depth as number) ?? 40;
      const h = (parameterValues.height as number) ?? 25;
      const wt = (parameterValues.wall_thickness as number) ?? 2;
      summary = `Electronics enclosure ${w}x${d}x${h}mm, ${wt}mm walls`;
      features = [
        { name: "bottom shell", type: "enclosure", required: true, parameters: { width: w, depth: d, height: h }, description: "Main enclosure body with rounded corners" },
        { name: "lid", type: "enclosure", required: true, parameters: {}, description: "Removable lid with clearance fit" },
      ];
      modelingPlan = ["Create the enclosure bottom shell with internal cavity.", "Create the lid with clearance offset.", "Call generated_part()."];
      validationBbox = [w + 2 * wt, d + 2 * wt, h + wt];
      scadSource = `// Generated by AgentSCAD
// Part Family: ${partFamily}
// Generated at: ${ts}

include <agentscad_std.scad>;

${assignments}

module generated_part() {
  enclosure_box(
    width = width,
    depth = depth,
    height = height,
    wall = wall_thickness,
    corner_r = corner_radius
  );

  translate([0, depth + 20, 0])
    enclosure_lid(
      width = width,
      depth = depth,
      wall = wall_thickness,
      corner_r = corner_radius,
      clearance = clearance
    );
}

generated_part();`;
      break;
    }
  }

  return {
    ...emptyStructuredDefaults(),
    part_type: partFamily,
    summary,
    features,
    modeling_plan: modelingPlan,
    validation_targets: {
      expected_bbox: validationBbox,
      required_feature_checks: ["single connected body"],
      forbidden_failure_modes: ["missing features", "floating parts", "non-manifold mesh"],
    },
    parameters: paramSchema,
    scad_source: scadSource,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { generateMockScadCode, delay };

export async function runScadGenerationSkill(
  inputRequest: string,
  parameterValues: Record<string, unknown>,
  requestedModel?: string | null
): Promise<StructuredGenerationResult> {
  const partFamily = detectPartFamily(inputRequest);
  const paramSchema = await getParameterSchema(partFamily, parameterValues);
  const prompt = await buildScadPrompt(inputRequest, partFamily, parameterValues);

  if (!prompt) {
    throw new Error("scad-generation skill is missing");
  }

  const rawContent = await createChatCompletionWithFallback({
    messages: [
      { role: "system", content: prompt.systemPrompt },
      { role: "user", content: prompt.userPrompt },
    ],
    model: requestedModel?.trim() || undefined,
    stream: false,
  });

  const generationResult = normalizeGenerationResult(
    rawContent,
    paramSchema,
    `Generated ${partFamily} part`
  );
  const sanitizedScadSource = sanitizeGeneratedScadSource(generationResult.scad_source);
  await validateGeneratedScadSource(sanitizedScadSource);
  const extractedParameters = mergeExtractedParameters(
    extractParameterDefsFromScad(sanitizedScadSource),
    generationResult.parameters
  );

  return {
    ...generationResult,
    parameters: extractedParameters,
    scad_source: sanitizedScadSource,
  };
}
