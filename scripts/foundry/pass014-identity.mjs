import { runtimeVerify } from '../../lib/native-builder/runtimeControl.ts'
import { readProductionOwner } from '../../lib/native-builder/foundryProductionOwnership.ts'
import { readProductionLease } from '../../lib/native-builder/foundryProductionLease.ts'
import { installerActiveStatus } from '../../lib/native-builder/installerTool.ts'

const v = await runtimeVerify()
const owner = await readProductionOwner()
const lease = await readProductionLease()
const active = await installerActiveStatus({})
console.log(JSON.stringify({ verify: v, owner, lease, active }, null, 2))
