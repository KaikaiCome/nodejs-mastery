import { createApp } from './app.js'
import { UserRepository, UserService } from './user.js'

const port = Number(process.env.PORT ?? 3003)
const app = createApp({ userService: new UserService(new UserRepository()) })

const server = app.listen(port, () => {
  console.log(`express-basic on http://localhost:${port}`)
  console.log(`  curl -X POST localhost:${port}/api/users -H "content-type: application/json" -d '{"email":"a@b.com","name":"A"}'`)
})
server.keepAliveTimeout = 65_000
server.headersTimeout = 66_000

function shutdown(signal) {
  console.log(`${signal} received, closing...`)
  server.close(() => process.exit(0))
  server.closeIdleConnections()
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
