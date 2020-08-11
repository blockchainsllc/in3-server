import * as path from 'path'
import * as Sentry from '@sentry/node';
import { RewriteFrames } from '@sentry/integrations';

declare global {
  namespace NodeJS {
    interface Global {
      __rootdir__: string;
    }
  }
}

const isSentryAvailable = () => process.env.SENTRY_ENABLE === 'true'

class HubWrapper {
  hub: any
  constructor() {
    if (isSentryAvailable()) {
      this.hub = new Sentry.Hub(Sentry.getCurrentHub().getClient())
    }
  }

  addBreadcrumb(data) {
    if (!isSentryAvailable()) return

    this.hub.addBreadcrumb(data)
  }

  captureException(exception, captureContext?: any) {
    if (!isSentryAvailable()) return

    this.hub.captureException(exception, captureContext)
  }

  captureMessage(msg) {
    if (!isSentryAvailable()) return

    this.hub.captureMessage(msg)
  }

  configureScope(tags: any = {}, extras: any = {}) {
    if (!isSentryAvailable()) return

    this.hub.configureScope(scope => {
      Object.entries(tags).forEach(([tagName, tagValue]) => {
        scope.setTag(tagName, tagValue)
      })

      Object.entries(tags).forEach(([extraName, extraValue]) => {
        scope.setExtra(extraName, extraValue)
      })
    })
  }

  captureError(err) {
    if (!isSentryAvailable()) return

    this.hub.withScope(scope => {
      scope.setExtra("body", err.body)
      scope.setExtra("stack", err.stack)
      this.hub.captureException(err)
    })
  }

  registerContextProcessor(ctx: any) {
    if (!isSentryAvailable()) return

    this.hub.configureScope(scope => {
      scope.addEventProcessor(event => Sentry.Handlers.parseRequest(event, ctx.request))
      scope.setTag("request", ctx.request)
    })
  }

  clear() {
    if (!isSentryAvailable()) return

    this.hub.withScope(scope => {
      // This is quite sad but necessary unfortunately.
      scope.clear()
      scope.clearBreadcrumbs()
    })
    // this.hub.
  }
}

const initSentry = () => {
  if (!isSentryAvailable()) return

  let dir = __dirname || process.cwd()
  global.__rootdir__ = path.join(dir, "../..")

  // Hook up Sentry error reporting
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    release: process.env.SENTRY_RELEASE || "v0.0.0",
    environment: process.env.SENTRY_ENVIRONMENT || "local",
    integrations: [new RewriteFrames({ root: global.__rootdir__ })]
  })

  process.on("uncaughtException", err => Sentry.captureException(err))
  process.on('unhandledRejection', (_reason, promise) => {
    Sentry.captureException(new Error("Unhandled promise rejection at " + promise))
  });
}

const hookSentryKoa = app => {
  app.use(async (ctx, next) =>{
    let hub = new HubWrapper()
    hub.registerContextProcessor(ctx)
    ctx.hub = hub
    await next()
  })

  app.on('error', (err, ctx) => {
    ctx.hub?.captureError(err)
  })

  app.use(async (ctx, next) => {
    await next()
    ctx.hub?.clear()
  })
}

const addBreadcrumb = data => {
  if (!isSentryAvailable()) return

  Sentry.withScope(scope => scope.addBreadcrumb(data))
}

const captureException = (exception, captureContext?: any) => {
  if (!isSentryAvailable()) return

  Sentry.captureException(exception, captureContext)
}

const captureMessage = msg => {
  if (!isSentryAvailable()) return

  Sentry.captureMessage(msg)
}

const captureError = err => {
  if (!isSentryAvailable()) return

  Sentry.withScope(scope => {
    scope.setExtra("body", err.body)
    scope.setExtra("stack", err.stack)
    this.captureException(err)
  })
}

export { initSentry, hookSentryKoa, addBreadcrumb, captureException, captureMessage, captureError, HubWrapper }
