export function applicationNodes() {
    return [
        {
            Name: "scheduler",
            Template: "scheduler",
            Extends: ["defaults"],
            State: "Started",
            ImageName: "cycle.image.ubuntu22",
            MachineType: "Standard_D4s_v5",
            Architecture: "x86_64",
            Locker: "project-storage",
            SlurmRole: "scheduler",
            SlurmVersion: "23.11",
            SlurmHaEnabled: true,
            SlurmPrimaryScheduler: true,
            Mounts: {
                builtinshared: {
                    mountpoint: "/shared",
                    fs_type: "xfs",
                    disabled: false,
                    password: "SECRET_MOUNT",
                },
                hidden: { mountpoint: "/shared/apps", disabled: true },
            },
            Volumes: {
                shared: {
                    Mount: "builtinshared",
                    Persistent: true,
                    Disabled: false,
                    Secret: "SECRET_VOLUME",
                },
            },
            ClusterInitSpecs: {
                "slurm:scheduler": {
                    Project: "slurm",
                    Spec: "scheduler",
                    Version: "4.0.9",
                    SourceLocker: "cyclecloud",
                },
                "existing:install": {
                    Project: "existing",
                    Spec: "install",
                    Version: "1.0.0",
                    AdditionalSpec: true,
                    Order: 100,
                    Secret: "SECRET_SPEC",
                },
            },
            AttachmentReference: "$SchedulerClusterInitSpecs",
            Configuration: {
                slurm: { accounting: { password: "SECRET_CONFIG" } },
            },
        },
        {
            Name: "scheduler-ha",
            IsArray: true,
            Extends: ["scheduler"],
            SlurmRole: "scheduler",
            SlurmHaEnabled: true,
            SlurmPrimaryScheduler: false,
            AttachmentReference: "$SchedulerClusterInitSpecs",
            ClusterInitSpecs: {},
        },
        {
            Name: "hpc",
            IsArray: true,
            Extends: ["nodearraybase"],
            ImageName: "cycle.image.ubuntu22",
            SlurmRole: "execute",
            SlurmPartition: "hpc",
            SlurmAutoscale: true,
            Mounts: {
                nfs_shared: {
                    mountpoint: "/shared",
                    type: "nfs",
                    disabled: false,
                    options: "SECRET_OPTIONS",
                },
            },
            ClusterInitSpecs: {},
            AttachmentReference: "${HPCClusterInitSpecs}",
        },
    ];
}

export function applicationParameters() {
    return [
        {
            Name: "SchedulerClusterInitSpecs",
            Label: "Scheduler Cluster-Init",
            ParameterType: "Cloud.ClusterInitSpecs",
            Value: {
                "existing:install": {
                    Project: "existing",
                    Spec: "install",
                    Version: "1.0.0",
                },
            },
            Password: "SECRET_PARAMETER",
        },
        {
            Name: "HPCClusterInitSpecs",
            Label: "HPC Cluster-Init",
            ParameterType: "Cloud.ClusterInitSpecs",
            Value: {},
        },
    ];
}
