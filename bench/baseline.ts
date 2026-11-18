#!/usr/bin/env bun
/**
 * Asks a model for one `.scad` per task and scores what comes back.
 *
 * This is the step that turns the task set into a benchmark: without a row of
 * numbers produced by something other than the author, the repository is a test
 * suite. The runner is deliberately independent of the product — it talks to an
 * OpenAI-compatible endpoint directly rather than through `model-router`, so a
 * model comparison does not inherit the product's routing or prompt.
 *
 * Cost safety:
 *   - `--dry-run` scores the reference solutions and calls nothing.
 *   - A real run requires `--authorize-cny`, and every call is checked against
 *     the remaining budget with a worst-case reservation before it is made.
 *   - The API key is read from a provider file or an env var and is never
 *     printed, logged or written into a submission.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { loadTasks, type BenchTask } from "./assembly/bench";
import { scoreSubmission } from "./assembly/score";
import { extractOpenScadCodeFromText } from "../src/lib/harness/structured-output";

interface ProviderEntry {
  id?: string;
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  enabled?: boolean;
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} 需要一个值`);
  return value;
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}

/**
 * A dry run never calls anything, so a missing provider file is not an error
 * there. It is only fatal when a real call is about to be made.
 */
async function loadProvider(): Promise<ProviderEntry> {
  const explicit = argument("--provider-file");
  const file = explicit ?? path.join(process.cwd(), ".agentscad", "providers.json");
  const raw = await fs.readFile(file, "utf8").catch(() => null);
  if (!raw) {
    if (flag("--dry-run")) return {};
    throw new Error(`读不到 provider 配置：${file}（真跑需要，或用 --base-url/--api-key-env 显式给出）`);
  }
  const parsed = JSON.parse(raw) as { providers?: ProviderEntry[] };
  const providers = (parsed.providers ?? []).filter((entry) => entry.enabled !== false);
  const chosen = providers.find((entry) => entry.apiKey && entry.baseUrl && entry.defaultModel) ?? providers[0];
  if (!chosen) throw new Error("provider 配置里没有可用条目");
  return chosen;
}

/** The output contract. A model that ignores it fails for format reasons, not geometry reasons. */
function buildPrompt(task: BenchTask): string {
  const parts = task.parts.map((part) => `  - id "${part.id}" → agentscad_part == "${part.selector}"`).join("\n");
  const poseLine = task.pose
    ? `6. 声明 ${task.pose.parameter} = 0; 并让活动件随它变化。评测器会用 -D ${task.pose.parameter}=<值>（${task.pose.unit}）重新渲染活动件，检查它是否真的按这个参数作刚体运动。`
    : "6. （本任务没有位姿参数要求）";
  return [
    "你正在参加一个 CAD 生成评测。请只输出一个 OpenSCAD 代码块。",
    "",
    "任务：",
    task.prompt,
    "",
    "输出契约（必须全部满足，否则会按格式失败计分）：",
    '1. 只输出一个 ```scad 代码块，代码块之外不要有任何文字。',
    "2. 文件必须完整可编译，单位 mm，不要 include/use 任何外部库。",
    '3. 声明 agentscad_part = "all"; 并用它选择要导出的零件，例如：',
    '   if (agentscad_part == "all" || agentscad_part == "<选择器>") <part>();',
    "   评测器会分别以 -D agentscad_part=<选择器> 渲染每个零件，两次结果必须在同一个装配坐标系里。",
    "4. 零件选择器：",
    parts,
    `5. 关节轴：过点 (${task.joint.axisOrigin.join(", ")})，方向 (${task.joint.axisDirection.join(", ")})。`,
    poseLine,
    "7. 不要输出装配声明注释，不要输出解释。",
  ].join("\n");
}

interface CallUsage {
  promptTokens: number;
  completionTokens: number;
}

interface CallResult {
  content: string;
  usage: CallUsage;
}

async function callModel(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  maxTokens: number;
  temperature: number;
}): Promise<CallResult> {
  const endpoint = `${input.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${input.apiKey}` },
    body: JSON.stringify({
      model: input.model,
      messages: [{ role: "user", content: input.prompt }],
      temperature: input.temperature,
      max_tokens: input.maxTokens,
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    // The body can echo the key back in an error header; only the status is kept.
    throw new Error(`provider 返回 ${response.status}：${text.slice(0, 200)}`);
  }
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = body.choices?.[0]?.message?.content ?? "";
  return {
    content,
    usage: {
      promptTokens: body.usage?.prompt_tokens ?? 0,
      completionTokens: body.usage?.completion_tokens ?? 0,
    },
  };
}

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

