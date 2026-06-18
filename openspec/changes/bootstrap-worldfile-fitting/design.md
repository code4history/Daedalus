## Context
Daedalus is the fitting layer for Maplat V3.1. It assumes the target CRS is already known and focuses only on estimating world-file parameters from GCPs.

## Decisions
- Node/browser compatible.
- `world_file_basic` is a forward similarity transform.
- Internal optimization uses least squares.
- Standard reported residual is RMS.
- Shear is a later refinement step after the fixed-CRS basic fit.
