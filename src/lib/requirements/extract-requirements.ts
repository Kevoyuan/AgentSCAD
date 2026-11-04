/**
 * Deterministic extraction of a requirement contract from a natural-language
 * request, in Chinese or English.
 *
 * Rules:
 * - Only explicit statements become requirements. A mentioned but unquantified
 *   wish becomes an unknown with the question to ask, never a guessed number.
 * - Every requirement records the exact substring it came from, so a user can
 *   see why it is being asserted.
 * - Numbers are never invented. If the request says "small clearance", there is
 *   no clearance requirement, only a question.
 */
import { canonicalJson, sha256Hex } from "../canonical-json";
import type { ContractRequirement, RequirementContract, RequirementLayer } from "./requirement-contract";

export type IntentKind = RequirementContract["intent"]["kind"];

const INTENT_RULES: Array<{ kind: IntentKind; patterns: RegExp[] }> = [
  { kind: "multi-cylinder", patterns: [/\bv\s*-?\s*(?:6|8|10|12|16)\b/i, /(?:六|6|八|8|十|12|16)\s*缸/, /multi[- ]?cylinder/i, /engine block/i] },
  { kind: "crank-slider", patterns: [/曲柄|连杆|活塞|曲轴|crank|conrod|connecting rod|piston/i] },
  { kind: "gear-train", patterns: [/齿轮|行星|gear|planetary/i] },
  { kind: "threaded", patterns: [/螺纹|螺栓|螺母|螺丝|旋盖|thread|bolt|nut|screw/i] },
  { kind: "revolute-hinge", patterns: [/铰链|合页|hinge/i] },
  { kind: "assembly", patterns: [/装配体|装配|组装|assembly|assemble/i] },
];

const INTENT_LABEL: Record<IntentKind, string> = {
  "single-part": "single part",
  "revolute-hinge": "revolute hinge",
  threaded: "threaded connection",
  "gear-train": "gear train",
  "crank-slider": "crank-slider mechanism",
  "multi-cylinder": "multi-cylinder assembly",
  assembly: "assembly",
};

const CHINESE_DIGITS: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const ENGLISH_DIGITS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

function parseCount(raw: string): number | undefined {
  const value = raw.trim().toLowerCase();
  if (/^\d+$/.test(value)) return Number(value);
  if (ENGLISH_DIGITS[value] !== undefined) return ENGLISH_DIGITS[value];
  if (/^十[一二三四五六七八九]$/.test(value)) return 10 + CHINESE_DIGITS[value[1]];
  if (/^[一二三四五六七八九]十$/.test(value)) return CHINESE_DIGITS[value[0]] * 10;
  return CHINESE_DIGITS[value];
}

function firstMatch(text: string, patterns: RegExp[]): RegExpMatchArray | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match;
  }
  return null;
}

function normalizeNumber(raw: string): number {
  return Number(raw.replace(/[−–—]/g, "-").replace(/^\+/, ""));
}

interface Draft {
  requirements: ContractRequirement[];
  unknowns: RequirementContract["unknowns"];
  assumptions: string[];
}

function requirement(
  id: string,
  layer: RequirementLayer,
  expected: ContractRequirement["expected"],
  provenance: ContractRequirement["provenance"],
  statement: string | null,
): ContractRequirement {
  return { id, layer, required: true, applicable: true, expected, provenance, statement };
}

/**
 * Derives a contract. `capturedAt` and `revision` do not affect the contract
 * hash, so the same request always yields the same frozen contract.
 */
