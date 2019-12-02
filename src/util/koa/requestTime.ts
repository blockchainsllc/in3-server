import { performance } from "perf_hooks"

/**
 * Adds 'X-Request-Time' to the headers.
 * 
 * @param submitter
 * @returns {Function}
 */
export default function requestTime(submitter?: Function) {
  return (ctx, next) => {
    const start = performance.now()
    return next().then(_ => {
      const time = (performance.now() - start).toFixed(2)
      ctx.set('X-Request-Time', `${time} ms`)
      if(submitter)
        submitter(parseFloat(time))
    })
  }
}