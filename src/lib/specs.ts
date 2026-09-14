import { execFile } from "child_process";
import { promisify } from "util";
import { promises as fs } from "fs";
import os from "os";

const execFileAsync = promisify(execFile);

/** execFile that never throws — returns trimmed stdout or null. */
async function run(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 8000 });
    return stdout.trim();
  } catch (err) {
    const out = (err as { stdout?: string }).stdout;
    return typeof out === "string" && out.trim() ? out.trim() : null;
  }
}

async function readText(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

/** "key: value" lines → Map (first colon wins, both sides trimmed). */
function parseKv(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k) map.set(k, v);
  }
  return map;
}

export type MemoryModule = {
  locator: string;
  sizeBytes: number;
  type: string;
  speed: string;
  manufacturer: string;
  partNumber: string;
};

// every physical DIMM slot in board order, whether or not it's populated
export type MemSlot = {
  index: number;
  locator: string;
  present: boolean;
  sizeBytes: number;
  type: string;
  speed: string;
  manufacturer: string;
  partNumber: string;
};

export type Specs = {
  os: { distro: string; kernel: string; hostname: string; arch: string };
  cpu: {
    model: string;
    vendor: string;
    arch: string | null;
    cores: number;
    threads: number;
    sockets: number;
    numaNodes: number;
    smt: string; // "Enabled" | "Disabled" | "Not supported"
    threadsPerCore: number;
    baseGhz: number | null;
    maxMhz: number | null;
    minMhz: number | null;
    l1d: string | null;
    l1i: string | null;
    l1: string | null;
    l2: string | null;
    l3: string | null;
    socket: string | null;
    virtualization: string | null;
    family: number | null;
    modelId: number | null;
    stepping: number | null;
  };
  memory: {
    totalBytes: number;
    maxCapacity: string | null;
    slotsUsed: number;
    slotsTotal: number;
    type: string | null;
    speed: string | null;
    modules: MemoryModule[];
    slots: MemSlot[];
  };
  motherboard: {
    manufacturer: string;
    product: string;
    version: string | null;
  } | null;
  bios: { vendor: string; version: string; date: string } | null;
  gpus: {
    name: string;
    memory: string;
    driver: string;
    vbios: string | null;
    pcie: string | null;
  }[];
  storage: {
    name: string;
    model: string;
    sizeBytes: number;
    bus: string;
    rotational: boolean;
  }[];
  network: {
    iface: string;
    description: string;
    driver: string;
    speedMbps: number | null;
    up: boolean;
  }[];
  error: string | null;
};

/* --------------------------------------------------------------- collectors */

async function readOs(): Promise<Specs["os"]> {
  const rel = (await readText("/etc/os-release")) ?? "";
  const pretty = /PRETTY_NAME="?(.+?)"?\s*$/m.exec(rel);
  const name = /^NAME="?(.+?)"?\s*$/m.exec(rel);
  return {
    distro: pretty?.[1] || name?.[1] || "Linux",
    kernel: os.release(),
    hostname: os.hostname(),
    arch: os.arch(),
  };
}

async function readCpu(): Promise<Specs["cpu"]> {
  const [out, smtCtl] = await Promise.all([
    run("lscpu", []).then((s) => s ?? ""),
    readText("/sys/devices/system/cpu/smt/control"),
  ]);
  const kv = parseKv(out);
  const model = kv.get("Model name") || os.cpus()[0]?.model?.trim() || "CPU";
  const perSocket = Number(kv.get("Core(s) per socket") || 0);
  const sockets = Number(kv.get("Socket(s)") || 1) || 1;
  const threadsPerCore = Number(kv.get("Thread(s) per core") || 1) || 1;
  const cache = (key: string) => {
    const v = kv.get(key);
    return v ? v.split(" (")[0].trim() : null;
  };
  const baseMatch = /@\s*([\d.]+)\s*GHz/i.exec(model);

  const ctl = (smtCtl || "").trim();
  const smt =
    ctl === "on" || threadsPerCore > 1
      ? "Enabled"
      : ctl === "off"
        ? "Disabled"
        : ctl === "notsupported"
          ? "Not supported"
          : threadsPerCore > 1
            ? "Enabled"
            : "Disabled";

  const l1d = cache("L1d cache");
  const l1i = cache("L1i cache");

  return {
    model,
    vendor: kv.get("Vendor ID") || "",
    arch: kv.get("Architecture") || os.arch(),
    cores: perSocket && sockets ? perSocket * sockets : os.cpus().length,
    threads: Number(kv.get("CPU(s)") || 0) || os.cpus().length,
    sockets,
    numaNodes: Number(kv.get("NUMA node(s)") || 1) || 1,
    smt,
    threadsPerCore,
    baseGhz: baseMatch ? Number(baseMatch[1]) : null,
    maxMhz: kv.get("CPU max MHz") ? Math.round(Number(kv.get("CPU max MHz"))) : null,
    minMhz: kv.get("CPU min MHz") ? Math.round(Number(kv.get("CPU min MHz"))) : null,
    l1d,
    l1i,
    l1: l1d,
    l2: cache("L2 cache"),
    l3: cache("L3 cache"),
    socket: `${sockets}`,
    virtualization: kv.get("Virtualization") || null,
    family: Number(kv.get("CPU family")) || null,
    modelId: kv.get("Model") ? Number(kv.get("Model")) : null,
    stepping: kv.get("Stepping") ? Number(kv.get("Stepping")) : null,
  };
}

