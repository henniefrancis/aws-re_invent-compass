import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const client = new S3Client({ region: 'us-east-1' });

export async function save(key, body) {
  await client.send(
    new PutObjectCommand({ Bucket: 'sample-uploads-bucket', Key: key, Body: body }),
  );
}
