import { runBenchmark } from "./benchmark";
import { formatMbps, formatMs } from "./utils";

// const URL = "https://gateway.joyutils.org/distributor/api/v1/assets/270397";
const URL = "https://dist1.joyutils.org/distributor/api/v1/assets/270397";
const SIZE = 20 * 1e6;
const RUNS = 3;

const result = await runBenchmark(URL, SIZE, RUNS);
if (result.status === "error") {
  console.error("Benchmark failed", result.error);
} else {
  console.log("Download speed: ", formatMbps(result.downloadSpeedBps));
  console.log("TTFB: ", formatMs(result.ttfb));
  console.log("Downloaded: ", result.downloadSize / 1e6, "MB");
}
