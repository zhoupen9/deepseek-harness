/**
 * Parse the readiness line that `dsh web` prints once its Loader tree settles
 * and the Web server has bound. The line carries the authenticated launch URL
 * (with a one-time `?token=` query), the only address a fresh window may load
 * before the server sets its session cookie.
 * @module @deepseek-ai/dsh-electron/url-line
 */

/** `dsh web: <url>` — the authenticated loopback URL is the first non-space token after the prefix. */
const WEB_URL_PATTERN = /dsh web:\s+(https?:\/\/\S+)/u

/**
 * Extract the authenticated launch URL from one line of `dsh web` stdout.
 * @param line - one decoded stdout line from the server child process.
 * @returns the `http://…` launch URL, or `undefined` when the line is not the readiness line.
 */
export function parseWebUrlLine(line: string): string | undefined {
  return WEB_URL_PATTERN.exec(line)?.[1]
}
