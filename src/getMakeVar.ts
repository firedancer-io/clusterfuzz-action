import { exec } from 'node:child_process'
import { promisify } from 'util'

let execp = promisify(exec)

async function getMakeVar(varName: string) : Promise<string> {
      // Find the build directory. It's going to be the last line of stdin.
      let res = await execp(`make print-${varName}`, {})

      let lines = res.stdout.split("\n")
      let builddir = lines[lines.length-2]
      return builddir;
}

export default getMakeVar;