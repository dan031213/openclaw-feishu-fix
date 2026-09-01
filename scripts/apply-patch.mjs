#!/usr/bin/env node
/**
 * OpenClaw 飞书插件流式卡顿补丁
 *
 * 对 @openclaw/feishu v2026.8.1 的 dist/monitor.account-*.js 应用 3 处修改：
 *   1. update() 节流条件去掉 `!shouldForceUpdate && ` 前缀（节流对所有更新生效）
 *   2. STREAMING_UPDATE_THROTTLE_MS   160 -> 400
 *   3. STREAMING_SIGNIFICANT_DELTA_CHARS 18 -> 8
 *
 * 特性：幂等（已打过的补丁跳过）；任一条匹配 0 次或多次都拒绝执行，不会产生半截补丁。
 * 用法：node apply-patch.mjs [--check]
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CHECK_ONLY = process.argv.includes("--check");
const ROOT = path.join(os.homedir(), ".openclaw", "npm", "projects");

const PATCHES = [
  {
    name: "throttle-gates-all-updates",
    find: "if (!shouldForceUpdate && now - this.lastUpdateTime < this.updateThrottleMs) {",
    replace: "if (now - this.lastUpdateTime < this.updateThrottleMs) {",
  },
  {
    name: "STREAMING_UPDATE_THROTTLE_MS 160->400",
    find: "STREAMING_UPDATE_THROTTLE_MS = 160",
    replace: "STREAMING_UPDATE_THROTTLE_MS = 400",
  },
  {
    name: "STREAMING_SIGNIFICANT_DELTA_CHARS 18->8",
    find: "STREAMING_SIGNIFICANT_DELTA_CHARS = 18",
    replace: "STREAMING_SIGNIFICANT_DELTA_CHARS = 8",
  },
];

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// 定位插件 dist：~/.openclaw/npm/projects/**/node_modules/@openclaw/feishu/dist/monitor.account-*.js
if (!fs.existsSync(ROOT)) fail(`目录不存在：${ROOT}（请确认 OpenClaw 插件安装位置）`);

const candidates = [];
(function walk(dir, depth) {
  if (depth > 6) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "dist" && dir.endsWith(path.join("@openclaw", "feishu"))) {
        for (const f of fs.readdirSync(full)) {
          if (/^monitor\.account-.*\.js$/.test(f)) candidates.push(path.join(full, f));
        }
      } else {
        walk(full, depth + 1);
      }
    }
  }
})(ROOT, 0);

if (candidates.length === 0) fail("未找到 monitor.account-*.js（插件是否已安装/版本是否兼容？）");
if (candidates.length > 1) fail(`找到多个目标文件，请手动确认：\n  ${candidates.join("\n  ")}`);

const file = candidates[0];
let src = fs.readFileSync(file, "utf8");
console.log(`目标：${file}`);

let applied = 0, already = 0, pending = 0;
const planned = [];
for (const p of PATCHES) {
  const nFind = src.split(p.find).length - 1;
  const nDone = src.split(p.replace).length - 1;
  if (nFind === 1) { planned.push(p); pending++; }
  else if (nFind === 0 && nDone >= 1) { already++; }
  else fail(`补丁 [${p.name}] 匹配 ${nFind} 次（预期 1 次），中止。插件版本可能已变化，请检查后更新匹配串。`);
}

for (const p of planned) {
  if (CHECK_ONLY) { console.log(`  [dry-run] 将应用：${p.name}`); continue; }
  src = src.replace(p.find, p.replace);
  applied++;
}

if (!CHECK_ONLY && planned.length) fs.writeFileSync(file, src);

console.log(`\n${CHECK_ONLY ? "检查完成" : "完成"}：新应用 ${applied}，已是补丁态 ${already}，待应用 ${CHECK_ONLY ? pending : planned.length - applied}`);
if (planned.length === 0) console.log("所有补丁均已生效，无需操作。");
else if (!CHECK_ONLY) console.log("如插件被 `openclaw plugins update feishu` 还原，重跑本脚本即可。");
