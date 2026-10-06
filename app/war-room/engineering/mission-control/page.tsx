export const dynamic = 'force-dynamic';
import { WarRoomUiModeProvider } from '@/components/war-room/WarRoomUiModeContext';
import { FoundryMissionControlPanel } from '@/components/war-room/foundry/FoundryMissionControlPanel';

export default function MissionControlPage() {
  return (
    <WarRoomUiModeProvider>
      <main className="min-h-screen bg-[#020403] text-white">
        <div className="px-4 py-4">
          <FoundryMissionControlPanel />
        </div>
      </main>
    </WarRoomUiModeProvider>
  );
}