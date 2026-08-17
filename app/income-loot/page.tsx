import { IncomeLootConsole } from '@/components/war-room/income-loot/IncomeLootConsole'
import { buildIncomeLootConsoleViewModel } from '@/lib/income-loot/consoleViewModel'
import { getIncomeLootPersistenceReadiness } from '@/lib/income-loot/durableStore'
import { listIncomeLootEvidenceForOwner } from '@/lib/income-loot/evidenceStore'
import { listIncomeLootOpportunitiesForOwner } from '@/lib/income-loot/store'
import { readCommanderIdentityConfig } from '@/lib/security/commanderIdentity'
export default function IncomeLootPage(){const commander=readCommanderIdentityConfig();const model=commander.ok?buildIncomeLootConsoleViewModel({dataAvailable:true,opportunities:listIncomeLootOpportunitiesForOwner(commander.commanderUserId),evidence:listIncomeLootEvidenceForOwner(commander.commanderUserId)}):buildIncomeLootConsoleViewModel({dataAvailable:false,opportunities:[],evidence:[]});const durability=getIncomeLootPersistenceReadiness();return <IncomeLootConsole model={{...model,durableAvailable:durability.durableAvailable,migrationRequired:durability.migrationRequired}}/>}
