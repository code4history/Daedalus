# Project Context

## Purpose
Daedalus provides world-file fitting for a known target CRS in Maplat.

## Tech Stack
- TypeScript (planned)
- Node.js and browser runtimes

## Domain Context
- Inputs are GCPs and a single fixed CRS.
- The package estimates basic similarity placement first, then optional shear refinement.
- The package does not pick candidate CRSs from geographic extent.
