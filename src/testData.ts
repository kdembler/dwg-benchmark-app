import request from "graphql-request";
import { graphql } from "./gql";

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
      thumbnailPhoto {
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

export type TestObject = {
  id: string;
  size: number;
  type: "media" | "thumbnail";
  urls: string[];
};

export async function gatherTestObjects(
  videoId: string
): Promise<TestObject[] | null> {
  const data = await request(
    "https://query.joystream.org/graphql",
    getVideoQueryDocument,
    { id: videoId }
  );
  const video = data?.videoByUniqueInput;
  if (!video) {
    return null;
  }
  const { media, thumbnailPhoto } = video;
  if (!media) {
    console.error("No media found");
    return null;
  }
  if (!thumbnailPhoto) {
    console.error("No thumbnail found");
    return null;
  }

  const mediaUrls = [];
  const thumbnailUrls = [];
  // blindly assume that thumbnail is in the same storage bag as media
  for (const bucket of media.storageBag.distributionBuckets) {
    if (!bucket.distributing) continue;
    for (const operator of bucket.operators) {
      const endpoint = operator.metadata?.nodeEndpoint;
      if (!endpoint) continue;
      mediaUrls.push(`${endpoint}api/v1/assets/${media.id}`);
      thumbnailUrls.push(`${endpoint}api/v1/assets/${thumbnailPhoto.id}`);
    }
  }

  mediaUrls.push(
    `https://gateway.joyutils.org/distributor/api/v1/assets/${media.id}`
  );
  thumbnailUrls.push(
    `https://gateway.joyutils.org/distributor/api/v1/assets/${thumbnailPhoto.id}`
  );

  return [
    {
      id: media.id,
      size: media.size,
      type: "media",
      urls: mediaUrls,
    },
    {
      id: thumbnailPhoto.id,
      size: thumbnailPhoto.size,
      type: "thumbnail",
      urls: thumbnailUrls,
    },
  ];
}