function parseSize(raw: string): number {
  // dmidecode: "8 GiB", "16384 MB", "No Module Installed"
  const m = /^(\d+)\s*(TB|GB|MB|KB|TiB|GiB|MiB|KiB)/i.exec(raw.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult: Record<string, number> = {
    kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12,
    kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4,
  };
  return n * (mult[unit] ?? 1);
}

async function readMemory(): Promise<Specs["memory"]> {
  const out = await run("sudo", ["dmidecode", "-t", "memory"]);
  const modules: MemoryModule[] = [];
  const slots: MemSlot[] = [];
  let maxCapacity: string | null = null;
  let slotsTotal = 0;

  if (out) {
    for (const block of out.split(/\n\n+/)) {
      const kv = parseKv(block);
      if (kv.has("Maximum Capacity")) {
        maxCapacity = kv.get("Maximum Capacity") || null;
        slotsTotal = Number(kv.get("Number Of Devices") || 0) || slotsTotal;
        continue;
      }
      if (!kv.has("Locator") || !kv.has("Size")) continue;
      const size = kv.get("Size") || "";
      const present = !/no module/i.test(size);
      const entry = {
        locator: kv.get("Locator") || "",
        sizeBytes: present ? parseSize(size) : 0,
        type: present ? kv.get("Type") || "" : "",
        speed: present
          ? kv.get("Configured Memory Speed") || kv.get("Speed") || ""
          : "",
        manufacturer: present
          ? (kv.get("Manufacturer") || "").replace(/^0x[0-9A-Fa-f]+$/, "").trim()
          : "",
        partNumber: present ? (kv.get("Part Number") || "").trim() : "",
      };
      slots.push({ index: slots.length, present, ...entry });
      if (present) modules.push(entry);
    }
  }

  const totalFromModules = modules.reduce((a, m) => a + m.sizeBytes, 0);
  return {
    totalBytes: totalFromModules || os.totalmem(),
    maxCapacity,
    slotsUsed: modules.length,
    slotsTotal: slotsTotal || slots.length || modules.length,
    type: modules[0]?.type || null,
    speed: modules[0]?.speed || null,
    modules,
    slots,
  };
}

async function readBoard(): Promise<Specs["motherboard"]> {
  const out = await run("sudo", ["dmidecode", "-t", "baseboard"]);
  if (!out) return null;
  const kv = parseKv(out);
  const manufacturer = (kv.get("Manufacturer") || "")
    .replace(
      /\s+(COMPUTER\s+INC|INC|LLC|CO\.?,?\s*LTD|CO\.?,?\s*LIMITED|CORPORATION|CORP|TECHNOLOGY|ELECTRONICS)\.?/gi,
      "",
    )
    .replace(/[\s.,]+$/, "")
    .trim();
  const product = kv.get("Product Name") || "";
  if (!manufacturer && !product) return null;
  return {
    manufacturer,
    product,
    version:
      kv.get("Version") && !/^(rev x\.0x|default string)$/i.test(kv.get("Version")!)
        ? kv.get("Version")!
        : null,
  };
}

async function readBios(): Promise<Specs["bios"]> {
  const out = await run("sudo", ["dmidecode", "-t", "bios"]);
  if (!out) return null;
  const kv = parseKv(out);
  if (!kv.get("Version")) return null;
  return {
    vendor: kv.get("Vendor") || "",
    version: kv.get("Version") || "",
    date: kv.get("Release Date") || "",
  };
}

async function readGpus(): Promise<Specs["gpus"]> {
  const out = await run("nvidia-smi", [
    "--query-gpu=name,memory.total,driver_version,vbios_version,pcie.link.gen.max,pcie.link.width.max",
    "--format=csv,noheader",
  ]);
  if (!out) return [];
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const c = line.split(",").map((x) => x.trim());
      const gen = c[4] && c[4] !== "[N/A]" ? c[4] : null;
      const width = c[5] && c[5] !== "[N/A]" ? c[5].replace(/^x?/, "x") : null;
      return {
        name: c[0] || "GPU",
        memory: c[1] || "",
        driver: c[2] || "",
        vbios: c[3] && c[3] !== "[N/A]" ? c[3] : null,
        pcie: gen ? `PCIe ${gen}.0${width ? ` ${width}` : ""}` : null,
      };
    });
}

