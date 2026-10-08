// Start the perf sampler at server boot. Without this it only starts on the
// first /api/performance request, so history would have gaps whenever nobody
// had the dashboard open.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureSampler } = await import("@/lib/perfSampler");
  ensureSampler();
}
