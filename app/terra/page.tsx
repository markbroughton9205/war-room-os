/**
 * War Room Terra — planetary intelligence environment (Terra Foundation, Phase G).
 * @route https://<host>/terra
 *
 * A dedicated route, deliberately separate from /globe (a decorative canvas animation on an
 * existing page, not a real 3D globe — unrelated to this mission and left untouched) and from
 * every other War Room surface. See docs/terra/phase-g-repository-license-analysis.md for the
 * upstream (God's Eye View V1) analysis this foundation is built from.
 */
import { WarRoomUiModeProvider } from '@/components/war-room/WarRoomUiModeContext'
import { TerraShell } from '@/components/war-room/terra/TerraShell'
import { TerraActiveLocationProvider } from '@/components/war-room/terra/TerraActiveLocationContext'

export const dynamic = 'force-dynamic'

export default function TerraPage() {
  return (
    <WarRoomUiModeProvider>
      <TerraActiveLocationProvider><TerraShell /></TerraActiveLocationProvider>
    </WarRoomUiModeProvider>
  )
}
