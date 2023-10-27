import SpeedTest, { Results } from "@cloudflare/speedtest";

export async function performSpeedTest() {
  const speedTest = new SpeedTest({
    measurements: [
      { type: "latency", numPackets: 1 },
      { type: "download", bytes: 1e5, count: 1, bypassMinDuration: true },
      { type: "latency", numPackets: 10 },
      { type: "download", bytes: 1e7, count: 3 },
    ],
  });

  const speedTestResults = await new Promise<Results>((resolve, reject) => {
    speedTest.onFinish = (results) => resolve(results);
    speedTest.onError = (error) => reject(error);
  });
  const referenceDownloadSpeedBps =
    speedTestResults.getDownloadBandwidth() ?? 0;
  const referenceLatency = speedTestResults.getUnloadedLatency() ?? 0;

  return {
    referenceDownloadSpeedBps,
    referenceLatency,
  };
}