async function readStorage(): Promise<Specs["storage"]> {
  const out = await run("lsblk", [
    "-dn",
    "-b",
    "-o",
    "NAME,SIZE,MODEL,ROTA,TRAN",
  ]);
  if (!out) return [];
  const rows: Specs["storage"] = [];
  for (const line of out.split("\n")) {
    // MODEL can contain spaces; parse from both ends
    const m = /^(\S+)\s+(\d+)\s+(.*?)\s+([01])\s+(\S+)?$/.exec(line.trim());
    if (!m) continue;
    const name = m[1];
    if (/^(zram|loop|ram)/.test(name)) continue;
    rows.push({
      name,
      model: m[3].trim() || name,
      sizeBytes: Number(m[2]),
      bus: (m[5] || "").toUpperCase(),
      rotational: m[4] === "1",
    });
  }
  return rows;
}

async function readNetwork(): Promise<Specs["network"]> {
  let ifaces: string[];
  try {
    ifaces = await fs.readdir("/sys/class/net");
  } catch {
    return [];
  }
  ifaces = ifaces.filter(
    (i) => !/^(lo|docker|veth|br-|virbr|tap|tun|tailscale)/.test(i),
  );

  // one lspci pass for friendly names, matched by PCI address
  const lspci = (await run("lspci", [])) ?? "";
  const pciName = new Map<string, string>();
  for (const line of lspci.split("\n")) {
    const m = /^(\S+)\s+(.*)$/.exec(line);
    if (m) pciName.set(m[1], m[2]);
  }

  const out: Specs["network"] = [];
  for (const iface of ifaces.sort()) {
    const [driverLink, operstate, speed, addr] = await Promise.all([
      fs
        .readlink(`/sys/class/net/${iface}/device/driver`)
        .then((p) => p.split("/").pop() || "")
        .catch(() => ""),
      readText(`/sys/class/net/${iface}/operstate`),
      readText(`/sys/class/net/${iface}/speed`),
      fs
        .readlink(`/sys/class/net/${iface}/device`)
        .then((p) => (p.split("/").pop() || "").replace(/^0000:/, ""))
        .catch(() => ""),
    ]);
    let description = "";
    for (const [pciAddr, name] of pciName) {
      if (pciAddr === addr || `0000:${pciAddr}` === addr || pciAddr.endsWith(addr)) {
        description = name
          .replace(/^(Ethernet|Network) controller:\s*/, "")
          .replace(/\s*Semiconductor Co\.,? Ltd\.?/i, "")
          .replace(/\s*Corporation/i, "")
          .replace(/\s*Co\.,? Ltd\.?/i, "")
          .replace(/\s*PCI Express/i, "")
          .replace(/\s*\(rev [0-9a-f]+\)\s*$/i, "")
          .replace(/\s{2,}/g, " ")
          .trim();
        break;
      }
    }
    const sp = speed ? Number(speed.trim()) : NaN;
    out.push({
      iface,
      description,
      driver: driverLink,
      speedMbps: Number.isFinite(sp) && sp > 0 ? sp : null,
      up: operstate?.trim() === "up",
    });
  }
  return out;
}

/* ------------------------------------------------------------------ public */

let cache: Specs | null = null;
let inflight: Promise<Specs> | null = null;

async function build(): Promise<Specs> {
  try {
    const [osInfo, cpu, memory, motherboard, bios, gpus, storage, network] =
      await Promise.all([
        readOs(),
        readCpu(),
        readMemory(),
        readBoard(),
        readBios(),
        readGpus(),
        readStorage(),
        readNetwork(),
      ]);
    return {
      os: osInfo,
      cpu,
      memory,
      motherboard,
      bios,
      gpus,
      storage,
      network,
      error: null,
    };
  } catch (err) {
    return {
      os: { distro: "Linux", kernel: os.release(), hostname: os.hostname(), arch: os.arch() },
      cpu: {
        model: os.cpus()[0]?.model?.trim() || "CPU",
        vendor: "",
        arch: os.arch(),
        cores: os.cpus().length,
        threads: os.cpus().length,
        sockets: 1,
        numaNodes: 1,
        smt: "Unknown",
        threadsPerCore: 1,
        baseGhz: null,
        maxMhz: null,
        minMhz: null,
        l1d: null,
        l1i: null,
        l1: null,
        l2: null,
        l3: null,
        socket: null,
        virtualization: null,
        family: null,
        modelId: null,
        stepping: null,
      },
      memory: {
        totalBytes: os.totalmem(),
        maxCapacity: null,
        slotsUsed: 0,
        slotsTotal: 0,
        type: null,
        speed: null,
        modules: [],
        slots: [],
      },
      motherboard: null,
      bios: null,
      gpus: [],
      storage: [],
      network: [],
      error: (err as Error).message ?? String(err),
    };
  }
}

/** Hardware inventory. Never changes at runtime, so it's built once and cached
 * for the life of the process. */
export async function getSpecs(): Promise<Specs> {
  if (cache) return cache;
  if (!inflight) {
    inflight = build().then((s) => {
      cache = s;
      inflight = null;
      return s;
    });
  }
  return inflight;
}

// byjohnmichael*
