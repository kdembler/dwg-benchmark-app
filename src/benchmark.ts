export type BenchmarkResult =
  | {
      ttfb: number;
      totalRequestTime: number;
      downloadTime: number;
      downloadSize: number;
      downloadSpeedBps: number;
      url: string;
      cacheStatus: string;
    }
  | {
      url: string;
      error: string;
    };

export async function runBenchmark(
  url: string,
  maxDownloadSize: number
): Promise<BenchmarkResult> {
  console.log(`Running test for ${url}`);
  try {
    const controller = new AbortController();
    const signal = controller.signal;
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const startFetchTime = performance.now();
    const response = await fetch(url, { signal });
    clearTimeout(timeoutId);

    const ttfb = performance.now() - startFetchTime;

    if (!response.ok) {
      return {
        url,
        error: `Failed with status ${response.status} ${response.statusText}`,
      };
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return {
        url,
        error: "Couldn't read response body",
      };
    }

    let receivedSize = 0;
    const startReadTime = performance.now();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      receivedSize += value.length;
      if (receivedSize >= maxDownloadSize) {
        await reader.cancel();
        break;
      }
    }
    const endFetchTime = performance.now();
    const readTime = endFetchTime - startReadTime;
    const downloadSpeedBps = (receivedSize * 8) / (readTime / 1000); // bits per second

    return {
      ttfb,
      totalRequestTime: endFetchTime - startFetchTime,
      downloadTime: readTime,
      downloadSpeedBps,
      downloadSize: receivedSize,
      url: url,
      cacheStatus: response.headers.get("X-Cache") || "unknown",
    };
  } catch (e) {
    return {
      url,
      error: (e as any)?.message,
    };
  }
}
