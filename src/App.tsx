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
import { v4 as uuidv4 } from "uuid";
import { useLocalStorage } from "@uidotdev/usehooks";
import { performSpeedTest } from "./speedtest";
import { formatMbps, formatMs } from "./utils";

const TESTS_COUNT = 3;
const PUBLISH_RESULTS = !!import.meta.env.PROD;

type ExtendedBenchmarkResult = BenchmarkResult & {
  objectType: TestObject["type"];
  uid: string;
  referenceDownloadSpeedBps: number;
  referenceLatency: number;
  version: string;
};

type TestState = {
  results: ExtendedBenchmarkResult[] | null;
  totalUrls: number | null;
  error: string | null;
  isRunning: boolean;
};

export const App = () => {
  const [testVideoId, setTestVideoId] = useState("131701");
  const [chunkSize, setChunkSize] = useState(25 * 1e6);
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

    const { referenceDownloadSpeedBps, referenceLatency } =
      await performSpeedTest();

    console.log(
      "Reference download speed",
      formatMbps(referenceDownloadSpeedBps)
    );
    console.log("Reference latency", formatMs(referenceLatency));

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

    const results: ExtendedBenchmarkResult[] = [];

    for (const testObject of testObjects) {
      for (const url of testObject.urls) {
        const result = await runBenchmark(url, chunkSize, TESTS_COUNT);
        const extendedResult: ExtendedBenchmarkResult = {
          ...result,
          objectType: testObject.type,
          uid,
          referenceDownloadSpeedBps,
          referenceLatency,
          version: "0.2.0",
        };
        if (result.status === "success") {
          console.log(
            url,
            formatMbps(result.downloadSpeedBps),
            formatMs(result.ttfb)
          );
        } else {
          console.log(extendedResult);
        }
        results.push(extendedResult);
        setTestState((state) => ({
          ...state,
          results,
        }));
      }
    }

    if (PUBLISH_RESULTS) {
      try {
        const response = await fetch(import.meta.env.VITE_APP_RESULTS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(results),
        });
        if (!response.ok) {
          throw new Error(`Failed to upload results (${response.status})`);
        }
      } catch (e) {
        console.error(e);
        setTestState((state) => ({
          ...state,
          error: "Failed to upload results",
          isRunning: false,
        }));
      }
    }

    setTestState((state) => ({ ...state, isRunning: false }));
  };

  const stats = computeStats(testState.results);

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
                <MenuItem value={10 * 1e6}>Small</MenuItem>
                <MenuItem value={25 * 1e6}>Normal</MenuItem>
              </Select>
              <FormHelperText>
                You will download around{" "}
                {(chunkSize * TESTS_COUNT * 9) / 1e6 + 30}MB
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
                  Best download speed: {formatMbps(stats.bestDownloadSpeedBps)}
                  <br />
                  Average download speed:{" "}
                  {formatMbps(stats.avgDownloadSpeedBps)}
                  <br />
                  User ID: {uid}
                </span>
              </Alert>
            </Grid>
          )}
        </Grid>
      </Card>
    </Container>
  );
};

function computeStats(results?: ExtendedBenchmarkResult[] | null) {
  if (!results) return null;

  const successResults = results.filter((r) => r.status === "success");
  const mediaResults = successResults.filter((r) => r.objectType === "media");

  const ttfbStats = successResults.reduce(
    (acc, result) => {
      if ("error" in result) return acc;
      return {
        totalTtfb: acc.totalTtfb + result.ttfb,
        lowestTtfb: acc.lowestTtfb > result.ttfb ? result.ttfb : acc.lowestTtfb,
      };
    },
    { totalTtfb: 0, lowestTtfb: Number.MAX_SAFE_INTEGER }
  );

  const downloadSpeedStats = mediaResults.reduce(
    (acc, result) => {
      if ("error" in result) return acc;
      return {
        totalDownloadSpeedBps:
          acc.totalDownloadSpeedBps + result.downloadSpeedBps,
        bestDownloadSpeedBps:
          acc.bestDownloadSpeedBps > result.downloadSpeedBps
            ? acc.bestDownloadSpeedBps
            : result.downloadSpeedBps,
      };
    },
    {
      totalDownloadSpeedBps: 0,
      bestDownloadSpeedBps: Number.MIN_SAFE_INTEGER,
    }
  );

  return {
    avgTtfb: ttfbStats.totalTtfb / successResults.length,
    lowestTtfb: ttfbStats.lowestTtfb,
    avgDownloadSpeedBps:
      downloadSpeedStats.totalDownloadSpeedBps / mediaResults.length,
    bestDownloadSpeedBps: downloadSpeedStats.bestDownloadSpeedBps,
  };
}
