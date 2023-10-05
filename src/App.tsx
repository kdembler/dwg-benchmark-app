import { graphql } from "./gql/gql";
import request from "graphql-request";
import TextField from "@mui/material/TextField";
import Container from "@mui/material/Container";
import {
  Alert,
  Button,
  Card,
  CircularProgress,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Typography,
} from "@mui/material";
import Grid from "@mui/material/Unstable_Grid2";
import { useState } from "react";

const getVideoQueryDocument = graphql(/* GraphQL */ `
  query GetVideo($id: ID!) {
    videoByUniqueInput(where: { id: $id }) {
      media {
        id
        size
        storageBag {
          distributionBuckets {
            id
            distributing
            operators {
              metadata {
                nodeEndpoint
              }
            }
          }
        }
      }
    }
  }
`);

async function prepareTestData(id: string) {
  const data = await request(
    "https://query.joystream.org/graphql",
    getVideoQueryDocument,
    { id }
  );
  const video = data?.videoByUniqueInput;
  if (!video) {
    return null;
  }
  const { media } = video;
  if (!media) {
    console.error("No media found");
    return null;
  }
  const urls = media.storageBag.distributionBuckets.flatMap((bucket) => {
    if (!bucket.distributing) return [];
    return bucket.operators.flatMap((operator) => {
      const endpoint = operator.metadata?.nodeEndpoint;
      if (!endpoint) return [];
      return `${endpoint}api/v1/assets/${media.id}`;
    });
  });
  return {
    id: id!,
    size: media.size,
    urls,
  };
}

type TestData = NonNullable<Awaited<ReturnType<typeof prepareTestData>>>;

type TestResult =
  | {
      ttfb: number;
      totalFetchTime: number;
      downloadTime: number;
      downloadSpeedBps: number;
      size: number;
      url: string;
      cacheStatus: string;
    }
  | {
      url: string;
      error: string;
    };

async function runTest(url: string, chunkSize: number): Promise<TestResult> {
  try {
    const startFetchTime = performance.now();
    const response = await fetch(url);
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
    let receivedLength = 0;

    const startReadTime = performance.now();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      receivedLength += value.length;
      if (receivedLength >= chunkSize) {
        await reader.cancel();
        break;
      }
    }
    const endFetchTime = performance.now();
    const readTime = endFetchTime - startReadTime;
    const downloadSpeedBps = receivedLength / (readTime / 1000);

    return {
      ttfb,
      totalFetchTime: endFetchTime - startFetchTime,
      downloadTime: readTime,
      downloadSpeedBps,
      size: receivedLength,
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

type TestState = {
  results: TestResult[] | null;
  metadata: TestData | null;
  error: string | null;
  isRunning: boolean;
  displayResult: boolean;
};

export const App = () => {
  const [testVideoId, setTestVideoId] = useState("131701");
  const [chunkSize, setChunkSize] = useState(1024 * 1024 * 50);
  const [testState, setTestState] = useState<TestState>({
    results: null,
    metadata: null,
    error: null,
    isRunning: false,
    displayResult: false,
  });

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
      metadata: null,
      error: null,
      displayResult: false,
    }));
    const testData = await prepareTestData(testVideoId);
    if (!testData) {
      setTestState((state) => ({
        ...state,
        isRunning: false,
        error: "Failed to prepare test data",
      }));
      return;
    }
    setTestState((state) => ({ ...state, metadata: testData }));
    for (const url of testData.urls) {
      const result = await runTest(url, chunkSize);
      setTestState((state) => ({
        ...state,
        results: [...(state.results || []), result],
      }));
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

    setTestState((state) => ({ ...state, displayResult: true }));
  };

  // average ttfb, average download speed, best download speed, worst download speed
  const _stats = testState.results?.reduce(
    (acc, result) => {
      if ("error" in result) return acc;
      return {
        ttfb: acc.ttfb + result.ttfb,
        downloadSpeedBps: acc.downloadSpeedBps + result.downloadSpeedBps,
        bestDownloadSpeedBps:
          acc.bestDownloadSpeedBps > result.downloadSpeedBps
            ? acc.bestDownloadSpeedBps
            : result.downloadSpeedBps,
        worstDownloadSpeedBps:
          acc.worstDownloadSpeedBps < result.downloadSpeedBps
            ? acc.worstDownloadSpeedBps
            : result.downloadSpeedBps,
      };
    },
    {
      ttfb: 0,
      downloadSpeedBps: 0,
      bestDownloadSpeedBps: Number.MIN_SAFE_INTEGER,
      worstDownloadSpeedBps: Number.MAX_SAFE_INTEGER,
    }
  );
  const stats = _stats
    ? {
        ttfb: _stats.ttfb / testState.results!.length,
        downloadSpeedBps: _stats.downloadSpeedBps / testState.results!.length,
        bestDownloadSpeedBps: _stats.bestDownloadSpeedBps,
        worstDownloadSpeedBps: _stats.worstDownloadSpeedBps,
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
                Running test: {testState.results?.length || 0}/
                {testState.metadata?.urls.length || 0}
              </Alert>
            </Grid>
          )}

          {stats && testState.displayResult && (
            <Grid xs={12}>
              <Alert severity="info">
                <span>
                  Average TTFB: {stats?.ttfb.toFixed(2)}ms
                  <br />
                  Average download speed:{" "}
                  {(stats?.downloadSpeedBps / 1024 / 1024).toFixed(2)}MB/s
                  <br />
                  Best download speed:{" "}
                  {(stats?.bestDownloadSpeedBps / 1024 / 1024).toFixed(2)}
                  MB/s
                  <br />
                  Worst download speed:{" "}
                  {(stats?.worstDownloadSpeedBps / 1024 / 1024).toFixed(2)}
                  MB/s
                </span>
              </Alert>
            </Grid>
          )}
        </Grid>
      </Card>
    </Container>
  );
};
