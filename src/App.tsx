import TextField from "@mui/material/TextField";
import Container from "@mui/material/Container";
import {
  Alert,
  Button,
  Card,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from "@mui/material";
import Grid from "@mui/material/Unstable_Grid2";
import { useState } from "react";
import { TestObject, gatherTestObjects } from "./testData";
import { BenchmarkResult, runBenchmark } from "./benchmark";
import SpeedTest, { Results } from "@cloudflare/speedtest";
import { v4 as uuidv4 } from "uuid";
import { useLocalStorage } from "@uidotdev/usehooks";

type ExtendedBenchmarkResult = BenchmarkResult & {
  objectType: TestObject["type"];
  uid: string;
  referenceDownloadSpeedBps: number;
  referenceLatency: number;
};

type TestState = {
  results: ExtendedBenchmarkResult[] | null;
  totalUrls: number | null;
  error: string | null;
  isRunning: boolean;
};

export const App = () => {
  const [testVideoId, setTestVideoId] = useState("131701");
  const [chunkSize, setChunkSize] = useState(1024 * 1024 * 50);
  const [testState, setTestState] = useState<TestState>({
    results: null,
    totalUrls: null,
    error: null,
    isRunning: false,
  });
  const [uid] = useLocalStorage("uid", uuidv4());

  const startTest = async () => {
    if (isNaN(parseInt(testVideoId))) {
      setTestState((state) => ({
        ...state,
        error: "Wrong video ID",
      }));
      return;
    }
    setTestState((state) => ({
      ...state,
      isRunning: true,
      results: null,
      totalUrls: null,
      error: null,
    }));

    const speedTest = new SpeedTest({
      measurements: [
        { type: "latency", numPackets: 1 },
        { type: "download", bytes: 1e5, count: 1, bypassMinDuration: true },
        { type: "latency", numPackets: 20 },
        { type: "download", bytes: 1e5, count: 5 },
        { type: "download", bytes: 1e6, count: 5 },
        { type: "packetLoss", numPackets: 1e3, responsesWaitTime: 3000 },
        { type: "download", bytes: 1e7, count: 3 },
        { type: "download", bytes: 2.5e7, count: 2 },
        { type: "download", bytes: 1e8, count: 1 },
        { type: "download", bytes: 2.5e8, count: 1 },
      ],
    });

    const speedTestResults = await new Promise<Results>((resolve, reject) => {
      speedTest.onFinish = (results) => resolve(results);
      speedTest.onError = (error) => reject(error);
    });
    const referenceDownloadSpeedBps =
      speedTestResults.getDownloadBandwidth() ?? 0;
    const referenceLatency = speedTestResults.getUnloadedLatency() ?? 0;

    const testObjects = await gatherTestObjects(testVideoId);
    if (!testObjects) {
      setTestState((state) => ({
        ...state,
        isRunning: false,
        error: "Failed to prepare test data",
      }));
      return;
    }
    const totalUrls = testObjects.reduce(
      (acc, obj) => acc + obj.urls.length,
      0
    );
    setTestState((state) => ({ ...state, totalUrls }));

    for (const testObject of testObjects) {
      for (const url of testObject.urls) {
        const result = await runBenchmark(url, chunkSize);
        const extendedResult: ExtendedBenchmarkResult = {
          ...result,
          objectType: testObject.type,
          uid,
          referenceDownloadSpeedBps,
          referenceLatency,
        };
        setTestState((state) => ({
          ...state,
          results: [...(state.results || []), extendedResult],
        }));
      }
    }
    setTestState((state) => ({ ...state, isRunning: false }));
  };

  const exportJsonResult = () => {
    if (!testState.results) return;

    const blob = new Blob([JSON.stringify(testState.results, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `benchmark-${testVideoId}-${Date.now()}.json`;
    a.click();
  };

  // average ttfb, average download speed, best download speed, worst download speed
  const _stats = testState.results?.reduce(
    (acc, result) => {
      if ("error" in result) return acc;
      return {
        totalTtfb: acc.totalTtfb + result.ttfb,
        lowestTtfb: acc.lowestTtfb > result.ttfb ? result.ttfb : acc.lowestTtfb,
        totalDownloadSpeedBps:
          acc.totalDownloadSpeedBps + result.downloadSpeedBps,
        bestDownloadSpeedBps:
          acc.bestDownloadSpeedBps > result.downloadSpeedBps
            ? acc.bestDownloadSpeedBps
            : result.downloadSpeedBps,
      };
    },
    {
      totalTtfb: 0,
      lowestTtfb: Number.MAX_SAFE_INTEGER,
      totalDownloadSpeedBps: 0,
      bestDownloadSpeedBps: Number.MIN_SAFE_INTEGER,
    }
  );
  const stats =
    _stats && testState.results
      ? {
          avgTtfb: _stats.totalTtfb / testState.results.length,
          lowestTtfb: _stats.lowestTtfb,
          avgDownloadSpeedBps:
            _stats.totalDownloadSpeedBps / testState.results.length,
          bestDownloadSpeedBps: _stats.bestDownloadSpeedBps,
        }
      : null;

  return (
    <Container
      maxWidth="sm"
      sx={{
        marginBlock: 6,
      }}
    >
      <Card sx={{ paddingBlock: 4, paddingInline: 2 }} elevation={4}>
        <Typography variant="h5" component="div" sx={{ paddingBottom: 3 }}>
          Joystream CDN Benchmark
        </Typography>
        <Grid container spacing={2}>
          {/* inputs */}
          <Grid xs={12} sm={4}>
            <TextField
              fullWidth
              label="Video ID"
              value={testVideoId}
              onChange={(e) => setTestVideoId(e.target.value)}
              disabled={testState.isRunning}
            />
          </Grid>
          <Grid xs={12} sm={8}>
            <FormControl fullWidth>
              <InputLabel id="chunk-label">Download size</InputLabel>
              <Select
                label="Download size"
                value={chunkSize}
                onChange={(e) => setChunkSize(e.target.value as number)}
                disabled={testState.isRunning}
              >
                <MenuItem value={1024 * 1024 * 10}>10MB</MenuItem>
                <MenuItem value={1024 * 1024 * 25}>25MB</MenuItem>
                <MenuItem value={1024 * 1024 * 50}>50MB</MenuItem>
                <MenuItem value={1024 * 1024 * 100}>100MB</MenuItem>
                <MenuItem value={1024 * 1024 * 200}>200MB</MenuItem>
              </Select>
              <FormHelperText>
                This much will be downloaded from every distributor
              </FormHelperText>
            </FormControl>
          </Grid>
          {/* buttons */}
          <Grid xs={12} sm={3}>
            <Button
              fullWidth
              variant="contained"
              onClick={startTest}
              disabled={testState.isRunning}
            >
              Run test
            </Button>
          </Grid>
          {!testState.isRunning && !!testState.results && (
            <>
              <Grid xs={12} sm={3}>
                <Button
                  fullWidth
                  variant="contained"
                  color="success"
                  onClick={exportJsonResult}
                >
                  Save JSON
                </Button>
              </Grid>
            </>
          )}
          {/* rest */}

          {testState.error && (
            <Grid xs={12}>
              <Alert severity="error">{testState.error}</Alert>
            </Grid>
          )}

          {testState.isRunning && (
            <Grid xs={12}>
              <Alert severity="info">
                {testState.totalUrls ? (
                  <span>
                    Running test: {testState.results?.length || 0}/
                    {testState.totalUrls || 0}
                  </span>
                ) : (
                  <span>Preparing test...</span>
                )}
              </Alert>
            </Grid>
          )}

          {stats && !testState.isRunning && (
            <Grid xs={12}>
              <Alert severity="info">
                <Typography variant="h6">Test results</Typography>
                <span>
                  Best TTFB: {stats?.lowestTtfb.toFixed(2)}ms
                  <br />
                  Average TTFB: {stats?.avgTtfb.toFixed(2)}ms
                  <br />
                  Best download speed:{" "}
                  {(stats?.bestDownloadSpeedBps / 1024 / 1024).toFixed(2)}Mbps
                  <br />
                  Average download speed:{" "}
                  {(stats?.avgDownloadSpeedBps / 1024 / 1024).toFixed(2)}Mbps
                </span>
              </Alert>
            </Grid>
          )}
        </Grid>
      </Card>
    </Container>
  );
};
