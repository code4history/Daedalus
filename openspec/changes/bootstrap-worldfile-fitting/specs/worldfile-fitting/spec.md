# worldfile-fitting Specification

## ADDED Requirements
### Requirement: Daedalus SHALL Fit world_file_basic For A Known CRS
Daedalus SHALL accept a fixed target CRS together with GCPs and fit `world_file_basic` without performing CRS search.

#### Scenario: Known-CRS fitting is requested
- **GIVEN** GCPs and a fixed target CRS
- **WHEN** Daedalus fits `world_file_basic`
- **THEN** it SHALL produce a basic world-file result without searching across CRS candidates

### Requirement: world_file_basic SHALL Be A Forward Similarity Transform
The mathematical contract of `world_file_basic` SHALL be a forward 2D similarity transform from illustration coordinates to projected map coordinates.

#### Scenario: Forward fit is interpreted
- **GIVEN** illustration-side and projected-map-side GCPs
- **WHEN** `world_file_basic` is interpreted mathematically
- **THEN** it SHALL represent isotropic scale, rotation, and translation from illustration coordinates into projected map coordinates

### Requirement: world_file_basic SHALL Use Least-Squares Optimization and RMS Reporting
Daedalus SHALL minimize least-squares error internally and SHALL expose RMS as the standard residual metric.

#### Scenario: Fit is computed
- **GIVEN** illustration coordinates and projected map coordinates for the same GCP set
- **WHEN** Daedalus fits `world_file_basic`
- **THEN** it SHALL minimize the sum of squared residuals internally and SHALL expose RMS in the standard result

#### Scenario: Debug metrics are requested
- **GIVEN** debug diagnostics are enabled
- **WHEN** Daedalus returns extended fit diagnostics
- **THEN** it MAY additionally include `SSE` and `MSE`
