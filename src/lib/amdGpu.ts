// AMD GPUs via the amdgpu kernel driver's sysfs files. No extra tools are
// needed (unlike nvidia-smi): everything is read from
// /sys/class/drm/card<N>/device and its hwmon directory. Returns [] when there
// is no amdgpu card. Fields a card or kernel doesn't expose come back null.
//
// AMD_DRM_ROOT overrides /sys/class/drm (used for testing against a fake tree).

import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import type { GpuInfo } from "@/lib/perfSampler";

const execFileAsync = promisify(execFile);
const DRM_ROOT = process.env.AMD_DRM_ROOT ?? "/sys/class/drm";

async function readText(p: string): Promise<string | null> {
  try {
    return (await fs.readFile(p, "utf8")).trim();
  } catch {
    return null;
  }
}

async function readNum(p: string): Promise<number | null> {
  const t = await readText(p);
  if (t == null || t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Card directories (card0, card1 …, not connectors like card0-DP-1) bound to amdgpu. */
async function amdCards(): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(DRM_ROOT);
  } catch {
    return [];
  }
  const cards = entries.filter((e) => /^card\d+$/.test(e)).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  const out: string[] = [];
  for (const card of cards) {
    const dev = path.join(DRM_ROOT, card, "device");
    const driver = await fs.readlink(path.join(dev, "driver")).catch(() => "");
    if (path.basename(driver) === "amdgpu") out.push(dev);
  }
  return out;
}

async function hwmonDir(dev: string): Promise<string | null> {
  try {
    const list = await fs.readdir(path.join(dev, "hwmon"));
    const first = list.find((h) => h.startsWith("hwmon"));
    return first ? path.join(dev, "hwmon", first) : null;
  } catch {
    return null;
  }
}

/** temp<N>_input whose temp<N>_label matches (amdgpu labels: edge, junction, mem). */
async function tempByLabel(hw: string, label: string): Promise<number | null> {
  for (let i = 1; i <= 4; i++) {
    const l = await readText(path.join(hw, `temp${i}_label`));
    if (l === label) {
      const v = await readNum(path.join(hw, `temp${i}_input`));
      return v == null ? null : v / 1000;
    }
  }
  return null;
}

/** pp_dpm_sclk / pp_dpm_mclk: "0: 500Mhz\n1: 1800Mhz *" → current (starred) and max. */
async function dpmClocks(file: string): Promise<{ cur: number | null; max: number | null }> {
  const raw = await readText(file);
  if (!raw) return { cur: null, max: null };
  let cur: number | null = null;
  let max: number | null = null;
  for (const line of raw.split("\n")) {
    const m = /(\d+)\s*Mhz/i.exec(line);
    if (!m) continue;
    const mhz = Number(m[1]);
    max = max == null ? mhz : Math.max(max, mhz);
    if (line.includes("*")) cur = mhz;
  }
  return { cur, max };
}

/** "16.0 GT/s PCIe" → PCIe generation 4. */
function pcieGen(speed: string | null): number | null {
  const m = speed ? /([\d.]+)\s*GT\/s/.exec(speed) : null;
  if (!m) return null;
  const gts = Number(m[1]);
  const gens: [number, number][] = [[2.5, 1], [5, 2], [8, 3], [16, 4], [32, 5], [64, 6]];
  const hit = gens.find(([g]) => Math.abs(g - gts) < 0.6);
  return hit ? hit[1] : null;
}

/** Marketing name from lspci when it's installed, else the PCI ids. */
async function cardName(dev: string): Promise<string> {
  const product = await readText(path.join(dev, "product_name"));
  if (product) return product;
  const slot = path.basename(await fs.realpath(dev).catch(() => dev));
  try {
    const { stdout } = await execFileAsync("lspci", ["-mm", "-s", slot], { timeout: 3000 });
    // "03:00.0 "VGA compatible controller" "Advanced Micro Devices, Inc. [AMD/ATI]" "Navi 21 [Radeon RX 6800/6800 XT / 6900 XT]" …
    const fields = [...stdout.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    if (fields[2]) return fields[2].includes("Radeon") ? fields[2] : `AMD ${fields[2]}`;
  } catch {
    // no lspci — fall through
  }
  const device = await readText(path.join(dev, "device"));
  return `AMD GPU${device ? ` (${device})` : ""}`;
}

/** Live stats for every amdgpu card, numbered from `startIndex`. */
export async function readAmdGpus(startIndex = 0): Promise<GpuInfo[]> {
  const devs = await amdCards();
  const out: GpuInfo[] = [];
  for (const [i, dev] of devs.entries()) {
    const hw = await hwmonDir(dev);
    const at = (f: string) => path.join(dev, f);
    const hwAt = (f: string) => (hw ? path.join(hw, f) : "/nonexistent");

    const [busy, memBusy, vramTotal, vramUsed, sclk, mclk] = await Promise.all([
      readNum(at("gpu_busy_percent")),
      readNum(at("mem_busy_percent")),
      readNum(at("mem_info_vram_total")),
      readNum(at("mem_info_vram_used")),
      dpmClocks(at("pp_dpm_sclk")),
      dpmClocks(at("pp_dpm_mclk")),
    ]);
    // power: power1_average on older kernels/cards, power1_input on newer (µW)
    const powerUw = (await readNum(hwAt("power1_average"))) ?? (await readNum(hwAt("power1_input")));
    const capUw = await readNum(hwAt("power1_cap"));
    const pwm = await readNum(hwAt("pwm1"));
    const pwmMax = (await readNum(hwAt("pwm1_max"))) ?? 255;
    // hwmon freq1_input (Hz) is the live shader clock where pp_dpm_* is absent
    const freq1 = await readNum(hwAt("freq1_input"));
    const freq2 = await readNum(hwAt("freq2_input"));

    out.push({
      index: startIndex + i,
      name: await cardName(dev),
      driver: `amdgpu (kernel ${os.release()})`,
      utilPct: busy ?? 0,
      memUtilPct: memBusy ?? 0,
      memTotalBytes: vramTotal ?? 0,
      memUsedBytes: vramUsed ?? 0,
      tempC: hw ? ((await tempByLabel(hw, "edge")) ?? (await tempByLabel(hw, "junction"))) : null,
      memTempC: hw ? await tempByLabel(hw, "mem") : null,
      powerDrawW: powerUw == null ? null : powerUw / 1e6,
      powerLimitW: capUw == null ? null : capUw / 1e6,
      fanPct: pwm == null ? null : Math.round((pwm / pwmMax) * 100),
      clockSmMhz: sclk.cur ?? (freq1 == null ? null : Math.round(freq1 / 1e6)),
      clockMemMhz: mclk.cur ?? (freq2 == null ? null : Math.round(freq2 / 1e6)),
      clockVideoMhz: null,
      clockMaxSmMhz: sclk.max,
      clockMaxMemMhz: mclk.max,
      encUtilPct: null,
      decUtilPct: null,
      encSessions: null,
      pcieGenCur: pcieGen(await readText(at("current_link_speed"))),
      pcieGenMax: pcieGen(await readText(at("max_link_speed"))),
      pcieWidthCur: await readNum(at("current_link_width")),
      pcieWidthMax: await readNum(at("max_link_width")),
      vbios: (await readText(at("vbios_version"))) ?? "",
      throttle: "",
      // amdgpu has no P-states like NVIDIA; show the DPM performance level instead
      pstate: (await readText(at("power_dpm_force_performance_level"))) ?? "",
    });
  }
  return out;
}

// byjohnmichael*
