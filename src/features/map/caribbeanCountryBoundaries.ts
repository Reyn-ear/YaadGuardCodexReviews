export interface CountryBoundary {
  iso3: string
  name: string
  polygons: Array<Array<[number, number]>>
}

function createBoundingPolygon(
  west: number,
  south: number,
  east: number,
  north: number,
): Array<[number, number]> {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ]
}

export const CARIBBEAN_COUNTRY_BOUNDARIES: CountryBoundary[] = [
  {
    iso3: 'AIA',
    name: 'Anguilla',
    polygons: [createBoundingPolygon(-63.43, 18.12, -62.92, 18.65)],
  },
  {
    iso3: 'ABW',
    name: 'Aruba',
    polygons: [createBoundingPolygon(-70.12, 12.38, -69.85, 12.65)],
  },
  {
    iso3: 'ATG',
    name: 'Antigua and Barbuda',
    polygons: [createBoundingPolygon(-61.95, 16.9, -61.62, 17.82)],
  },
  {
    iso3: 'BHS',
    name: 'Bahamas',
    polygons: [
      createBoundingPolygon(-80.55, 25.4, -76.4, 27.35),
      createBoundingPolygon(-79.65, 23.8, -74.2, 25.65),
      createBoundingPolygon(-77.9, 20.7, -72.55, 24.2),
    ],
  },
  {
    iso3: 'BLZ',
    name: 'Belize',
    polygons: [createBoundingPolygon(-89.25, 15.85, -87.72, 18.55)],
  },
  {
    iso3: 'BMU',
    name: 'Bermuda',
    polygons: [createBoundingPolygon(-64.95, 32.15, -64.55, 32.45)],
  },
  {
    iso3: 'BES',
    name: 'Bonaire, Saba and Sint Eustatius',
    polygons: [
      createBoundingPolygon(-68.45, 12.0, -68.15, 12.35),
      createBoundingPolygon(-63.05, 17.42, -62.9, 17.55),
      createBoundingPolygon(-63.18, 17.56, -62.94, 17.7),
    ],
  },
  {
    iso3: 'BRB',
    name: 'Barbados',
    polygons: [createBoundingPolygon(-59.68, 13.02, -59.4, 13.36)],
  },
  {
    iso3: 'CYM',
    name: 'Cayman Islands',
    polygons: [
      createBoundingPolygon(-81.45, 19.15, -81.05, 19.45),
      createBoundingPolygon(-80.2, 19.6, -79.7, 19.85),
      createBoundingPolygon(-79.95, 19.2, -79.65, 19.42),
    ],
  },
  {
    iso3: 'CUB',
    name: 'Cuba',
    polygons: [createBoundingPolygon(-84.96, 19.6, -74.1, 23.4)],
  },
  {
    iso3: 'CUW',
    name: 'Curacao',
    polygons: [createBoundingPolygon(-69.18, 12.0, -68.65, 12.45)],
  },
  {
    iso3: 'DMA',
    name: 'Dominica',
    polygons: [createBoundingPolygon(-61.5, 15.14, -61.2, 15.72)],
  },
  {
    iso3: 'DOM',
    name: 'Dominican Republic',
    polygons: [createBoundingPolygon(-72.1, 17.45, -68.2, 19.95)],
  },
  {
    iso3: 'GRD',
    name: 'Grenada',
    polygons: [createBoundingPolygon(-61.82, 11.95, -61.35, 12.55)],
  },
  {
    iso3: 'GLP',
    name: 'Guadeloupe',
    polygons: [createBoundingPolygon(-61.85, 15.78, -60.98, 16.55)],
  },
  {
    iso3: 'HTI',
    name: 'Haiti',
    polygons: [createBoundingPolygon(-74.55, 18, -71.62, 20.1)],
  },
  {
    iso3: 'JAM',
    name: 'Jamaica',
    polygons: [createBoundingPolygon(-78.5, 17.55, -76.18, 18.55)],
  },
  {
    iso3: 'KNA',
    name: 'Saint Kitts and Nevis',
    polygons: [createBoundingPolygon(-62.9, 17.1, -62.4, 17.55)],
  },
  {
    iso3: 'MAF',
    name: 'Saint Martin and Sint Maarten',
    polygons: [createBoundingPolygon(-63.18, 18.0, -62.92, 18.16)],
  },
  {
    iso3: 'MSR',
    name: 'Montserrat',
    polygons: [createBoundingPolygon(-62.28, 16.65, -62.12, 16.85)],
  },
  {
    iso3: 'MTQ',
    name: 'Martinique',
    polygons: [createBoundingPolygon(-61.25, 14.35, -60.78, 14.9)],
  },
  {
    iso3: 'PRI',
    name: 'Puerto Rico',
    polygons: [createBoundingPolygon(-67.35, 17.85, -65.2, 18.55)],
  },
  {
    iso3: 'LCA',
    name: 'Saint Lucia',
    polygons: [createBoundingPolygon(-61.1, 13.7, -60.82, 14.15)],
  },
  {
    iso3: 'TCA',
    name: 'Turks and Caicos Islands',
    polygons: [
      createBoundingPolygon(-72.55, 21.35, -71.0, 21.98),
      createBoundingPolygon(-71.0, 21.45, -70.0, 22.0),
    ],
  },
  {
    iso3: 'TTO',
    name: 'Trinidad and Tobago',
    polygons: [createBoundingPolygon(-61.95, 10, -60.5, 11.4)],
  },
  {
    iso3: 'VGB',
    name: 'British Virgin Islands',
    polygons: [createBoundingPolygon(-64.85, 18.25, -64.25, 18.8)],
  },
  {
    iso3: 'VIR',
    name: 'U.S. Virgin Islands',
    polygons: [createBoundingPolygon(-65.15, 17.65, -64.5, 18.45)],
  },
  {
    iso3: 'VCT',
    name: 'Saint Vincent and the Grenadines',
    polygons: [createBoundingPolygon(-61.35, 12.5, -61.05, 13.4)],
  },
]
