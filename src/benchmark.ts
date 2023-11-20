type SuccessBenchmarkResult = {
  status: "success";
  ttfb: number;
  totalRequestTime: number;
  downloadTime: number;
  downloadSize: number;
  downloadSpeedBps: number;
  dnsLookupTime?: number;
  sslTime?: number;
  processingTime?: number;
  url: string;
  cacheStatus: string;
};

type ErrorBenchmarkResult = {
  status: "error";
  url: string;
  error: string;
};

export type BenchmarkResult = SuccessBenchmarkResult | ErrorBenchmarkResult;

async function withTimeout<T>(
  promise: Promise<T>,
  timeout: number
): Promise<T | null> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => resolve(null), timeout);
    promise.then((result) => {
      clearTimeout(timeoutId);
      resolve(result);
    });
  });
}

export async function runBenchmark(
  url: string,
  maxDownloadSize: number,
  numRuns = 1
): Promise<BenchmarkResult> {
  if (numRuns < 1) {
    throw new Error("numRuns must be at least 1");
  }

  const maxTime = 20000;

  const results: BenchmarkResult[] = [];
  for (let i = 0; i < numRuns; i++) {
    const result = await withTimeout(
      runSingleBenchmark(url, maxDownloadSize, maxTime),
      maxTime + 2000
    );
    if (!result) {
      results.push({
        status: "error",
        url,
        error: "unexpected timeout",
      });
    } else {
      results.push(result);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return aggregateBenchmarkResults(results);
}

async function runSingleBenchmark(
  url: string,
  maxDownloadSize: number,
  maxTime: number
): Promise<BenchmarkResult> {
  console.log(`Running test for ${url}`);
  try {
    const controller = new AbortController();
    const signal = controller.signal;
    const responseTimeoutId = setTimeout(() => {
      return controller.abort();
    }, 5000);

    const startFetchTime = performance.now();
    const headers = new Headers({
      Range: `bytes=0-${maxDownloadSize - 1}`,
      "Cache-Control": "no-cache",
    });
    const response = await fetch(url, { signal, headers });
    clearTimeout(responseTimeoutId);

    const responseStartTime = performance.now();

    if (!response.ok) {
      return {
        status: "error",
        url,
        error: `Failed with status ${response.status} ${response.statusText}`,
      };
    }

    const startReadTime = performance.now();
    let receivedSize = 0;
    const reader = response.body?.getReader();
    if (!reader) {
      return {
        status: "error",
        url,
        error: "No reader found",
      };
    }
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      receivedSize += value?.byteLength ?? 0;
      if (performance.now() - startReadTime > maxTime) {
        console.log("Aborting due to timeout");
        reader.cancel();
        controller.abort();
        break;
      }
    }
    const endFetchTime = performance.now();
    const readTime = endFetchTime - startReadTime;

    let ttfb, totalRequestTime, downloadTime: number;
    let dnsLookupTime, sslTime, processingTime: number | undefined;

    const performanceEntry = performance?.getEntriesByName?.(
      url
    )?.[0] as PerformanceResourceTiming; // TODO: check type
    if (performanceEntry) {
      const {
        fetchStart,
        domainLookupStart,
        domainLookupEnd,
        secureConnectionStart,
        connectEnd,
        responseStart,
        responseEnd,
        duration,
      } = performanceEntry;
      ttfb = responseStart - fetchStart;
      totalRequestTime = duration;
      downloadTime = responseEnd - responseStart;
      dnsLookupTime = domainLookupEnd - domainLookupStart;
      sslTime = connectEnd - secureConnectionStart;
      processingTime = responseStart - connectEnd;
    } else {
      console.warn("No performance entry found");
      ttfb = responseStartTime - startFetchTime;
      totalRequestTime = endFetchTime - startFetchTime;
      downloadTime = readTime;
    }

    if (ttfb < 0) {
      ttfb = responseStartTime - startFetchTime;
    }

    if (totalRequestTime < 0) {
      totalRequestTime = endFetchTime - startFetchTime;
    }

    if (downloadTime < 0) {
      downloadTime = readTime;
    }

    if (totalRequestTime < 30) {
      // too good to be true
      return {
        status: "error",
        url,
        error: "request time below 30ms",
      };
    }

    const downloadSpeedBps =
      (receivedSize * 8) / (Math.max(downloadTime, 1) / 1000); // bits per second
    if (downloadSpeedBps > 1e9) {
      // too good to be true
      return {
        status: "error",
        url,
        error: "download speed above 1Gbps",
      };
    }

    return {
      status: "success",
      ttfb,
      totalRequestTime,
      downloadTime,
      downloadSpeedBps,
      downloadSize: receivedSize,
      dnsLookupTime,
      sslTime,
      processingTime,
      url: url,
      cacheStatus: response.headers.get("X-Cache") || "unknown",
    };
  } catch (e) {
    return {
      status: "error",
      url,
      error: (e as any)?.message,
    };
  }
}

function aggregateBenchmarkResults(
  results: BenchmarkResult[]
): BenchmarkResult {
  const successResults = results.filter(
    (r) => r.status === "success"
  ) as SuccessBenchmarkResult[];

  if (successResults.length === 0) {
    return results[0];
  }

  const cachedResults = successResults.filter((r) => r.cacheStatus === "HIT");

  if (cachedResults.length === 0) {
    return getAverageSuccessBenchmarkResult(successResults);
  }

  return getAverageSuccessBenchmarkResult(cachedResults);
}

function getAverageSuccessBenchmarkResult(
  results: SuccessBenchmarkResult[]
): BenchmarkResult {
  const getAverage = (key: keyof SuccessBenchmarkResult) =>
    results.reduce((acc, r) => {
      const value = r[key] ?? 0;
      return acc + (value as number);
    }, 0) / results.length;

  const averageTtfb = getAverage("ttfb");
  const averageTotalRequestTime = getAverage("totalRequestTime");
  const averageDownloadTime = getAverage("downloadTime");
  const averageDownloadSize = getAverage("downloadSize");
  const averageDownloadSpeedBps = getAverage("downloadSpeedBps");
  const averageDnsLookupTime = getAverage("dnsLookupTime");
  const averageSslTime = getAverage("sslTime");
  const averageProcessingTime = getAverage("processingTime");

  return {
    status: "success",
    ttfb: averageTtfb,
    totalRequestTime: averageTotalRequestTime,
    downloadTime: averageDownloadTime,
    downloadSize: averageDownloadSize,
    downloadSpeedBps: averageDownloadSpeedBps,
    dnsLookupTime: averageDnsLookupTime,
    sslTime: averageSslTime,
    processingTime: averageProcessingTime,
    url: results[0].url,
    cacheStatus: results[0].cacheStatus,
  };
}
