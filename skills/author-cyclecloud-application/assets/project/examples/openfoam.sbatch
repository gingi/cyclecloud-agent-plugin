#!/usr/bin/env bash
#SBATCH --job-name=openfoam-example
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --time=00:05:00
set -euo pipefail

# TODO(Choose the partition, account and task layout.)
# TODO(Load the selected OpenFOAM version's environment and prepare a small case.)
# TODO(Decompose the case, run it with a supported MPI launcher, and check the results.)
printf '%s\n' 'Unimplemented OpenFOAM job skeleton; no solver launched.' >&2
exit 78
