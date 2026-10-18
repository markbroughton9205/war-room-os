/**
 * The environment handed to a child process.
 *
 * Next declares `NODE_ENV` as a required property of `NodeJS.ProcessEnv` (its own typing file calls that a TODO), but the environment of a child process is
 * whatever the caller passes, and it often should not carry `NODE_ENV` (a child that inherits `production` skips dev dependencies, for one). That
 * difference is bridged here, once, so call sites stay type-checked and none of them casts.
 */
export function childProcessEnv(vars: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  return { ...vars } as NodeJS.ProcessEnv
}
