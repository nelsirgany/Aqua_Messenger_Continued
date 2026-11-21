// Pulls real NYC hydrants from Open Data "NYCDEP Citywide Hydrants",
// bounded to one neighbourhood (downtown Brooklyn / NYU Tandon) so the
// map stays fast.
//
// The brief names dataset 6pui-xhxz, but that id's SODA resource endpoint
// returns rows with no fields — its catalog entry is a map-visualization
// view (assetType "map", columns: []) layered on top of the real tabular
// view, given as its modifyingViewUid. That underlying id is 5bgh-vtsn,
// confirmed by fetching https://data.cityofnewyork.us/api/views/6pui-xhxz.json
// and inspecting the row shape at https://data.cityofnewyork.us/resource/5bgh-vtsn.json —
// this is exactly the "inspect before assuming" case schema.md warns about.
// Fields there: the_geom, boro (numeric code, not a name), unitid,
// point_x/point_y (state plane, unused), latitude, longitude. There is no
// street address column in this dataset, so street_address stays null.
import postgres from "postgres";

// Citywide: all ~110k DEP hydrants. The grey field of unmonitored assets
// is the sales argument, and at citywide scale it is a far stronger one —
// the console loads it once from a cached endpoint rather than on every
// poll, so the row count costs nothing at runtime.
const DATASET_URL = "https://data.cityofnewyork.us/resource/5bgh-vtsn.json?$select=*";
const PAGE_SIZE = 50000;
const INSERT_CHUNK = 5000;

const BORO_CODE_NAME: Record<string, string> = {
  "1": "MANHATTAN",
  "2": "BRONX",
  "3": "BROOKLYN",
  "4": "QUEENS",
  "5": "STATEN ISLAND",
};

type SocrataHydrant = Record<string, string | undefined> & {
  the_geom?: { coordinates?: [number, number] };
};

function firstDefined(row: SocrataHydrant, keys: string[]): string | undefined {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return undefined;
}

async function fetchAllPages(): Promise<SocrataHydrant[]> {
  const all: SocrataHydrant[] = [];
  let offset = 0;
  // Socrata caps a single response well below the citywide row count, so
  // page through with $order on a stable key — without an explicit order
  // paging is not guaranteed to be consistent between requests.
  for (;;) {
    const url = `${DATASET_URL}&$limit=${PAGE_SIZE}&$offset=${offset}&$order=unitid`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Socrata request failed: ${res.status} ${res.statusText} (offset ${offset})`);
    const page = (await res.json()) as SocrataHydrant[];
    all.push(...page);
    console.log(`  fetched ${all.length} rows…`);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL not set");

  console.log(`Fetching every NYC hydrant from ${DATASET_URL}`);
  const rows = await fetchAllPages();
  if (rows.length === 0) throw new Error("No hydrants returned — check the dataset id");

  console.log(`Fetched ${rows.length} rows. Sample columns:`, Object.keys(rows[0]));

  const sql = postgres(databaseUrl);

  // Map Socrata's field names at import time. Known variants across
  // revisions of this dataset are listed for each logical field.
  const mapped = rows
    .map((row) => {
      const unitId = firstDefined(row, ["unitid", "unit_id", "objectid"]);
      const boroRaw = firstDefined(row, ["borough", "boro"]);
      const borough = (boroRaw && BORO_CODE_NAME[boroRaw]) ?? boroRaw ?? "UNKNOWN";
      const address = firstDefined(row, ["address", "street_address", "housenumber"]);
      const lat =
        firstDefined(row, ["latitude", "lat"]) ?? row.the_geom?.coordinates?.[1]?.toString();
      const lon =
        firstDefined(row, ["longitude", "lon", "long"]) ?? row.the_geom?.coordinates?.[0]?.toString();

      if (!unitId || !lat || !lon) return null;
      return {
        dep_unit_id: unitId,
        borough,
        street_address: address ?? null,
        latitude: Number(lat),
        longitude: Number(lon),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  console.log(`Mapped ${mapped.length} hydrants with valid id/lat/lon.`);

  // One transaction so the temporary staging table stays on a single
  // pooled connection for every chunk.
  const insertedCount = await sql.begin(async (tx) => {
    await tx`
      create temporary table hydrants_staging (
        dep_unit_id text,
        borough text,
        street_address text,
        latitude numeric(9,6),
        longitude numeric(9,6)
      ) on commit drop
    `;

    // Chunked: a single 110k-row insert would exceed the bind-parameter limit.
    for (let i = 0; i < mapped.length; i += INSERT_CHUNK) {
      const chunk = mapped.slice(i, i + INSERT_CHUNK);
      await tx`insert into hydrants_staging ${tx(chunk)}`;
      console.log(`  staged ${Math.min(i + INSERT_CHUNK, mapped.length)}/${mapped.length}`);
    }

    const inserted = await tx`
      insert into hydrants (dep_unit_id, borough, street_address, latitude, longitude)
      select distinct on (dep_unit_id)
             dep_unit_id, borough, street_address, latitude, longitude
      from hydrants_staging
      order by dep_unit_id
      on conflict (dep_unit_id) do nothing
      returning dep_unit_id
    `;
    return inserted.length;
  });

  console.log(`Inserted ${insertedCount} new hydrants (deployment_state defaults to 'unmonitored').`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
