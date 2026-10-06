/**
 * NASA GIBS night lights for Terra night-side city illumination.
 * Archive: VIIRS Night Lights 2016 annual composite.
 * Daily path: public GIBS DNB radiance when available. VNP46A2 needs Earthdata and is not used.
 */
export const TERRA_NIGHT_LIGHTS_GIBS_LAYER_ID = 'night-lights' as const
export const TERRA_NIGHT_LIGHTS_DAILY_LAYER_ID = 'night-lights-daily-dnb' as const
export const TERRA_NIGHT_LIGHTS_COMPOSITE_DATE = '2016-01-01'
export const TERRA_NIGHT_LIGHTS_CREDIT = 'NASA GIBS · VIIRS Night Lights (Suomi NPP) 2016 composite'
export const TERRA_NIGHT_LIGHTS_DAILY_CREDIT = 'NASA GIBS · VIIRS SNPP daily DNB radiance · not live electricity'
export const TERRA_NIGHT_LIGHTS_LICENSE = 'NASA GIBS public WMTS; US government work / NASA open Earth observations. Credit NASA. Annual composite, not live power status.'
export const TERRA_NIGHT_LIGHTS_MAX_LEVEL = 8
