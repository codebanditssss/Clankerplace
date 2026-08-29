const POD_NAMES = [
  "bright-forge",
  "calm-orbit",
  "cinder-lab",
  "cosmic-hatch",
  "crisp-signal",
  "daily-spark",
  "drift-node",
  "ember-loop",
  "fresh-vector",
  "glow-stack",
  "happy-daemon",
  "hollow-star",
  "lucky-relay",
  "lunar-pilot",
  "mint-cache",
  "neon-harbor",
  "nimble-core",
  "northbeam",
  "nova-shell",
  "pixel-foundry",
  "quiet-bolt",
  "rapid-capsule",
  "silver-pulse",
  "small-rocket",
  "solar-thread",
  "spark-vault",
  "steady-socket",
  "tidy-agent",
  "tiny-moon",
  "velvet-pod",
  "warm-kernel",
  "wild-terminal",
];

export function generatePodName(): string {
  const base =
    POD_NAMES[Math.floor(Math.random() * POD_NAMES.length)] ?? "fresh-pod";
  const suffix = Math.random().toString(36).slice(2, 5);
  return `${base}-${suffix}`;
}
