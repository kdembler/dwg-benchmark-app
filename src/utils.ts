export function formatMbps(value: number) {
  return `${(value / 1e6).toFixed(2)} Mbps`;
}

export function formatMs(value: number) {
  return `${value.toFixed(2)} ms`;
}
