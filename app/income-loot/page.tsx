import { IncomeLootConsole } from '@/components/war-room/income-loot/IncomeLootConsole'
import { buildIncomeLootConsoleViewModel } from '@/lib/income-loot/consoleViewModel'
import { listIncomeLootEvidenceForOwner } from '@/lib/income-loot/evidenceStore'
import { listIncomeLootOpportunitiesForOwner } from '@/lib/income-loot/store'
import { listRewardLedgerEntriesForOwner, summarizeRewardLedgerForOwner } from '@/lib/income-loot/rewardLedger'
import { listParticipantApplicationsForOwner, listParticipantQuestionsForOwner, listParticipantSourceConnectionsForOwner } from '@/lib/income-loot/operationsStore'
import { readCommanderIdentityConfig } from '@/lib/security/commanderIdentity'
import { getPayPalConfiguredStatus } from '@/lib/income-loot/paypalIncome'
import { listPayPalDepositsForOwner } from '@/lib/income-loot/depositIntelligence'
import { listExpenseReportsForOwner } from '@/lib/income-loot/expenseReports'
import type { Metadata } from 'next'
import { settlementStore } from '@/lib/settlement-intelligence/store'

export const metadata:Metadata={title:'Revenue Command | War Room',description:'War Room incoming revenue intelligence and deposit confirmation.'}
export default function IncomeLootPage(){const commander=readCommanderIdentityConfig();const ownerId=commander.ok?commander.commanderUserId:null;const paypalConnection=getPayPalConfiguredStatus();const model=ownerId?buildIncomeLootConsoleViewModel({dataAvailable:true,opportunities:listIncomeLootOpportunitiesForOwner(ownerId),evidence:listIncomeLootEvidenceForOwner(ownerId),applications:listParticipantApplicationsForOwner(ownerId),connections:listParticipantSourceConnectionsForOwner(ownerId),questions:listParticipantQuestionsForOwner(ownerId),ledgerEntries:listRewardLedgerEntriesForOwner(ownerId),ledgerSummary:summarizeRewardLedgerForOwner(ownerId).byCurrency,paypalConnection,paypalDeposits:listPayPalDepositsForOwner(ownerId),expenseReports:listExpenseReportsForOwner(ownerId)}):buildIncomeLootConsoleViewModel({dataAvailable:false,opportunities:[],evidence:[],paypalConnection});return <IncomeLootConsole model={model} settlementRecords={settlementStore.list()}/>}