export function deriveRequirementContract(input: {
  request: string;
  capturedAt?: Date;
  revision?: number;
  targetLevel?: "digital" | "physical";
}): RequirementContract {
  const text = input.request.trim();
  if (!text) throw new Error("A non-empty request is required");
  if (text.length > 20_000) throw new Error("The request is too long to freeze");
  // Normalise dash variants once so every rule sees the same characters.
  const normalized = text.replace(/[−–—]/g, "-");

  const intentKind = INTENT_RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(normalized)))?.kind ?? "single-part";
  const draft: Draft = { requirements: [], unknowns: [], assumptions: [] };
  const addUnknown = (id: string, question: string, affects: RequirementLayer[]) => {
    if (!draft.unknowns.some((unknown) => unknown.id === id)) draft.unknowns.push({ id, question, affects });
  };

  // L1 is always asserted: losing a stated requirement is the failure this
  // whole contract exists to catch.
  draft.requirements.push(requirement("intent-preserved", "intent", { kind: "equals", value: true }, "default", null));

  // --- part count -----------------------------------------------------------
  const partMatch = firstMatch(normalized, [
    /(\d+|[一两二三四五六七八九十]+)\s*(?:个|件)\s*(?:独立|单独)?\s*(?:零件|部件)/,
    /([一两二三四五六七八九十]+|\d+)\s*件式/,
    /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:-|\s)?(?:part|piece)s?\b/i,
  ]);
  const partCount = partMatch ? parseCount(partMatch[1]) : undefined;
  if (partCount && partCount >= 1 && partCount <= 200) {
    draft.requirements.push(requirement("distinct-exported-parts", "parts", { kind: "equals", value: partCount }, "request", partMatch![0].trim()));
  }

  // --- disassembly ----------------------------------------------------------
  const forbidsDisassembly = /不可拆|不可拆卸|不能拆|non-?removable|not\s+removable|permanent(?:ly)?\s+(?:fixed|joined)/i.test(normalized);
  const wantsDisassembly = !forbidsDisassembly && /可拆|可拆卸|拆下|拆卸|抽离|拔出|取出|removab|disassembl|detach|pull(?:ed)?\s*out|take\s+apart/i.test(normalized);
  if (wantsDisassembly) {
    const statement = firstMatch(normalized, [/可拆|可拆卸|拆下|拆卸|抽离|拔出|取出/i, /removab\w*|disassembl\w*|detach\w*|pull(?:ed)?\s*out|take\s+apart/i]);
    draft.requirements.push(requirement("disassembly-path", "assembly", { kind: "equals", value: true }, "request", statement?.[0].trim() ?? null));
  }

  // --- motion ---------------------------------------------------------------
  const motionWord = firstMatch(normalized, [/转动|旋转|回转|能转|转起来|rotate|rotat\w*|turn|spin|swivel/i]);
  const rangeMatch = firstMatch(normalized, [
    /(-?\d+(?:\.\d+)?)\s*(?:°|度|deg(?:rees)?)?\s*(?:到|至|~|～|to|through)\s*(\+?\d+(?:\.\d+)?)\s*(?:°|度|deg(?:rees)?)/i,
    /(?:±|\+\/-)\s*(\d+(?:\.\d+)?)\s*(?:°|度|deg(?:rees)?)?/,
  ]);
  let motionRange: { min: number; max: number } | null = null;
  if (rangeMatch) {
    if (rangeMatch.length === 3) {
      const a = normalizeNumber(rangeMatch[1]);
      const b = normalizeNumber(rangeMatch[2]);
      motionRange = { min: Math.min(a, b), max: Math.max(a, b) };
    } else {
      const amplitude = normalizeNumber(rangeMatch[1]);
      motionRange = { min: -Math.abs(amplitude), max: Math.abs(amplitude) };
    }
  }
  if (motionWord || motionRange) {
    draft.requirements.push(requirement("sampled-motion", "motion", { kind: "equals", value: true }, "request", motionWord?.[0].trim() ?? rangeMatch?.[0].trim() ?? null));
  }
  if (motionRange) {
    // "Can rotate ±45°" is a lower bound on travel, not an interval the motion
    // must stay inside. Modelling it as a range would make a mechanism that
    // turns further fail for turning further, which is the opposite of what the
    // request asks for. The magnitude of the largest reach is the assertion.
    const reach = Math.max(Math.abs(motionRange.min), Math.abs(motionRange.max));
    draft.requirements.push(requirement("motion-range-deg", "motion", { kind: "atLeast", min: reach, unit: "deg" }, "request", rangeMatch![0].trim()));
  } else if (motionWord) {
    addUnknown("motion-range", "转动范围未给出：需要明确角度上下限才能验收运动。", ["motion"]);
  }

  // --- clearance ------------------------------------------------------------
  const clearanceRange = firstMatch(normalized, [
    /(?:直径|径向)?\s*间隙\s*(?:为|是|:|：)?\s*(\d+(?:\.\d+)?)\s*(?:mm|毫米)?\s*(?:到|至|~|～|-)\s*(\d+(?:\.\d+)?)\s*(?:mm|毫米)/,
    /clearance[^0-9]{0,12}(\d+(?:\.\d+)?)\s*(?:to|-|~)\s*(\d+(?:\.\d+)?)\s*mm/i,
  ]);
  const toleranceMatch = firstMatch(normalized, [/(\d+(?:\.\d+)?)\s*±\s*(\d+(?:\.\d+)?)\s*(?:mm|毫米)/]);
  const singleClearance = firstMatch(normalized, [
    /(?:直径|径向)?\s*间隙\s*(?:为|是|:|：)?\s*(\d+(?:\.\d+)?)\s*(?:mm|毫米)/,
    /clearance[^0-9]{0,12}(\d+(?:\.\d+)?)\s*mm/i,
  ]);
  if (clearanceRange) {
    const a = normalizeNumber(clearanceRange[1]);
    const b = normalizeNumber(clearanceRange[2]);
    draft.requirements.push(requirement("diametral-clearance", "assembly", { kind: "range", min: Math.min(a, b), max: Math.max(a, b), unit: "mm" }, "request", clearanceRange[0].trim()));
  } else if (toleranceMatch) {
    const nominal = normalizeNumber(toleranceMatch[1]);
    const tolerance = Math.abs(normalizeNumber(toleranceMatch[2]));
    draft.requirements.push(requirement("diametral-clearance", "assembly", { kind: "range", min: nominal - tolerance, max: nominal + tolerance, unit: "mm" }, "request", toleranceMatch[0].trim()));
  } else if (singleClearance) {
    addUnknown("clearance-tolerance", `请求只给出一个间隙值（${singleClearance[1]} mm），没有公差范围；单一数值无法验收。`, ["assembly"]);
  } else if (/间隙|clearance|配合/i.test(normalized)) {
    addUnknown("clearance-tolerance", "请求提到间隙/配合但没有给出数值范围：无法据此验收。", ["assembly"]);
  }

  // --- manufacturing --------------------------------------------------------
  const processTokens = [
    { pattern: /FDM/i, label: "FDM" },
    { pattern: /SLA|光固化/i, label: "SLA" },
    { pattern: /3D\s*打印|三维打印|打印|3d\s*print/i, label: "3D printing" },
    { pattern: /CNC|数控|机加工|machin(?:e|ing)/i, label: "CNC machining" },
    { pattern: /激光切割|laser\s*cut/i, label: "laser cutting" },
    { pattern: /注塑|injection/i, label: "injection moulding" },
  ];
  const processes = processTokens.filter((token) => token.pattern.test(normalized)).map((token) => token.label);
  const materialMatch = firstMatch(normalized, [/\b(PLA|ABS|PETG|ASA|TPU|尼龙|树脂|铝合金|不锈钢|黄铜)\b/i, /(尼龙|树脂|铝合金|不锈钢|黄铜)/]);
  if (processes.length === 0) addUnknown("manufacturing-process", "制造工艺未指定：工艺决定公差与可行性。", ["physical"]);
  if (!materialMatch) addUnknown("material", "材料未指定：强度、收缩与摩擦都依赖材料。", ["physical"]);
  if (processes.length > 0) addUnknown("process-parameters", "打印方向、机器与切片参数未给出：同一模型不同工艺参数会得到不同配合。", ["physical"]);

  // --- load, life, environment ---------------------------------------------
  if (/承重|负载|载荷|受力|扭矩|load|payload|torque|N·?m|牛顿/i.test(normalized)) {
    addUnknown("load", "载荷条件未量化：需要数值、方向与作用点才能验证强度。", ["physical"]);
  }
  if (/寿命|循环|疲劳|耐久|cycle|fatigue|durab/i.test(normalized)) {
    addUnknown("life", "寿命要求未量化：需要循环次数与失效判据。", ["physical"]);
  }

  // --- units ---------------------------------------------------------------
  const mentionsInch = /英寸|inch|\bin\b|"/i.test(normalized);
  const mentionsMm = /mm|毫米/i.test(normalized);
  if (mentionsInch && mentionsMm) {
    addUnknown("units", "请求同时出现英寸与毫米：必须确认换算，不能默认。", ["intent", "assembly"]);
  } else if (mentionsInch) {
    addUnknown("units", "请求使用英寸：需要确认换算到毫米后的数值。", ["intent", "assembly"]);
  } else if (!mentionsMm) {
    draft.assumptions.push("请求未写明单位，按毫米理解。");
  }

  // --- intent-specific gaps ------------------------------------------------
  if (intentKind === "revolute-hinge") {
    if (wantsDisassembly) addUnknown("axial-retention", "轴向保持方式未说明：可抽离与自保持在功能上是不同合同。", ["assembly", "motion"]);
    if (!clearanceRange && !toleranceMatch) addUnknown("hinge-fit", "孔与轴的直径及配合公差未给出。", ["assembly"]);
  }
  if (intentKind === "threaded") addUnknown("thread-geometry", "螺距、旋向、公差等级未给出。", ["assembly"]);
  if (intentKind === "gear-train") addUnknown("gear-geometry", "模数、齿数、压力角与侧隙未给出。", ["assembly", "motion"]);
  if (intentKind === "crank-slider") addUnknown("crank-geometry", "曲柄半径、连杆长度与行程未给出。", ["motion"]);
  if (intentKind === "multi-cylinder") {
    addUnknown("cylinder-layout", "缸数、V 角、缸心距与曲柄相位未定义；点火顺序不等于机械相位。", ["motion", "assembly"]);
    addUnknown("cylinder-parts", "每个气缸的活塞、连杆、销轴数量与布置未给出。", ["parts", "motion"]);
  }

  if ((input.targetLevel ?? "digital") === "digital") {
    draft.assumptions.push("本合同的验收范围为数字证据（L1–L4），实物功能不在范围内。");
  }

  const requestSha256 = sha256Hex(text);
  return {
    schemaVersion: 1,
    id: `req-${requestSha256.slice(0, 12)}`,
    revision: input.revision ?? 1,
    requestSha256,
    capturedAt: (input.capturedAt ?? new Date()).toISOString(),
    targetLevel: input.targetLevel ?? "digital",
    intent: { kind: intentKind, summary: INTENT_LABEL[intentKind] },
    requirements: draft.requirements,
    unknowns: draft.unknowns,
    assumptions: draft.assumptions,
  };
}

/** Convenience for tests and callers that only need the frozen hash of a draft. */
export function draftContractHash(request: string): string {
  return sha256Hex(canonicalJson({ request: request.trim() }));
}
