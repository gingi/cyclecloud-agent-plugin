# OpenFOAM application project — unfinished skeleton

This is not an installer or a tested OpenFOAM recipe. The scripts exit nonzero without changing the machine. Do not upload, attach, or submit this skeleton.

## Target environment

- Distribution/release/source/checksum: TODO(application)
- OS/architecture/compiler/MPI: TODO(platform)
- Versioned install prefix under `/shared/apps`: TODO(prefix)
- Shared mount and designated writer: TODO(storage)
- Slurm partition/account/task layout/launcher: TODO(scheduler)

Record configured OS releases and Slurm versions from application-context environment details, with their target and source. These form the authoring baseline, not proof of the running OS/software. Keep runtime checks in the verification plan. OpenFOAM distribution/release, missing MPI facts and material target conflicts remain separate choices or gaps; do not ask for versions already supplied by context.

## Implementation

- Complete `specs/install/cluster-init/scripts/10-install.sh` for a single designated writer. Stage, verify, then publish the shared installation; preserve existing versions.
- Complete `specs/runtime/cluster-init/scripts/10-runtime.sh` for consuming nodes. Check readiness and supply compatible node-local dependencies and environment setup.
- Complete `examples/openfoam.sbatch` with a small bounded case and an appropriate MPI launch sequence.
- Remove fail-fast guards only after implementing the corresponding behavior.

## Validation

Run the plugin skill's `scripts/validate-project.mjs` with Node and this directory as its argument. Bash is required for syntax checking. The unmodified scaffold is expected to fail because it contains unresolved TODO markers.

Local checks cover only the fixed file layout, TODO markers, and Bash syntax. They do not prove metadata validity, correct permissions, installation success, MPI compatibility, or scientific correctness.

## Deployment and verification plan

Complete [ATTACHMENT.md](ATTACHMENT.md) with discovered context, exact parameter mappings, existing entries to preserve, and operator steps. Do not infer runtime installation success from configuration.

TODO(document-locker-version-spec-targets-and-existing-node-rollout)

TODO(document-installation-smoke-test-small-serial-and-parallel-case-and-expected-results)

TODO(document-failure-cleanup-and-recovery-without-removing-existing-installations)

Publishing, attaching, running installers, and submitting jobs require separate authorization. Record each stage honestly; this project has not been installed or workload-tested.