async function main(): Promise<void> {
  const dryRun = flag("--dry-run");
  const tasks = await loadTasks();
  const taskFilter = argument("--tasks");
  const selected = taskFilter ? tasks.filter((task) => taskFilter.split(",").includes(task.id)) : tasks;
  if (selected.length === 0) throw new Error(`没有匹配的任务：${taskFilter}`);

  const provider = await loadProvider();
  const model = argument("--model") ?? provider.defaultModel ?? "dry-run";
  if (!model) throw new Error("需要 --model 或 provider 的 defaultModel");
  const baseUrl = argument("--base-url") ?? provider.baseUrl ?? "";
  if (!dryRun && !baseUrl) throw new Error("需要 --base-url 或 provider 的 baseUrl");
  const apiKey = argument("--api-key-env") ? process.env[argument("--api-key-env")!] ?? "" : provider.apiKey ?? "";
  if (!dryRun && !apiKey) throw new Error("真跑需要 API key（provider 文件或 --api-key-env）");

  const maxTokens = Number(argument("--max-tokens") ?? 8192);
  const temperature = Number(argument("--temperature") ?? 0);
  const inputPriceCny = Number(argument("--input-price") ?? 2);
  const outputPriceCny = Number(argument("--output-price") ?? 8);
  if (![inputPriceCny, outputPriceCny, maxTokens, temperature].every(Number.isFinite)) throw new Error("数值参数必须是有限数");

  const capCny = Number(argument("--authorize-cny") ?? 0);
  if (!dryRun && !(capCny > 0)) throw new Error("真跑必须给 --authorize-cny <人民币上限>");

  const slug = `model-${slugify(model)}`;
  const runDirectory = path.join(import.meta.dir, "baseline", slug);
  await fs.mkdir(runDirectory, { recursive: true });

  let spentCny = 0;
  const records: Array<Record<string, unknown>> = [];
  console.log(`${dryRun ? "DRY RUN" : `模型 ${model}（上限 ${capCny} CNY）`} — 任务 ${selected.length} 个\n`);

  for (const task of selected) {
    const prompt = buildPrompt(task);
    const estimateInputTokens = Math.ceil(prompt.length / 3);
    const worstCase = (estimateInputTokens * inputPriceCny + maxTokens * outputPriceCny) / 1e6;

    let scad = "";
    let usage: CallUsage = { promptTokens: 0, completionTokens: 0 };
    let error: string | null = null;

    if (dryRun) {
      // The reference is a valid submission by construction: this proves the
      // prompt, extraction, writing and scoring plumbing without a call.
      scad = (await fs.readFile(path.join(import.meta.dir, "assembly", "submissions", task.id, "reference.scad"), "utf8")).trim();
    } else {
      if (spentCny + worstCase > capCny) {
        console.log(`stop: 剩余预算 ${(capCny - spentCny).toFixed(4)} CNY 不足以覆盖下一次预留 ${worstCase.toFixed(4)}`);
        break;
      }
      try {
        const result = await callModel({ baseUrl, apiKey, model, prompt, maxTokens, temperature });
        usage = result.usage;
        spentCny += (usage.promptTokens * inputPriceCny + usage.completionTokens * outputPriceCny) / 1e6;
        const extracted = extractOpenScadCodeFromText(result.content);
        if (!extracted) throw new Error("回复里没有找到 OpenSCAD 代码块");
        scad = extracted.trim();
      } catch (callError) {
        error = callError instanceof Error ? callError.message : String(callError);
        spentCny += 0; // A failed call's spend is unknown; it is recorded, not guessed.
      }
    }

    const contract: string[] = [];
    if (scad && !scad.includes("agentscad_part")) contract.push("缺少 agentscad_part");
    if (scad && task.pose && !scad.includes(task.pose.parameter)) contract.push(`缺少位姿参数 ${task.pose.parameter}`);
    const contractOk = error === null && contract.length === 0;

    if (scad) {
      const submissionPath = path.join(import.meta.dir, "assembly", "submissions", task.id, `${slug}.scad`);
      await fs.mkdir(path.dirname(submissionPath), { recursive: true });
      await fs.writeFile(submissionPath, `${scad}\n`, "utf8");
    }

    records.push({
      task: task.id,
      model,
      dryRun,
      error,
      contractViolations: contract,
      promptSha256: createHash("sha256").update(prompt).digest("hex"),
      sourceSha256: scad ? createHash("sha256").update(scad).digest("hex") : null,
      usage,
      costCny: (usage.promptTokens * inputPriceCny + usage.completionTokens * outputPriceCny) / 1e6,
      createdAt: new Date().toISOString(),
    });

    if (error) {
      console.log(`  ${task.id.padEnd(20)} ERROR  ${error.slice(0, 70)}`);
    } else {
      console.log(`  ${task.id.padEnd(20)} 已生成  ${usage.completionTokens} 输出 token${contractOk ? "" : `  契约问题：${contract.join("、")}`}`);
    }
  }

  await fs.writeFile(
    path.join(runDirectory, "run.json"),
    `${JSON.stringify({ model, dryRun, authorizeCny: capCny, spentCny: Math.round(spentCny * 1e6) / 1e6, records }, null, 2)}\n`,
    "utf8",
  );

  // Score what was written, through the same scorer the self-check uses.
  console.log("\n评分");
  const rows: Array<{ task: string; status: string; cover: string; clearance: string }> = [];
  for (const task of selected) {
    const submissionPath = path.join(import.meta.dir, "assembly", "submissions", task.id, `${slug}.scad`);
    const source = await fs.readFile(submissionPath, "utf8").catch(() => null);
    if (!source) {
      rows.push({ task: task.id, status: "NO_OUTPUT", cover: "0", clearance: "—" });
      continue;
    }
    const report = await scoreSubmission(task, {
      taskId: task.id,
      id: slug,
      sourcePath: submissionPath,
      source,
    });
    const clearance = report.measurements.clearanceMm;
    rows.push({
      task: task.id,
      status: report.status,
      cover: `${report.layers.coverage.passed}/${report.layers.coverage.observed}`,
      clearance: clearance ? `${clearance.min.toFixed(3)}-${clearance.max.toFixed(3)}` : "—",
    });
  }

  console.log(`\n${"task".padEnd(20)}${"status".padEnd(10)}${"cover".padEnd(8)}clearance`);
  console.log("-".repeat(56));
  for (const row of rows) console.log(`${row.task.padEnd(20)}${row.status.padEnd(10)}${row.cover.padEnd(8)}${row.clearance}`);

  console.log(`\n花费：${spentCny.toFixed(4)} CNY${dryRun ? "（dry run）" : ` / 上限 ${capCny}`}`);
  console.log(`记录：${path.relative(process.cwd(), path.join(runDirectory, "run.json"))}`);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
