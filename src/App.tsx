import { graphql } from "./gql/gql";
import request from "graphql-request";
import TextField from "@mui/material/TextField";
import Container from "@mui/material/Container";
import { Button } from "@mui/material";
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

type TestResult =
  | {
      ttfb: number;
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

async function runTest(url: string): Promise<TestResult> {
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
      console.error("No reader found");
      return {
        url,
        error: "No reader found",
      };
    }
    let receivedLength = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      receivedLength += value.length;
    }

    const endFetchTime = performance.now();
    const totalDownloadTime = endFetchTime - startFetchTime;

    const downloadSpeed = (receivedLength / (totalDownloadTime / 1000)).toFixed(
      2
    );

    console.log(response.headers);

    return {
      ttfb,
      downloadTime: totalDownloadTime,
      downloadSpeedBps: Number(downloadSpeed),
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

export const App = () => {
  const [testVideoId, setTestVideoId] = useState("131701");

  const [isRunningTest, setIsRunningTest] = useState(false);
  const [testResult, setTestResult] = useState<TestResult[] | null>(null);

  const handleRunTestClick = async () => {
    setIsRunningTest(true);
    setTestResult(null);
    const testData = await prepareTestData(testVideoId);
    if (!testData) {
      setIsRunningTest(false);
      return;
    }
    for (const url of testData.urls) {
      const result = await runTest(url);
      setTestResult((prev) => [...(prev || []), result]);
    }

    setIsRunningTest(false);
  };

  const handleExportClick = () => {
    if (!testResult) return;

    const blob = new Blob([JSON.stringify(testResult, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `benchmark-${testVideoId}-${Date.now()}.json`;
    a.click();
  };

  return (
    <Container
      maxWidth="sm"
      sx={{
        marginBlock: 2,
      }}
    >
      <TextField
        label="Video ID"
        variant="standard"
        value={testVideoId}
        onChange={(e) => setTestVideoId(e.target.value)}
      />
      <Button
        variant="contained"
        onClick={handleRunTestClick}
        disabled={isRunningTest}
      >
        Run test
      </Button>
      {isRunningTest && <div>Running test...</div>}
      {testResult && (
        <>
          <Button onClick={handleExportClick}>Export result</Button>
          <pre>Test result: {JSON.stringify(testResult, null, 2)}</pre>
        </>
      )}
    </Container>
  );
};
