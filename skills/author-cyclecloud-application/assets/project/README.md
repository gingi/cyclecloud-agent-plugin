# OpenFOAM application project — unfinished skeleton

This is not an installer or a tested OpenFOAM recipe. The scripts exit nonzero without changing the machine. Do not upload, attach, or submit this skeleton.

## Target environment

- Distribution, release, source and checksum: TODO(application)
- OS, architecture, compiler and MPI: TODO(platform)
- Versioned install prefix under `/shared/apps`: TODO(prefix)
- Shared mount and designated writer: TODO(storage)
- Slurm partition, account, task layout and launcher: TODO(scheduler)

Record configured OS releases and Slurm versions from supported CLI reads or authoritative supplied evidence, with their target and source. These form the authoring baseline, not proof of the OS and software actually running. Keep runtime checks in the verification plan. The OpenFOAM distribution and release, missing MPI facts and material conflicts between targets remain separate choices or gaps; do not ask for versions already supplied by context.

## Implementation

- Complete `specs/install/cluster-init/scripts/10-install.sh` for a single designated writer. Stage, verify, then publish the shared installation; preserve existing versions.
- Complete `specs/runtime/cluster-init/scripts/10-runtime.sh` for consuming nodes. Check readiness and supply compatible node-local dependencies and environment setup.
- Complete `examples/openfoam.sbatch` with a small bounded case and an appropriate MPI launch sequence.
- Remove fail-fast guards only after implementing the corresponding behavior.

## Validation

Run the plugin skill's `scripts/validate-project.mjs` with Node and this directory as its argument. Bash is required for syntax checking. The unmodified scaffold is expected to fail because it contains unresolved TODO markers.

Local checks cover only the fixed file layout, TODO markers, and Bash syntax. They do not prove metadata validity, correct permissions, installation success, MPI compatibility, or scientific correctness.

## Deployment and verification plan

Complete [ATTACHMENT.md](ATTACHMENT.md) with gathered facts, exact parameter mappings, existing entries to preserve, and operator steps. Do not infer runtime installation success from configuration.

TODO(Document the locker, version, spec targets and rollout for existing nodes.)

TODO(Document an installation smoke test, small serial and parallel cases, and expected results.)

TODO(Document cleanup and recovery after failure without removing existing installations.)

Publishing, attaching, running installers, and submitting jobs require separate authorization. Record each stage honestly; this project has not been installed or workload-tested.
