/* Local Commander control-surface foundation — no privileged actions. */
async function load() {
  const runtimeEl = document.getElementById('runtime')
  const slotsEl = document.getElementById('slots')
  try {
    const res = await fetch('/api/local/status', { cache: 'no-store' })
    const data = await res.json()
    runtimeEl.textContent = JSON.stringify(
      {
        boot: data.health?.boot_state,
        truth: data.runtime_truth,
        offline: data.health?.offline,
        website_fallback: data.health?.website_fallback,
        navigation_warroomos: data.navigation_sample,
      },
      null,
      2,
    )
    for (const slot of data.commander_control_surface_slots || []) {
      const li = document.createElement('li')
      li.textContent = slot
      slotsEl.appendChild(li)
    }
  } catch (err) {
    runtimeEl.textContent = JSON.stringify(
      {
        boot: 'CORE_FAILED',
        error: String(err && err.message ? err.message : err),
        website_fallback: 'DENIED',
        note: 'Show diagnostic state — do not open public website.',
      },
      null,
      2,
    )
  }
}
void load()
