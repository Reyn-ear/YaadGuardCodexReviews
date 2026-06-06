type Hurdat2Point = {
  stormId: string
  stormName: string
  stormDate: string
  stormTime: string
  recordId: string | null
  status: string
  lat: number
  lon: number
  windKt: number
  pressureMb: number | null
}

const CARIBBEAN_STORM_BOUNDS = {
  west: -92,
  south: 0,
  east: -50,
  north: 35,
}

export async function importHurdat2StormHistory(
  env: CloudflareBindings,
  objectKey: string,
) {
  if (!env.DB) {
    throw new Error('Missing Cloudflare D1 binding: DB')
  }

  const object = await env.YAAD_GUARD_BUCKET?.get(objectKey)
  if (!object) {
    throw new Error(`HURDAT2 raw object not found: ${objectKey}`)
  }

  const rows = parseHurdat2(await object.text()).filter(isCaribbeanStormPoint)

  await env.DB.prepare('DELETE FROM storm_history_points').run()

  const insert = env.DB.prepare(`
    INSERT INTO storm_history_points (
      storm_id,
      storm_name,
      storm_date,
      storm_time,
      record_id,
      status,
      lat,
      lon,
      wind_kt,
      pressure_mb
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (let index = 0; index < rows.length; index += 100) {
    await env.DB.batch(
      rows
        .slice(index, index + 100)
        .map((row) =>
          insert.bind(
            row.stormId,
            row.stormName,
            row.stormDate,
            row.stormTime,
            row.recordId,
            row.status,
            row.lat,
            row.lon,
            row.windKt,
            row.pressureMb,
          ),
        ),
    )
  }

  return {
    importedStormPoints: rows.length,
    sourceObjectKey: objectKey,
  }
}

function parseHurdat2(text: string) {
  const rows: Hurdat2Point[] = []
  let currentStorm:
    | {
        stormId: string
        stormName: string
      }
    | undefined

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }

    const columns = line.split(',').map((column) => column.trim())
    const firstColumn = columns[0]

    if (/^[A-Z]{2}\d{6}$/.test(firstColumn)) {
      currentStorm = {
        stormId: firstColumn,
        stormName: columns[1] || 'UNNAMED',
      }
      continue
    }

    if (!currentStorm || !/^\d{8}$/.test(firstColumn)) {
      continue
    }

    const lat = parseCoordinate(columns[4])
    const lon = parseCoordinate(columns[5])
    const windKt = Number(columns[6])
    const pressure = Number(columns[7])

    if (lat === null || lon === null || !Number.isFinite(windKt)) {
      continue
    }

    rows.push({
      stormId: currentStorm.stormId,
      stormName: currentStorm.stormName,
      stormDate: firstColumn,
      stormTime: columns[1] || '0000',
      recordId: columns[2] || null,
      status: columns[3] || 'UN',
      lat,
      lon,
      windKt,
      pressureMb: Number.isFinite(pressure) && pressure > 0 ? pressure : null,
    })
  }

  return rows
}

function parseCoordinate(value: string) {
  const match = value.match(/^(\d+(?:\.\d+)?)([NSEW])$/i)
  if (!match) {
    return null
  }

  const magnitude = Number(match[1])
  if (!Number.isFinite(magnitude)) {
    return null
  }

  return /[SW]/i.test(match[2]) ? -magnitude : magnitude
}

function isCaribbeanStormPoint(row: Hurdat2Point) {
  return (
    row.lon >= CARIBBEAN_STORM_BOUNDS.west &&
    row.lon <= CARIBBEAN_STORM_BOUNDS.east &&
    row.lat >= CARIBBEAN_STORM_BOUNDS.south &&
    row.lat <= CARIBBEAN_STORM_BOUNDS.north
  )
}
