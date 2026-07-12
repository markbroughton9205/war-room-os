const COMMANDER_USER_ID_ENV = 'WAR_ROOM_COMMANDER_USER_ID'

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

const vercelEnv = (process.env.VERCEL_ENV || '').trim()

if (vercelEnv !== 'production') {
  console.log(`Commander identity prebuild gate skipped for VERCEL_ENV=${vercelEnv || 'local'}.`)
  process.exit(0)
}

const commanderUserId = (process.env[COMMANDER_USER_ID_ENV] || '').trim()

if (!commanderUserId) {
  console.error(`${COMMANDER_USER_ID_ENV} is required for production builds.`)
  process.exit(1)
}

if (!isUuid(commanderUserId)) {
  console.error(`${COMMANDER_USER_ID_ENV} must be a UUID for production builds.`)
  process.exit(1)
}

console.log('Commander identity prebuild gate passed.')
