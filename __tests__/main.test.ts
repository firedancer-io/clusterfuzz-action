  //import {wait} from '../src/wait'
  import * as process from 'process'
  import * as cp from 'child_process'
  import * as path from 'path'
  import {expect, test} from '@jest/globals'

  import getMakeVar from "../src/getMakeVar"

  test('gets makefile var', async () => {
    let builddir = await getMakeVar("BUILDDIR")
    expect(builddir).toBe("linux/clang/x86_64_fuzz_asan");
  })