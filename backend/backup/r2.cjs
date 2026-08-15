const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3')

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function createR2Store() {
  const bucket = required('R2_BUCKET')
  const accountId = required('R2_ACCOUNT_ID')
  const client = new S3Client({
    region: 'auto', endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: required('R2_ACCESS_KEY_ID'), secretAccessKey: required('R2_SECRET_ACCESS_KEY') }
  })
  return {
    bucket,
    async put(key, body, contentType, metadata = {}) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, Metadata: metadata }))
    },
    async get(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      return { body: Buffer.from(await result.Body.transformToByteArray()), contentLength: Number(result.ContentLength), metadata: result.Metadata ?? {} }
    },
    async list(prefix) {
      const objects = []
      let continuationToken
      do {
        const result = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }))
        objects.push(...(result.Contents ?? []))
        continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined
      } while (continuationToken)
      return objects
    },
    async delete(keys) {
      if (keys.length === 0) return
      for (let index = 0; index < keys.length; index += 1000) {
        const result = await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.slice(index, index + 1000).map((Key) => ({ Key })), Quiet: true } }))
        if (result.Errors?.length) throw new Error(`R2 rejected deletion of ${result.Errors.length} backup objects.`)
      }
    }
  }
}

async function readJson(store, key, optional = false) {
  try { return JSON.parse((await store.get(key)).body.toString('utf8')) }
  catch (error) {
    if (optional && (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404)) return null
    throw error
  }
}

module.exports = { createR2Store, readJson }
