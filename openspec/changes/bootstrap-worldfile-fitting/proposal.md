# Change: Bootstrap Daedalus World-File Fitting

## Why
World-file fitting is being separated from `MaplatTin` so known-CRS placement logic can be reused independently of TIN handling and candidate CRS lookup.

## What Changes
- Define `world_file_basic` fitting.
- Define shear refinement as a later stage.
- Define fit metrics and helper I/O contracts.

## Impact
- Affected specs: `worldfile-fitting`
- Affected code: future fitting helpers and browser/node packaging
