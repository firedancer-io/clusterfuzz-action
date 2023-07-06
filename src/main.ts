import * as core from '@actions/core'

import fs from 'fs'
import path from 'path'
import { exec } from 'node:child_process'
import { promisify } from 'util'
import { Storage } from '@google-cloud/storage';

async function run(): Promise<void> {
  let execp = promisify(exec)
  try {
    let now = Date.now();
    const bucketName: string = core.getInput('bucket-name')
    const objectPrefix: string = core.getInput('object-prefix')
    const projectId: string = core.getInput('project-id')
    const serviceAccountCredentials: string = core.getInput('service-account-credentials')
    const artifactDir: string = core.getInput('artifact-dir')

    if (path.isAbsolute(artifactDir)) {
      throw new Error("cannot work with absolute paths")
    }

    // [1] Zip the artifact directory
    core.debug(`creating zip archive from ${artifactDir}`)
    const { stdout, stderr } = await execp(`zip -r fuzztargets.zip ${artifactDir}`)

    // [2] Upload the artifact to GCS
    let objectPath = `${objectPrefix}-${now}.zip`
    core.debug(`uploading archive to ClusterFuzz @ gs://${bucketName}/${objectPath}}`)
    
    // [2.1] Create a new GCS client
    let credentials = JSON.parse(serviceAccountCredentials)
    let gcs = new Storage({
      projectId,
      credentials
    })

    // [2.2] Write the object
    let bucket = gcs.bucket(bucketName)
    const dstObject = bucket.file(objectPath)
    let fileStream = fs.createReadStream('fuzztargets.zip')

    let streamFileUpload = new Promise((resolve, reject) => {
      fileStream.pipe(dstObject.createWriteStream()).on('finish', resolve).on('error', reject)
    })
    
    await streamFileUpload;

  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
