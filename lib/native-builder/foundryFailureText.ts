/**
 * Plain-language and short forms of a test failure. Shared by the quiet presentation and the live progress panel.
 * Pure.
 */

/** First "SomeError: message" found in a failure text, without trailing separators. */
export function shortFailureCause(text: string | null | undefined): string | null {
  const value = (text ?? '').replace(/\r/g, '')
  const error = /([A-Za-z_]*(?:Error|Exception)): ((?:(?!={3,})[^\n]){1,100}?)(?:\s{2,}|={3,}|-{5,}|\n|$)/.exec(value)
  if (error) return `${error[1]}: ${error[2].trim()}`
  const failed = /(?:FAIL|ERROR): (\w+)/.exec(value)
  if (failed) return `${failed[0]}`
  return null
}

/** Plain-language reason for a failing test, for the main conversation. Technical text stays under "View failure". */
export function humanFailure(cause: string | null | undefined): string {
  const value = (cause ?? '').trim()
  if (!value) return 'a test failed'
  const name = /NameError: name '([^']+)' is not defined/.exec(value)
  if (name) return `${name[1]} isn't defined`
  if (/Failed to import test module/i.test(value)) return 'the tests could not even load'
  const imp = /(?:ImportError|ModuleNotFoundError): cannot import name '([^']+)'(?: from '([^']+)')?/.exec(value)
  if (imp) return `an import of ${imp[1]}${imp[2] ? ` from ${imp[2]}` : ''} failed`
  if (/^(?:ImportError|ModuleNotFoundError)/.test(value)) return 'an import failed'
  if (/^SyntaxError|^IndentationError/.test(value)) return 'there is a syntax error'
  if (/^AttributeError/.test(value)) return 'something the code uses is missing'
  if (/^TypeError/.test(value)) return 'a value has the wrong type'
  if (/^KeyError/.test(value)) return 'a expected key is missing'.replace('a expected', 'an expected')
  if (/^AssertionError/.test(value)) return "the results don't match what a test expects"
  return 'a test failed'
}
