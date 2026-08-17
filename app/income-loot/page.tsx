import { IncomeLootConsole } from '@/components/war-room/income-loot/IncomeLootConsole'
import { buildIncomeLootConsoleViewModel } from '@/lib/income-loot/consoleViewModel'
import { getIncomeLootPersistenceReadiness } from '@/lib/income-loot/durableStore'
import { listIncomeLootEvidenceForOwner } from '@/lib/income-loot/evidenceStore'
import { listIncomeLootOpportunitiesForOwner } from '@/lib/income-loot/store'
import { listRewardLedgerEntriesForOwner, summarizeRewardLedgerForOwner } from '@/lib/income-loot/rewardLedger'
import { listParticipantApplicationsForOwner, listParticipantQuestionsForOwner, listParticipantSourceConnectionsForOwner } from '@/lib/income-loot/operationsStore'
import { readCommanderIdentityConfig } from '@/lib/security/commanderIdentity'
export default function IncomeLootPage(){const commander=readCommanderIdentityConfig();const ownerId=commander.ok?commander.commanderUserId:null;const model=ownerId?buildIncomeLootConsoleViewModel({dataAvailable:true,opportunities:listIncomeLootOpportunitiesForOwner(ownerId),evidence:listIncomeLootEvidenceForOwner(ownerId),applications:listParticipantApplicationsForOwner(ownerId),connections:listParticipantSourceConnectionsForOwner(ownerId),questions:listParticipantQuestionsForOwner(ownerId),ledgerEntries:listRewardLedgerEntriesForOwner(ownerId),ledgerSummary:summarizeRewardLedgerForOwner(ownerId).byCurrency}):buildIncomeLootConsoleViewModel({dataAvailable:false,opportunities:[],evidence:[]});const durability=getIncomeLootPersistenceReadiness();return <IncomeLootConsole model={{...model,durableAvailable:durability.durableAvailable,migrationRequired:durability.migrationRequired}}/>}
