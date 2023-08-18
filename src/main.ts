import * as core from '@actions/core'

import fs from 'fs'
import fsp from 'fs/promises'
import { readdir } from 'node:fs/promises'
import path from 'path'
import { exec } from 'node:child_process'
import { promisify } from 'util'
import { Storage } from '@google-cloud/storage'
import os from 'node:os'

import getMakeVar from "./getMakeVar"
import { stderr } from 'process'

let execp = promisify(exec)

async function run(): Promise<void> {
  try {
    // Save relevant inputs
    const now = Date.now();
    const bucketName: string = core.getInput('bucket-name')
    const objectPrefix: string = core.getInput('object-prefix')
    const projectId: string = core.getInput('project-id')
    const serviceAccountCredentials: string = core.getInput('service-account-credentials')
    const artifactDir: string = core.getInput('artifact-dir')

    if (path.isAbsolute(artifactDir)) {
      throw new Error("cannot work with absolute paths")
    }

    // Create a temporary staging directory
    let fdfuzzdir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fdfuzz-'));

    // Prepare the copy options
    let copyOptions : fs.CopyOptions = {
      dereference: true,
      recursive: true,
    };

    // Copy fuzzing targets in staging
    await fsp.cp(artifactDir, fdfuzzdir, copyOptions);
    // Merge seed corpus in staging
    await fsp.cp("./corpus", fdfuzzdir, copyOptions);

    // [1] Zip the artifact directory
    core.debug(`creating zip archive from ${fdfuzzdir}`)

    var promiseResolve : (value : unknown) => void
    var promiseReject : (reason? : any) => void;
    var promise = new Promise(function(resolve, reject){
      promiseResolve = resolve;
      promiseReject = reject;
    });

    let childProcess = exec(`zip -r fuzztargets.zip ${fdfuzzdir}`, (err, stdout, stderr) => {
      if (err) {
        console.error(`[stderr] zip: ${stderr}`)
        console.error(`[stdout] zip: ${stdout}`)
        core.setFailed(err)
        promiseReject(err)
        return
      }
      promiseResolve(null)
    })
    await promise;


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
