/**
 * Syntax highlighting via Shiki.
 *
 * Two deliberate choices:
 *  1. `createJavaScriptRegexEngine` instead of the default Oniguruma engine.
 *     Oniguruma is WASM, and running WASM in an MV3 extension page requires
 *     relaxing the CSP with 'wasm-unsafe-eval'. The JS engine keeps the default
 *     (strict) extension CSP intact.
 *  2. `codeToTokens`, not `codeToHtml`. We need each line as data so we can
 *     render it as its own clickable row — the whole game is clicking lines.
 */
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import type { Language } from '../types'

export interface Token {
  content: string
  color: string | undefined
}

/** One source line, as styled tokens. */
export type HighlightedLine = Token[]

/**
 * Solarized Light, not by accident: its background is #fdf6e3 — the same warm
 * cream the rest of the garden UI is built from. It was designed for exactly this
 * kind of low-glare, paper-like reading, which is what a player staring at a
 * snippet for sixty seconds actually needs.
 */
const THEME = 'solarized-light'

let highlighterPromise: Promise<HighlighterCore> | null = null

function loadHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [import('shiki/themes/solarized-light.mjs')],
    // Each grammar is its own lazy chunk, so a player who only ever touches the
    // Rust track never downloads the Java or C++ grammars.
    langs: [
      import('shiki/langs/javascript.mjs'),
      import('shiki/langs/typescript.mjs'),
      import('shiki/langs/python.mjs'),
      import('shiki/langs/java.mjs'),
      import('shiki/langs/csharp.mjs'),
      import('shiki/langs/c.mjs'),
      import('shiki/langs/cpp.mjs'),
      import('shiki/langs/rust.mjs'),
    ],
    // `forgiving` downgrades an unsupported regex to a no-match instead of
    // throwing, so a grammar edge case degrades to duller colors, never a crash.
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  })
  return highlighterPromise
}

/** Unstyled fallback, used until the highlighter resolves and if it fails. */
export function plainLines(code: string): HighlightedLine[] {
  return code.split('\n').map((line) => [{ content: line, color: undefined }])
}

export async function highlight(code: string, language: Language): Promise<HighlightedLine[]> {
  const highlighter = await loadHighlighter()
  const { tokens } = highlighter.codeToTokens(code, { lang: language, theme: THEME })

  return tokens.map((line) => line.map((token) => ({ content: token.content, color: token.color })))
}
