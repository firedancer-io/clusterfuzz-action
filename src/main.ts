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
import { env, stderr } from 'process'

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
    const qualifier: string = core.getInput('qualifier').trim()

    console.log(`Working in ${__dirname}`)

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

    if (qualifier) {
      // Rewrite the binary names to be suffixed by the qualifier
      for (let entry of await fsp.readdir(fdfuzzdir, {
        recursive: false,
        withFileTypes: true,
      })) {
        console.log(`listed ${entry.name}`)
        if (entry.isDirectory()) {
          console.log(`renaming: ${path.join(fdfuzzdir, entry.name, entry.name)}, ${path.join(fdfuzzdir, entry.name, entry.name)}-${qualifier}`)
          await fsp.rename(path.join(fdfuzzdir, entry.name, entry.name), `${path.join(fdfuzzdir, entry.name, entry.name)}-${qualifier}`)
          await fsp.rename(path.join(fdfuzzdir, entry.name), `${path.join(fdfuzzdir, entry.name)}-${qualifier}`)
      }
    }
  }

    // For each binary, rewrite the RPATH
    let files = await fsp.readdir(fdfuzzdir)
    for (let executable of files) {
      await rewriteRPATH(path.join(fdfuzzdir, executable, executable), "'$ORIGIN'/../lib/");
    }

    // For each of the corpus directories, zip it and place the archive next to the fuzz target.
    let corporas = await fsp.readdir("./corpus", {withFileTypes: true})
    for (let corpus of corporas) {
      var artifactName = corpus.name
      var dirPath = path.join(fdfuzzdir, corpus.name)

      if (qualifier) {
        artifactName = `${artifactName}-${qualifier}`
        dirPath = `${dirPath}-${qualifier}`
      }
    
      var dirpath = path.join(fdfuzzdir, )
      if (corpus.isDirectory() && fs.existsSync(dirPath)) {

        await zip(path.join("./corpus", corpus.name), ".", path.join(fdfuzzdir, artifactName, `${artifactName}.zip`))
      }
    }

    // Copy the shared objects
    await fsp.cp("./opt/lib", path.join(fdfuzzdir, "lib"), {dereference: false, recursive: true, verbatimSymlinks: true})

    // For each of the shared objects, rewrite their RPATH
    let sos = await fsp.readdir(path.join(fdfuzzdir, "lib"), {withFileTypes: true})
    for (let so of sos) {
      if (!so.isSymbolicLink() && so.isFile() && !so.name.endsWith("a")) {
        await rewriteRPATH(path.join(fdfuzzdir, "lib", so.name), "'$ORIGIN'");
      }
    }

    // [1] Zip the artifact directory
    await zip(fdfuzzdir, ".", path.join(__dirname, "fuzztargets.zip"))


    let { stdout } = await execp("git rev-parse HEAD")
    let commitHash = stdout.trim()

    // [2] Upload the artifact to GCS
    let objectPath = `${objectPrefix}-${now}-${commitHash}.zip`
    core.info(`uploading archive to ClusterFuzz under ${objectPath}}`)
    
    // [2.1] Create a new GCS client
    let credentials = JSON.parse(serviceAccountCredentials)
    let gcs = new Storage({
      projectId,
      credentials
    })

    // [2.2] Write the object
    let bucket = gcs.bucket(bucketName)
    const dstObject = bucket.file(objectPath)
    let fileStream = fs.createReadStream(`${__dirname}/fuzztargets.zip`)

    let streamFileUpload = new Promise((resolve, reject) => {
      fileStream.pipe(dstObject.createWriteStream()).on('finish', resolve).on('error', reject)
    })
    
    await streamFileUpload;

  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

async function rewriteRPATH(executablePath: string, newRPATH: string) {
  var promiseResolve : (value : unknown) => void
  var promiseReject : (reason? : any) => void;
  var promise = new Promise(function(resolve, reject){
    promiseResolve = resolve;
    promiseReject = reject;
  });

  console.log(`running: patchelf ${executablePath} --set-rpath ${newRPATH}`)
  let childProcess = exec(
    `patchelf ${executablePath} --set-rpath ${newRPATH}`,
    (err, stdout, stderr) => {
    if (err) {
      console.error(`[stderr] patchelf: ${stderr}`)
      console.error(`[stdout] patchelf: ${stdout}`)
      core.setFailed(err)
      promiseReject(err)
      return
    }
    promiseResolve(null)
  })
  await promise;
}

async function zip(workingDirectory: fs.PathLike, targetDirectory: fs.PathLike, dst: fs.PathLike) {
  var promiseResolve : (value : unknown) => void
  var promiseReject : (reason? : any) => void;
  var promise = new Promise(function(resolve, reject){
    promiseResolve = resolve;
    promiseReject = reject;
  });

  console.log(`running: "zip -r ${dst} ." from ${workingDirectory}`)
  let childProcess = exec(
    `zip -r ${dst} ${targetDirectory}`,
    {
      cwd: workingDirectory.toString()
    },
    (err, stdout, stderr) => {
    if (err) {
      console.error(`[stderr] zip: ${stderr}`)
      console.error(`[stdout] zip: ${stdout}`)
      core.setFailed(err)
      promiseReject(err)
      return
    }
    promiseResolve(null)
  })

  return promise;
}

run()
