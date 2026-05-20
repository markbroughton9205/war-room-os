'use client'

import { memo } from 'react'

import type { RibbonWeatherSlice } from '@/lib/intelligence/ribbon/types'

import { RibbonSegmentShell } from './RibbonSegmentShell'

export const WeatherSegment = memo(function WeatherSegment({ weather }: { weather: RibbonWeatherSlice }) {
  return (
    <RibbonSegmentShell
      label="Weather"
      urgent={Boolean(weather.alert)}
      title={weather.label}
      className="min-w-[11rem] sm:min-w-[12rem]"
    >
      <p className="truncate">{weather.label}</p>
      {weather.alert ? (
        <p className="mt-0.5 truncate text-[11px] font-normal text-red-300">{weather.alert}</p>
      ) : null}
    </RibbonSegmentShell>
  )
})
