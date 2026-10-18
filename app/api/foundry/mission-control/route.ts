import { requireCommanderSession } from '@/lib/security/commanderSession'
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { loadMissionControlView, listMissionControlMissions } from '@/lib/native-builder/foundryMissionControlData';

/** Mission ids are UUIDs; anything else never reaches a file path. */
const MISSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const commander = await requireCommanderSession('Foundry')
  if (!commander.ok) return commander.response
  const missionId = new URL(req.url).searchParams.get('missionId');

  if (!missionId) {
    return NextResponse.json({ missions: listMissionControlMissions() });
  }

  if (!MISSION_ID.test(missionId)) {
    return NextResponse.json({ error: 'Invalid mission id' }, { status: 400 });
  }

  const view = await loadMissionControlView(missionId);

  if (view) {
    return NextResponse.json({ view });
  } else {
    return NextResponse.json({ error: 'Unknown mission' }, { status: 404 });
  }
}
