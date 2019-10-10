import { performance } from "perf_hooks"

/**
 * Adds 'X-Request-Time' to the headers.
 * 
 * @returns {Function}
 */
export default function requestTime() {
  return (ctx, next) => {
    const start = performance.now()
    return next().then(_ => {
      const time = performance.now() - start
      ctx.set('X-Request-Time', `${time.toFixed(2)} ms`)
    })
  }
}