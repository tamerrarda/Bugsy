/**
 * How each language's snippet + driver is composed, compiled and run.
 *
 * The whole content pipeline rests on this: a snippet is only allowed into the
 * game once we have RUN it and watched its bug misbehave. So every language we
 * ship must have a runner here, and a language with no runner cannot have content.
 *
 * The composition rule that matters: the SNIPPET GOES FIRST, always. `bugLine` is
 * a 1-indexed line number into the snippet, so anything prepended would silently
 * shift every answer in that language by the size of the prologue. That is why
 * Java does not use the single-file source launcher (which demands the class with
 * `main` come first) and compiles with javac instead.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * The scratch directory is unique per PROCESS and per CALL.
 *
 * It used to be a single fixed path. Two verifications running at the same time —
 * an agent checking its own snippet while the full sweep ran, say — then wrote
 * `snippet.ts` over each other and each read back the OTHER one's output. The
 * result was silent cross-contamination: a snippet could be reported as proven on
 * the strength of a different snippet's driver. Verification that can lie is worse
 * than no verification, because it is trusted.
 */
const WORK_ROOT = join(tmpdir(), `bugsy-verify-${process.pid}`)
let callSeq = 0

// The C# project scaffold is expensive to rebuild, so it persists — but it is
// still per-process, or two processes would fight over the same Program.cs.
const CSHARP_PROJECT = join(tmpdir(), `bugsy-csharp-${process.pid}`)

function fresh() {
  const dir = join(WORK_ROOT, String(callSeq++))
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, {
    encoding: 'utf8',
    timeout: 60_000,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  })

/** Captures stdout+stderr whether the process exits 0 or not — a driver may prove the bug by letting it throw. */
function attempt(fn) {
  try {
    return fn()
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`
  }
}

/** The class Java/C# drivers must declare, so we know what to execute. */
export const DRIVER_CLASS = 'BugsyDriver'

/**
 * C/C++ compile flags.
 *
 * Warnings are OFF in general, because a snippet is SUPPOSED to contain a bug and
 * many real bugs are exactly what -Wall shouts about (`if (x = 5)`, a comparison
 * that is always true). Failing on those would make the good snippets unbuildable.
 *
 * But a handful of diagnostics mean the code is MALFORMED rather than buggy — the
 * author fat-fingered it — and those are promoted to hard errors. This exists
 * because a snippet once shipped with `'\\0'` instead of `'\0'`: a multi-character
 * constant that compiled, produced 0x30, and made the driver pass for entirely the
 * wrong reason, while the player would have been shown nonsense C.
 */
// -Wno-everything, NOT -w: `-w` suppresses warnings so hard that it also swallows
// the -Werror= promotions below, which silently defeated the guard the first time
// it was written.
const C_FLAGS = [
  '-Wno-everything',
  '-Werror=multichar',
  '-Werror=implicit-function-declaration',
  '-Werror=return-type',
  '-Werror=invalid-source-encoding',
]

export const RUNNERS = {
  javascript: {
    ext: 'mjs',
    run(code, driver) {
      const dir = fresh()
      const file = join(dir, 'snippet.mjs')
      writeFileSync(file, `${code}\n\n${driver}\n`)
      return attempt(() => run('node', [file]))
    },
  },

  typescript: {
    ext: 'ts',
    run(code, driver) {
      const dir = fresh()
      // Without this, the temp dir has no package.json, tsx assumes CommonJS, and
      // a driver using top-level `await` fails to transpile at all — which reads
      // like a broken snippet when it is really a broken harness.
      writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n')

      const file = join(dir, 'snippet.ts')
      writeFileSync(file, `${code}\n\n${driver}\n`)

      // tsx transpiles without typechecking, which is what we want: the snippet is
      // meant to have a BUG, and some bugs are type errors that tsc would reject
      // before we ever get to watch them misbehave at runtime.
      return attempt(() => run('npx', ['--no-install', 'tsx', file], { cwd: EXTENSION }))
    },
  },

  python: {
    ext: 'py',
    run(code, driver) {
      const dir = fresh()
      const file = join(dir, 'snippet.py')
      writeFileSync(file, `${code}\n\n${driver}\n`)
      return attempt(() => run('python3', [file]))
    },
  },

  java: {
    ext: 'java',
    run(code, driver) {
      const dir = fresh()
      // javac, not `java Snippet.java`: the single-file launcher insists the FIRST
      // top-level class declares main, which would force the driver above the
      // snippet and shift every bugLine.
      const file = join(dir, `${DRIVER_CLASS}.java`)
      writeFileSync(file, `${code}\n\n${driver}\n`)

      const compiled = attempt(() => run('javac', ['-nowarn', '-d', dir, file]))
      if (compiled.includes('error:')) return compiled

      return attempt(() => run('java', ['-cp', dir, DRIVER_CLASS]))
    },
  },

  csharp: {
    ext: 'cs',
    run(code, driver) {
      // Deliberately NOT fresh(): a .NET project costs seconds to restore and
      // build from scratch, and doing that 100 times is seven wasted minutes. The
      // project scaffold persists in its own directory and only Program.cs is
      // rewritten, so MSBuild does an incremental compile.
      const proj = join(CSHARP_PROJECT)
      mkdirSync(proj, { recursive: true })

      const csproj = join(proj, 'proj.csproj')
      if (!existsSync(csproj)) {
        writeFileSync(
          csproj,
          `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>disable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <StartupObject>${DRIVER_CLASS}</StartupObject>
    <NoWarn>CS0168;CS0219;CS8600;CS8602;CS0164</NoWarn>
  </PropertyGroup>
</Project>\n`,
        )
      }
      writeFileSync(join(proj, 'Program.cs'), `${code}\n\n${driver}\n`)

      return attempt(() =>
        run('dotnet', ['run', '--project', proj, '-v', 'quiet', '--nologo'], {
          env: { ...process.env, DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1' },
          timeout: 120_000,
        }),
      )
    },
  },

  c: {
    ext: 'c',
    run(code, driver) {
      const dir = fresh()
      const file = join(dir, 'snippet.c')
      const bin = join(dir, 'a.out')
      writeFileSync(file, `${code}\n\n${driver}\n`)

      const compiled = attempt(() => run('clang', ['-std=c11', ...C_FLAGS, file, '-o', bin]))
      if (!existsSync(bin)) return compiled

      return attempt(() => run(bin, []))
    },
  },

  cpp: {
    ext: 'cpp',
    run(code, driver) {
      const dir = fresh()
      const file = join(dir, 'snippet.cpp')
      const bin = join(dir, 'a.out')
      writeFileSync(file, `${code}\n\n${driver}\n`)

      const compiled = attempt(() => run('clang++', ['-std=c++17', ...C_FLAGS, file, '-o', bin]))
      if (!existsSync(bin)) return compiled

      return attempt(() => run(bin, []))
    },
  },

  rust: {
    ext: 'rs',
    run(code, driver) {
      const dir = fresh()
      const file = join(dir, 'snippet.rs')
      const bin = join(dir, 'snippet')
      writeFileSync(file, `${code}\n\n${driver}\n`)

      const compiled = attempt(() =>
        run('rustc', ['--edition', '2021', '-A', 'warnings', file, '-o', bin]),
      )
      if (!existsSync(bin)) return compiled

      return attempt(() => run(bin, []))
    },
  },
}

const EXTENSION = new URL('../extension', import.meta.url).pathname
