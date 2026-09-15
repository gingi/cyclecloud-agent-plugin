#!/usr/bin/env bash
#SBATCH --job-name=openfoam-example
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --time=00:05:00
set -euo pipefail

# TODO(select-partition-account-and-task-layout)
# TODO(load-versioned-openfoam-environment-and-prepare-small-case)
# TODO(decompose-and-run-with-supported-mpi-launcher-and-check-results)
printf '%s\n' 'Unimplemented OpenFOAM job skeleton; no solver launched.' >&2
exit 78
